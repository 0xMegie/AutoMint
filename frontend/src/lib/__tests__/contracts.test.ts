/**
 * Tests for the read functions in contracts.ts (#459, #460, AM-143).
 *
 * Verifies three properties for every read function:
 *   1. RPC failures throw — they are never swallowed or returned as empty data.
 *   2. Specific contract error codes (NotRegistered / NotFound) return null
 *      where the contract semantics warrant it, not all errors.
 *   3. Normal data round-trips correctly.
 *
 * Also tests the defaultSource() priority chain (#459):
 *   explicit arg > connected wallet (Zustand) > env-var fallback > throw
 *
 * The stellar.ts helper is mocked so tests exercise only the
 * argument-building / result-decoding / error-handling logic in contracts.ts.
 */

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    // Avoid strkey validation for placeholder addresses in unit tests.
    nativeToScVal: jest.fn((v: unknown) => ({ scv: v })),
  };
});

jest.mock("../stellar", () => ({
  __esModule: true,
  getServer: jest.fn(),
  rpcCall: jest.fn(),
  simulateContractCall: jest.fn(),
}));

// Wallet store mock: expose a controllable getState() snapshot so we can
// simulate connected / disconnected states without a React tree.
const mockWalletGetState = jest.fn<{ publicKey: string | null }, []>();
jest.mock("@/store/walletStore", () => ({
  useWalletStore: {
    getState: () => mockWalletGetState(),
  },
}));

// Constants mock: lets individual tests override ANONYMOUS_READ_SOURCE.
jest.mock("../constants", () => ({
  ...jest.requireActual("../constants"),
  ANONYMOUS_READ_SOURCE: "",
}));

import { simulateContractCall } from "../stellar";
import {
  isRegistered,
  getTotalUsers,
  getUserProfile,
  getAccrualState,
  getLeaderboard,
  getActiveListings,
  getUserListings,
  getUserRank,
  getPendingPoints,
  getUserBots,
  getUserBotsDetailed,
  getBotById,
  getUserTotalRate,
  UNRANKED_SENTINEL,
} from "../contracts";

const mockSimulate = simulateContractCall as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: wallet disconnected, no env-var fallback.
  mockWalletGetState.mockReturnValue({ publicKey: null });
});

// ---------------------------------------------------------------------------
// defaultSource() priority chain (#459)
//
// defaultSource is private so we exercise it through the public functions
// that call it (getLeaderboard and getTotalUsers accept an optional
// sourceAddress parameter).
// ---------------------------------------------------------------------------
describe("defaultSource", () => {
  it("uses an explicit sourceAddress when provided", async () => {
    mockSimulate.mockResolvedValue([]);
    await getLeaderboard(10, "GEXPLICIT");
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "get_leaderboard",
      expect.any(Array),
      "GEXPLICIT"  // explicit arg wins
    );
  });

  it("falls back to the connected wallet when no explicit arg is given", async () => {
    mockWalletGetState.mockReturnValue({ publicKey: "GWALLET" });
    mockSimulate.mockResolvedValue([]);
    await getLeaderboard(10);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "get_leaderboard",
      expect.any(Array),
      "GWALLET"  // Zustand store snapshot used
    );
  });

  it("falls back to ANONYMOUS_READ_SOURCE when wallet is disconnected", async () => {
    // Override the constants mock for this test only.
    const constants = jest.requireMock("../constants") as Record<string, unknown>;
    const original = constants.ANONYMOUS_READ_SOURCE;
    constants.ANONYMOUS_READ_SOURCE = "GENV_FALLBACK";
    try {
      mockWalletGetState.mockReturnValue({ publicKey: null });
      mockSimulate.mockResolvedValue([]);
      await getLeaderboard(10);
      expect(mockSimulate).toHaveBeenCalledWith(
        expect.any(String),
        "get_leaderboard",
        expect.any(Array),
        "GENV_FALLBACK"  // env-var fallback used
      );
    } finally {
      constants.ANONYMOUS_READ_SOURCE = original;
    }
  });

  it("throws a descriptive error when no source is available at all", async () => {
    mockWalletGetState.mockReturnValue({ publicKey: null });
    // ANONYMOUS_READ_SOURCE is "" (default in the mock above)
    await expect(getLeaderboard(10)).rejects.toThrow(
      "NEXT_PUBLIC_SIMULATION_SOURCE"
    );
  });

  it("explicit arg takes precedence over a connected wallet", async () => {
    mockWalletGetState.mockReturnValue({ publicKey: "GWALLET" });
    mockSimulate.mockResolvedValue(0);
    await getTotalUsers("GOVERRIDE");
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "total_users",
      [],
      "GOVERRIDE"  // explicit arg beats wallet
    );
  });
});

// ---------------------------------------------------------------------------
// isRegistered
// ---------------------------------------------------------------------------
describe("isRegistered", () => {
  it("returns true when the registry reports the user as registered", async () => {
    mockSimulate.mockResolvedValue(true);
    await expect(isRegistered("GUSER")).resolves.toBe(true);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "is_registered",
      expect.any(Array),
      "GUSER"
    );
  });

  it("returns false when the registry reports the user as not registered", async () => {
    mockSimulate.mockResolvedValue(false);
    await expect(isRegistered("GUSER")).resolves.toBe(false);
  });

  it("throws on RPC failure — never returns false for a network error (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(isRegistered("GUSER")).rejects.toThrow("rpc down");
  });
});

// ---------------------------------------------------------------------------
// getTotalUsers
// ---------------------------------------------------------------------------
describe("getTotalUsers", () => {
  it("returns the numeric total on success", async () => {
    mockSimulate.mockResolvedValue(7);
    await expect(getTotalUsers("GSRC")).resolves.toBe(7);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "total_users",
      [],
      "GSRC"
    );
  });

  it("throws when the simulation throws (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getTotalUsers("GSRC")).rejects.toThrow("rpc down");
  });

  it("throws when the contract returns null — not silently 0", async () => {
    mockSimulate.mockResolvedValue(null);
    await expect(getTotalUsers("GSRC")).rejects.toThrow("total_users returned no value");
  });

  it("throws when the contract returns undefined — not silently 0", async () => {
    mockSimulate.mockResolvedValue(undefined);
    await expect(getTotalUsers("GSRC")).rejects.toThrow("total_users returned no value");
  });
});

// ---------------------------------------------------------------------------
// getUserProfile
// ---------------------------------------------------------------------------
describe("getUserProfile", () => {
  it("parses the raw profile into a typed UserProfile", async () => {
    mockSimulate.mockResolvedValue({
      address: "GUSER",
      username: "Alice",
      total_points: 350n,
    });
    const profile = await getUserProfile("GUSER");
    expect(profile).toEqual({ address: "GUSER", username: "Alice", points: 350n });
  });

  it("throws on generic RPC failure — not swallowed as null (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getUserProfile("GUSER")).rejects.toThrow("rpc down");
  });

  it("returns null on contract NotRegistered error code #1", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_user: Error(Contract, #1)")
    );
    await expect(getUserProfile("GSTRANGER")).resolves.toBeNull();
  });

  it("returns null on contract NotRegistered named error", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_user: NotRegistered")
    );
    await expect(getUserProfile("GSTRANGER")).resolves.toBeNull();
  });

  it("throws on a different contract error code — not swallowed as null", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_user: Error(Contract, #5)")
    );
    await expect(getUserProfile("GUSER")).rejects.toThrow("Error(Contract, #5)");
  });
});

// ---------------------------------------------------------------------------
// getAccrualState
// ---------------------------------------------------------------------------
describe("getAccrualState", () => {
  it("parses raw accrual state correctly", async () => {
    mockSimulate.mockResolvedValue({
      last_claim_ts: 1_700_000_000n,
      total_claimed_points: 42n,
    });
    const state = await getAccrualState("GUSER");
    expect(state).toEqual({
      last_claim_ts: 1_700_000_000n,
      total_claimed_points: 42n,
    });
  });

  it("throws on generic RPC failure — not swallowed as null (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getAccrualState("GUSER")).rejects.toThrow("rpc down");
  });

  it("returns null on contract NotFound error code #2", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_accrual_state: Error(Contract, #2)")
    );
    await expect(getAccrualState("GNEWUSER")).resolves.toBeNull();
  });

  it("returns null on contract NotFound named error", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_accrual_state: NotFound")
    );
    await expect(getAccrualState("GNEWUSER")).resolves.toBeNull();
  });

  it("returns null on contract NotRegistered error code #1", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_accrual_state: Error(Contract, #1)")
    );
    await expect(getAccrualState("GNEWUSER")).resolves.toBeNull();
  });

  it("throws on a different contract error code — not swallowed as null", async () => {
    mockSimulate.mockRejectedValue(
      new Error("Simulation failed for get_accrual_state: Error(Contract, #9)")
    );
    await expect(getAccrualState("GUSER")).rejects.toThrow("Error(Contract, #9)");
  });
});

// ---------------------------------------------------------------------------
// getLeaderboard
// ---------------------------------------------------------------------------
describe("getLeaderboard", () => {
  it("maps an array of raw profiles", async () => {
    mockSimulate.mockResolvedValue([
      { address: "GA", username: "A", total_points: 500n },
      { address: "GB", username: "B", total_points: 100n },
    ]);
    const lb = await getLeaderboard(10, "GSRC");
    expect(lb).toEqual([
      { address: "GA", username: "A", points: 500n },
      { address: "GB", username: "B", points: 100n },
    ]);
  });

  it("throws on RPC failure — not silently [] (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("boom"));
    await expect(getLeaderboard(10, "GSRC")).rejects.toThrow("boom");
  });

  it("throws when the contract returns a non-array — schema mismatch, not empty list", async () => {
    mockSimulate.mockResolvedValue(null);
    await expect(getLeaderboard(10, "GSRC")).rejects.toThrow(
      "get_leaderboard returned unexpected type"
    );
  });

  it("returns an empty array when the contract genuinely returns []", async () => {
    mockSimulate.mockResolvedValue([]);
    await expect(getLeaderboard(10, "GSRC")).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getActiveListings
// ---------------------------------------------------------------------------
describe("getActiveListings", () => {
  const rawListing = {
    id: 1n,
    seller: "GSELLER",
    bot_id: 10n,
    price: 500n,
    listed_at: 1_700_000_000n,
  };

  it("maps an array of raw listings", async () => {
    mockSimulate.mockResolvedValue([rawListing]);
    const listings = await getActiveListings(0, 100, "GSRC");
    expect(listings).toEqual([
      { id: 1n, seller: "GSELLER", bot_id: 10n, price: 500n, listed_at: 1_700_000_000n },
    ]);
  });

  it("throws on RPC failure — not silently [] (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getActiveListings(0, 100, "GSRC")).rejects.toThrow("rpc down");
  });

  it("throws when the contract returns a non-array — schema mismatch, not empty list", async () => {
    mockSimulate.mockResolvedValue(undefined);
    await expect(getActiveListings(0, 100, "GSRC")).rejects.toThrow(
      "get_active_listings returned unexpected type"
    );
  });

  it("returns an empty array when the contract genuinely returns []", async () => {
    mockSimulate.mockResolvedValue([]);
    await expect(getActiveListings(0, 100, "GSRC")).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getUserListings
// ---------------------------------------------------------------------------
describe("getUserListings", () => {
  const rawListing = {
    id: 2n,
    seller: "GUSER",
    bot_id: 20n,
    price: 1000n,
    listed_at: 1_700_000_001n,
  };

  it("maps an array of raw listings for the user", async () => {
    mockSimulate.mockResolvedValue([rawListing]);
    const listings = await getUserListings("GUSER");
    expect(listings).toEqual([
      { id: 2n, seller: "GUSER", bot_id: 20n, price: 1000n, listed_at: 1_700_000_001n },
    ]);
  });

  it("throws on RPC failure — not silently [] (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getUserListings("GUSER")).rejects.toThrow("rpc down");
  });

  it("throws when the contract returns a non-array — schema mismatch, not empty list", async () => {
    mockSimulate.mockResolvedValue("unexpected");
    await expect(getUserListings("GUSER")).rejects.toThrow(
      "get_user_listings returned unexpected type"
    );
  });

  it("returns an empty array when the contract genuinely returns []", async () => {
    mockSimulate.mockResolvedValue([]);
    await expect(getUserListings("GUSER")).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getUserRank (pre-existing, kept for regression coverage)
// ---------------------------------------------------------------------------
describe("getUserRank", () => {
  const board = [
    { address: "GA", username: "A", total_points: 500n },
    { address: "GB", username: "B", total_points: 300n },
    { address: "GC", username: "C", total_points: 100n },
  ];

  it("derives the rank and the gap to the position above from the board", async () => {
    mockSimulate.mockResolvedValueOnce(board);

    await expect(getUserRank("GB", "GSRC")).resolves.toEqual({
      address: "GB",
      username: "B",
      rank: 2,
      points: 300n,
      pointsToNextRank: 200n,
    });

    // The user was found in the scanned window, so `get_rank` is not needed.
    expect(mockSimulate).toHaveBeenCalledTimes(1);
  });

  it("reports no gap for the rank-1 user", async () => {
    mockSimulate.mockResolvedValueOnce(board);

    await expect(getUserRank("GA", "GSRC")).resolves.toMatchObject({
      rank: 1,
      pointsToNextRank: null,
    });
  });

  it("falls back to the registry's get_rank for a user below the window", async () => {
    mockSimulate
      .mockResolvedValueOnce(board) // get_leaderboard
      .mockResolvedValueOnce(312) // get_rank
      .mockResolvedValueOnce({ address: "GD", username: "D", total_points: 42n }); // get_user

    await expect(getUserRank("GD", "GSRC")).resolves.toEqual({
      address: "GD",
      username: "D",
      rank: 312,
      points: 42n,
      pointsToNextRank: null,
    });
  });

  it("treats the u32::MAX sentinel as unranked, not as a position", async () => {
    mockSimulate
      .mockResolvedValueOnce(board)
      .mockResolvedValueOnce(UNRANKED_SENTINEL)
      .mockResolvedValueOnce({ address: "GD", username: "D", total_points: 0n });

    await expect(getUserRank("GD", "GSRC")).resolves.toMatchObject({ rank: null });
  });

  it("still reports the standing when the registry has no get_rank yet", async () => {
    mockSimulate
      .mockResolvedValueOnce(board)
      .mockRejectedValueOnce(new Error("unknown function get_rank"))
      .mockResolvedValueOnce({ address: "GD", username: "D", total_points: 42n });

    await expect(getUserRank("GD", "GSRC")).resolves.toMatchObject({
      rank: null,
      points: 42n,
    });
  });

  it("resolves to null when the address has no registry profile", async () => {
    mockSimulate
      .mockResolvedValueOnce(board)
      .mockRejectedValueOnce(new Error("no get_rank"))
      .mockRejectedValueOnce(new Error("NotRegistered"));

    await expect(getUserRank("GSTRANGER", "GSRC")).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Read functions routed through simulateContractCall (#481)
//
// These four used to build their own TransactionBuilder, check for errors
// and decode by hand, and silently return 0n / [] / null on simulation
// failure. Now they share the helper and let errors propagate (AM-143).
// ---------------------------------------------------------------------------
describe("getPendingPoints (#481)", () => {
  it("decodes the simulated return value as bigint", async () => {
    mockSimulate.mockResolvedValue(123n);
    await expect(getPendingPoints("GUSER")).resolves.toBe(123n);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "pending_points",
      expect.any(Array),
      "GUSER"
    );
  });

  it("propagates simulation errors instead of returning 0n", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getPendingPoints("GUSER")).rejects.toThrow("rpc down");
  });
});

describe("getUserBots (#481)", () => {
  it("maps the id list to bigints", async () => {
    mockSimulate.mockResolvedValue([1n, 2n]);
    await expect(getUserBots("GUSER")).resolves.toEqual([1n, 2n]);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "get_user_bots",
      expect.any(Array),
      "GUSER"
    );
  });

  it("propagates simulation errors instead of returning []", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getUserBots("GUSER")).rejects.toThrow("rpc down");
  });

  it("throws when the contract returns a non-array", async () => {
    mockSimulate.mockResolvedValue(null);
    await expect(getUserBots("GUSER")).rejects.toThrow("expected array");
  });
});

describe("getBotById (#481)", () => {
  const rawBot = {
    id: 5n,
    name: "Bot",
    owner: "GOWNER",
    tier: "Gold",
    accrual_rate: 10n,
    minted_at: 1,
    last_claim_timestamp: 0n,
  };

  it("parses the simulated bot record", async () => {
    mockSimulate.mockResolvedValue(rawBot);
    const bot = await getBotById("GUSER", 5n);
    expect(bot).toMatchObject({ id: 5n, tier: "Gold", accrual_rate: 10n });
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "get_bot",
      expect.any(Array),
      "GUSER"
    );
  });

  it("propagates simulation errors instead of returning null", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getBotById("GUSER", 5n)).rejects.toThrow("rpc down");
  });
});

describe("getUserTotalRate (#481)", () => {
  it("decodes the rate as bigint", async () => {
    mockSimulate.mockResolvedValue(77n);
    await expect(getUserTotalRate("GUSER")).resolves.toBe(77n);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "get_user_total_rate",
      expect.any(Array),
      "GUSER"
    );
  });

  it("propagates simulation errors instead of returning 0n", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getUserTotalRate("GUSER")).rejects.toThrow("rpc down");
  });
});

// ---------------------------------------------------------------------------
// getUserBotsDetailed (#483)
// ---------------------------------------------------------------------------
describe("getUserBotsDetailed (#483)", () => {
  const rawBot = {
    id: 5n,
    name: "Bot",
    owner: "GOWNER",
    tier: "Gold",
    accrual_rate: 10n,
    minted_at: 1,
    last_claim_timestamp: 0n,
  };

  it("maps the single round trip of detailed records through parseBotNFT", async () => {
    mockSimulate.mockResolvedValue([rawBot]);
    const bots = await getUserBotsDetailed("GUSER");
    expect(bots).toHaveLength(1);
    expect(bots[0]).toMatchObject({ id: 5n, tier: "Gold", accrual_rate: 10n });
    expect(mockSimulate).toHaveBeenCalledTimes(1);
    expect(mockSimulate).toHaveBeenCalledWith(
      expect.any(String),
      "get_user_bots_detailed",
      expect.any(Array),
      "GUSER"
    );
  });

  it("throws when the contract returns a non-array", async () => {
    mockSimulate.mockResolvedValue(undefined);
    await expect(getUserBotsDetailed("GUSER")).rejects.toThrow("expected array");
  });

  it("propagates simulation errors", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getUserBotsDetailed("GUSER")).rejects.toThrow("rpc down");
  });
});
