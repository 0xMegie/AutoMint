/**
 * Tests for the registry contract calls in contracts.ts (#130).
 *
 * The stellar.ts helper module is mocked so these tests exercise only the
 * argument-building / result-decoding logic in contracts.ts.
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
  simulateContractCall: jest.fn(),
}));

import { simulateContractCall } from "../stellar";
import {
  isRegistered,
  getTotalUsers,
  getUserProfile,
  getLeaderboard,
  getUserRank,
  UNRANKED_SENTINEL,
} from "../contracts";

const mockSimulate = simulateContractCall as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

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

  it("throws when the simulation throws (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(isRegistered("GUSER")).rejects.toThrow("rpc down");
  });
});

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
});

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

  it("throws when the simulation throws (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("rpc down"));
    await expect(getUserProfile("GUSER")).rejects.toThrow("rpc down");
  });
});

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

  it("throws on error so React Query captures isError (AM-143)", async () => {
    mockSimulate.mockRejectedValue(new Error("boom"));
    await expect(getLeaderboard(10, "GSRC")).rejects.toThrow("boom");
  });
});

// ---------------------------------------------------------------------------
// #506 — resolving a single user's standing
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
