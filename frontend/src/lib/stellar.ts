import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  scValToNative,
  xdr,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import {
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  getNetwork as freighterGetNetwork,
} from "@stellar/freighter-api";
import { BASE_FEE, SOROBAN_RPC_URL, STELLAR_NETWORK_PASSPHRASE } from "./constants";
import { withRetry } from "./rpcRetry";

/**
 * Module-level singleton — created once, reused on every subsequent call.
 * Keeping a single instance avoids the overhead of re-establishing the
 * HTTP connection on every RPC call.
 */
let _server: SorobanRpc.Server | null = null;

/**
 * Returns a memoized {@link SorobanRpc.Server} pointed at the configured
 * {@link SOROBAN_RPC_URL}.  The instance is created on the first call and
 * the same object is returned on every subsequent call.
 */
export function getServer(): SorobanRpc.Server {
  if (!_server) {
    _server = new SorobanRpc.Server(SOROBAN_RPC_URL, {
      allowHttp: SOROBAN_RPC_URL.startsWith("http://"),
    });
  }
  return _server;
}

/**
 * Heuristic for turning a Freighter API error (or thrown value) into a
 * user-facing message. Freighter v3 returns `{ error: { code, message } }`
 * objects rather than throwing, but older paths / the extension bridge can
 * still throw, so we handle both.
 */
function describeFreighterError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("lock")) {
    return "Your Freighter wallet is locked. Please unlock it and try again.";
  }
  if (
    lower.includes("reject") ||
    lower.includes("denied") ||
    lower.includes("declined") ||
    lower.includes("cancel")
  ) {
    return "Connection request was rejected in Freighter.";
  }
  return message;
}

/**
 * Trigger the Freighter authorization popup and return the connected wallet's
 * public key and network.
 *
 * Throws descriptive {@link Error}s for the common failure modes so the UI can
 * catch and display them:
 * - Freighter extension not installed / not detected
 * - wallet locked
 * - user rejected the access request
 *
 * @returns the connected account's `publicKey` and its `network` label
 */
export async function connectFreighter(): Promise<{
  publicKey: string;
  network: string;
}> {
  // 1. Detect the extension. `isConnected` reports whether Freighter is
  //    installed and reachable in the current browser.
  let connected: { isConnected: boolean; error?: { message: string } };
  try {
    connected = await freighterIsConnected();
  } catch {
    throw new Error(
      "Freighter wallet extension is not installed or could not be detected."
    );
  }
  if (connected?.error || !connected?.isConnected) {
    throw new Error(
      "Freighter wallet extension is not installed or could not be detected."
    );
  }

  // 2. Request access — this opens the authorization popup.
  let access: { address: string; error?: { message: string } };
  try {
    access = await freighterRequestAccess();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(describeFreighterError(msg));
  }
  if (access?.error) {
    throw new Error(describeFreighterError(access.error.message));
  }
  if (!access?.address) {
    throw new Error("Freighter did not return a public key.");
  }

  // 3. Fetch the active network (best-effort).
  let network = "";
  try {
    const net = await freighterGetNetwork();
    if (!net?.error && net?.network) {
      network = net.network;
    }
  } catch {
    // A missing network shouldn't block an otherwise successful connection.
  }

  return { publicKey: access.address, network };
}

/**
 * Read-only contract simulation helper.
 *
 * Builds a transaction that invokes `method(...args)` on `contractId`, submits
 * it to the RPC's `simulateTransaction`, and decodes the return value to a
 * native JS value. No signing or submission occurs, so `sourceAddress` only
 * needs to be a real (loadable) account — it never signs anything.
 *
 * @throws Error when the simulation fails or returns no value.
 */
export async function simulateContractCall(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string
): Promise<unknown> {
  const server = getServer();
  const contract = new Contract(contractId);
  const account = await server.getAccount(sourceAddress);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await withRetry(() => server.simulateTransaction(tx));

  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`Simulation failed for ${method}: ${result.error}`);
  }

  if (!result.result?.retval) {
    throw new Error(`No return value from simulation of ${method}`);
  }

  return scValToNative(result.result.retval);
}

/**
 * Build a state-changing transaction that invokes `method(...args)` on
 * `contractId` and returns its base64 XDR, ready for the wallet to sign.
 *
 * Unlike a bare `TransactionBuilder` fee, `BASE_FEE` alone only covers the
 * classic-operation inclusion fee. Every Soroban invocation also carries a
 * resource fee (CPU instructions, ledger read/write bytes/entries) that
 * varies per contract and per call. `server.prepareTransaction` simulates
 * the call and pads the tx fee with that simulated resource cost — skipped,
 * the resource fee is 0 and the ledger footprint is empty, so the tx is
 * rejected on submission regardless of how high BASE_FEE is set. This
 * applies to every write across all 5 contracts (registry, bot_nft, accrual,
 * marketplace, token), including each leg of the register → mint_basic →
 * start_accrual flow.
 */
export async function buildPreparedTx(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string
): Promise<string> {
  const server = getServer();
  const contract = new Contract(contractId);
  const account = await server.getAccount(sourceAddress);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const prepared = await withRetry(() => server.prepareTransaction(tx));
  return prepared.toXDR();
}

export function addressToScVal(address: string): xdr.ScVal {
  return nativeToScVal(address, { type: "address" });
}

export function u64ToScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

export function u32ToScVal(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

export function i128ToScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

export function stringToScVal(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "string" });
}

export function boolToScVal(value: boolean): xdr.ScVal {
  return nativeToScVal(value, { type: "bool" });
}

/**
 * Fetch the current ledger's close time from the RPC.
 *
 * Returns a Unix timestamp (seconds since epoch) representing when the most
 * recent ledger was closed. Used to compute the client-clock offset so the
 * interpolated accrual counter stays accurate even when the browser clock is
 * skewed (#492).
 */
export async function getLedgerCloseTime(): Promise<number> {
  const server = getServer();
  const ledger = await withRetry(() => server.getLatestLedger());
  return Number(ledger.closeTime);
}
