/**
 * Tests for connectFreighter and simulateContractCall in stellar.ts.
 *
 * Both @stellar/freighter-api and @stellar/stellar-sdk are fully mocked so the
 * tests exercise only the wrapper logic (error normalization, simulation
 * success/failure handling).
 */

// ── @stellar/stellar-sdk mock ───────────────────────────────────────────────
const mockGetAccount = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockIsSimulationError = jest.fn();
const mockScValToNative = jest.fn();
const mockBuiltTx = { tx: true, toXDR: jest.fn(() => "UNPREPARED_XDR") };

jest.mock("@stellar/stellar-sdk", () => ({
  __esModule: true,
  SorobanRpc: {
    Server: jest.fn().mockImplementation(() => ({
      getAccount: mockGetAccount,
      simulateTransaction: mockSimulateTransaction,
      prepareTransaction: mockPrepareTransaction,
    })),
    Api: {
      isSimulationError: (...args: unknown[]) => mockIsSimulationError(...args),
    },
  },
  Contract: jest.fn().mockImplementation(() => ({
    call: jest.fn(() => ({ op: true })),
  })),
  TransactionBuilder: jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn(() => mockBuiltTx),
  })),
  scValToNative: (...args: unknown[]) => mockScValToNative(...args),
  nativeToScVal: jest.fn(() => ({ scv: true })),
  xdr: {},
}));

// ── @stellar/freighter-api mock ─────────────────────────────────────────────
jest.mock("@stellar/freighter-api", () => ({
  __esModule: true,
  isConnected: jest.fn(),
  requestAccess: jest.fn(),
  getNetwork: jest.fn(),
}));

import {
  isConnected,
  requestAccess,
  getNetwork,
} from "@stellar/freighter-api";
import { connectFreighter, simulateContractCall, buildPreparedTx } from "../stellar";

const mockIsConnected = isConnected as jest.Mock;
const mockRequestAccess = requestAccess as jest.Mock;
const mockGetNetwork = getNetwork as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("connectFreighter", () => {
  it("returns publicKey and network on success", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockRequestAccess.mockResolvedValue({ address: "GABC123" });
    mockGetNetwork.mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    const result = await connectFreighter();
    expect(result).toEqual({ publicKey: "GABC123", network: "TESTNET" });
  });

  it("throws when the extension is not installed", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: false });
    await expect(connectFreighter()).rejects.toThrow(/not installed|not be detected/i);
  });

  it("throws a locked-wallet error when access returns a lock error", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockRequestAccess.mockResolvedValue({
      address: "",
      error: { code: -1, message: "Wallet is locked" },
    });
    await expect(connectFreighter()).rejects.toThrow(/locked/i);
  });

  it("throws a rejection error when the user rejects the request", async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockRequestAccess.mockResolvedValue({
      address: "",
      error: { code: -2, message: "User rejected the request" },
    });
    await expect(connectFreighter()).rejects.toThrow(/rejected/i);
  });
});

describe("simulateContractCall", () => {
  /** A stand-in ScVal exposing only the discriminant the helper inspects. */
  const scVal = (type = "scvU32") => ({ type, switch: () => ({ name: type }) });

  beforeEach(() => {
    mockGetAccount.mockResolvedValue({ accountId: () => "GSRC" });
    mockIsSimulationError.mockReturnValue(false);
  });

  it("returns the decoded native value on success", async () => {
    const retval = scVal();
    mockSimulateTransaction.mockResolvedValue({ result: { retval } });
    mockScValToNative.mockReturnValue(42);

    const value = await simulateContractCall<number>("CCONTRACT", "total_users", [], "GSRC");
    expect(value).toBe(42);
    expect(mockScValToNative).toHaveBeenCalledWith(retval);
  });

  it.each([
    ["zero", 0],
    ["false", false],
    ["an empty vector", []],
    ["an empty string", ""],
  ])("decodes a returned %s instead of treating it as absent", async (_label, native) => {
    mockSimulateTransaction.mockResolvedValue({ result: { retval: scVal() } });
    mockScValToNative.mockReturnValue(native);

    const value = await simulateContractCall("CCONTRACT", "balance", [], "GSRC");
    expect(value).toStrictEqual(native);
  });

  it("resolves to undefined, without throwing, when the function returns void", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: scVal("scvVoid") },
    });

    const value = await simulateContractCall("CCONTRACT", "set_flag", [], "GSRC");
    expect(value).toBeUndefined();
    expect(mockScValToNative).not.toHaveBeenCalled();
  });

  it("throws when the simulation reports an error", async () => {
    mockSimulateTransaction.mockResolvedValue({ error: "boom" });
    mockIsSimulationError.mockReturnValue(true);

    await expect(
      simulateContractCall("CCONTRACT", "balance", [], "GSRC")
    ).rejects.toThrow(/Simulation failed/i);
  });

  it("throws when the RPC response carries no result at all", async () => {
    mockSimulateTransaction.mockResolvedValue({});

    await expect(
      simulateContractCall("CCONTRACT", "balance", [], "GSRC")
    ).rejects.toThrow(/No result/i);
  });
});

describe("buildPreparedTx", () => {
  beforeEach(() => {
    mockGetAccount.mockResolvedValue({ accountId: () => "GSRC" });
  });

  it("returns the prepared transaction's XDR, not the unprepared build", async () => {
    const preparedTx = { toXDR: jest.fn(() => "PREPARED_XDR_WITH_RESOURCE_FEE") };
    mockPrepareTransaction.mockResolvedValue(preparedTx);

    const xdr = await buildPreparedTx("CCONTRACT", "register", [], "GSRC");

    // The built (unprepared) tx must be handed to prepareTransaction so the
    // Soroban resource fee and footprint get attached — the XDR returned
    // must be the *prepared* result, not the raw build() output.
    expect(mockPrepareTransaction).toHaveBeenCalledWith(mockBuiltTx);
    expect(xdr).toBe("PREPARED_XDR_WITH_RESOURCE_FEE");
    expect(mockBuiltTx.toXDR).not.toHaveBeenCalled();
  });

  it("propagates a simulation failure from prepareTransaction", async () => {
    mockPrepareTransaction.mockRejectedValue(
      new Error("Simulation failed: insufficient resource fee")
    );

    await expect(
      buildPreparedTx("CCONTRACT", "register", [], "GSRC")
    ).rejects.toThrow(/insufficient resource fee/i);
  });
});
