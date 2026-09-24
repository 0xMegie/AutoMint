import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  scValToNative,
  xdr,
  nativeToScVal,
  FeeBumpTransaction,
  Transaction,
} from "@stellar/stellar-sdk";
import { BASE_FEE, TX_TIMEOUT, STELLAR_NETWORK_PASSPHRASE } from "./constants";
import { getServer, rpcCall } from "./stellar";
import { useWalletStore } from "@/store/walletStore";

/**
 * Multiplier applied to the assembled resource fee to add a safety buffer.
 * Configurable via NEXT_PUBLIC_FEE_MULTIPLIER env var (default 1.0).
 */
const FEE_MULTIPLIER = Number(process.env.NEXT_PUBLIC_FEE_MULTIPLIER) || 1.0;

/**
 * Transaction execution status stages reported via onStatus callback.
 */
export type TransactionStage =
  | "building"
  | "simulating"
  | "assembling"
  | "signing"
  | "submitting"
  | "polling"
  | "success"
  | "error";

/**
 * Status report passed to onStatus callback during transaction execution.
 */
export interface TransactionStatus {
  stage: TransactionStage;
  hash?: string | undefined;
  explorerUrl?: string | undefined;
  error?: string | undefined;
}

/**
 * Per-account sequence number tracking to prevent txBAD_SEQ errors on
 * consecutive transactions. Maintains local pending sequence number that
 * increments for each queued transaction, reconciles against RPC after
 * each confirmation.
 */
interface SequenceTracker {
  /** Current sequence number from RPC (may lag by a ledger or two) */
  current: number;
  /** Next sequence number to use (current + number of pending txs) */
  pending: number;
}

/** Track sequence number per account: Map<address, SequenceTracker> */
const sequenceTrackers = new Map<string, SequenceTracker>();

/** Queue of pending transactions per account to serialize submissions */
const transactionQueues = new Map<string, Promise<any>[]>();

/**
 * Get or initialize the sequence tracker for an account.
 */
function getSequenceTracker(address: string): SequenceTracker {
  if (!sequenceTrackers.has(address)) {
    sequenceTrackers.set(address, { current: -1, pending: -1 });
  }
  return sequenceTrackers.get(address)!;
}

/**
 * Get the next sequence number for an account, incrementing the pending count.
 * The first call reads from RPC; subsequent calls increment locally.
 */
async function getNextSequenceNumber(address: string): Promise<number> {
  const tracker = getSequenceTracker(address);

  // First call: read from RPC (idempotent — retried / failed over via rpcCall)
  if (tracker.current === -1) {
    const account = await rpcCall((server) => server.getAccount(address));
    tracker.current = parseInt(account.sequenceNumber(), 10);
    tracker.pending = tracker.current + 1;
  } else {
    // Subsequent calls: increment locally
    tracker.pending += 1;
  }

  return tracker.pending;
}

/**
 * Reconcile sequence tracker after a confirmed transaction.
 * Updates the current sequence number to match the confirmed tx.
 */
function reconcileSequence(address: string, confirmedSequence: number): void {
  const tracker = getSequenceTracker(address);
  tracker.current = confirmedSequence;
  tracker.pending = confirmedSequence + 1;
}

/**
 * Retry a transaction submission if it fails with txBAD_SEQ.
 * Refreshes the account sequence number and re-attempts once.
 */
async function retryOnBadSeq(
  fn: () => Promise<SorobanRpc.Api.SendTransactionResponse>,
  address: string,
  onStatus: (status: TransactionStatus) => void
): Promise<SorobanRpc.Api.SendTransactionResponse> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Check if the error indicates bad sequence
    if (message.includes("txBAD_SEQ")) {
      onStatus({
        stage: "submitting",
        error: "Sequence number conflict, retrying...",
      });

      // Refresh account and reset sequence tracker
      const account = await rpcCall((server) => server.getAccount(address));
      const tracker = getSequenceTracker(address);
      tracker.current = parseInt(account.sequenceNumber(), 10);
      tracker.pending = tracker.current + 1;

      // Retry once — txBAD_SEQ is deterministic (the tx did NOT land), so a
      // single resubmit with the fresh sequence is safe. Transient RPC
      // failures are never retried here (#454: sendTransaction is never
      // automatically retried).
      return fn();
    }

    throw err;
  }
}

/**
 * Queue a function to execute serially per account.
 * Ensures transactions from the same account are submitted in order,
 * preventing nonce/sequence conflicts.
 */
async function queueTransaction<T>(
  address: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!transactionQueues.has(address)) {
    transactionQueues.set(address, []);
  }

  const queue = transactionQueues.get(address)!;
  const promise: Promise<unknown> =
    queue[queue.length - 1] ?? Promise.resolve();

  const result = promise.then(() => fn()).catch((err) => {
    // Keep queue moving even on error
    throw err;
  });

  queue.push(result);

  // Clean up completed promises to avoid memory leak. The .finally chain
  // re-rejects, so swallow on this side branch — the real rejection is
  // still delivered to the caller via `result`.
  result
    .finally(() => {
      const idx = queue.indexOf(result);
      if (idx >= 0) {
        queue.splice(idx, 1);
      }
    })
    .catch(() => {});

  return result;
}

/**
 * Build the transaction explorer URL given a transaction hash.
 */
function getExplorerUrl(hash: string): string {
  // Construct Horizon explorer URL
  // For testnet: https://stellar.expert/explorer/testnet/tx/{hash}
  const network = process.env.NEXT_PUBLIC_NETWORK || "TESTNET";
  const basePath =
    network === "TESTNET" ? "stellar.expert/explorer/testnet" : "stellar.expert/explorer/public";
  return `https://${basePath}/tx/${hash}`;
}

/**
 * Core transaction execution pipeline that:
 * 1. Builds the contract invocation
 * 2. Simulates to get resource fees and footprint
 * 3. Prepares (assembles) the final transaction
 * 4. Requests wallet signature
 * 5. Submits to RPC
 * 6. Polls until confirmed
 * 7. Decodes and returns the contract return value
 *
 * Every stage is observable via the onStatus callback, enabling the UI to
 * show progress and errors. All mutations should wrap this function to
 * provide domain-specific signatures and error handling.
 *
 * Handles sequence number management to support consecutive transactions
 * from the same account without txBAD_SEQ failures. Serializes submissions
 * per account to avoid nonce conflicts.
 *
 * @param contractId - Soroban contract ID
 * @param method - Contract method name
 * @param args - Contract method arguments as ScVal
 * @param sourceAddress - Account submitting the transaction
 * @param onStatus - Callback fired on each stage transition
 * @returns The decoded contract return value
 * @throws Error on simulation, signing, submission, or confirmation failure
 */
export async function executeTransaction({
  contractId,
  method,
  args,
  sourceAddress,
  onStatus,
}: {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  sourceAddress: string;
  onStatus: (status: TransactionStatus) => void;
}): Promise<unknown> {
  let txHash: string = "";

  try {
    // Refuse to build anything while Freighter is on the wrong network
    // (#455): the payload would be signed under a passphrase this app never
    // intended. The flag is kept in the store by the banner's network poll.
    if (useWalletStore.getState().networkMismatch) {
      throw new Error(
        "Freighter is connected to the wrong network. Switch to Testnet and try again."
      );
    }

    // 1. Build the contract invocation
    onStatus({ stage: "building" });
    const contract = new Contract(contractId);

    // Get next sequence number from local tracker (queues transactions)
    const sequenceNum = await queueTransaction(sourceAddress, () =>
      getNextSequenceNumber(sourceAddress)
    );

    const account = await rpcCall((server) => server.getAccount(sourceAddress));
    // Override sequence number to match our client-side tracker
    // This prevents txBAD_SEQ when submitting consecutive transactions
    account.sequenceNumber = () => String(sequenceNum);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(TX_TIMEOUT)
      .build();

    // 2. Prepare (assemble) the final transaction with resource fees
    onStatus({ stage: "assembling" });
    const prepared = await rpcCall((server) => server.prepareTransaction(tx));

    // Apply fee multiplier after assembly
    if (FEE_MULTIPLIER !== 1.0) {
      const baseFeeNum = parseInt(prepared.fee, 10);
      const multipliedFee = Math.ceil(baseFeeNum * FEE_MULTIPLIER).toString();
      prepared.fee = multipliedFee;
    }

    const assembledTx = prepared;

    // 4. Request wallet signature
    onStatus({ stage: "signing" });
    const signedXdr = await signTransaction(assembledTx, sourceAddress);

    // 5. Submit to RPC (serialized per account). sendTransaction is NOT
    // retried automatically (#454): a submission may have landed even if
    // the RPC reported an error, and the endpoint is resolved fresh at
    // submit time so an in-flow failover is picked up.
    onStatus({ stage: "submitting" });
    const submitResult = await queueTransaction(sourceAddress, () =>
      retryOnBadSeq(
        // sendTransaction takes a Transaction object in this SDK — rehydrate
        // the signed XDR before handing it over.
        () =>
          getServer().sendTransaction(
            TransactionBuilder.fromXDR(signedXdr, STELLAR_NETWORK_PASSPHRASE)
          ),
        sourceAddress,
        onStatus
      )
    );

    txHash = submitResult.hash;

    if (submitResult.status === "ERROR") {
      // errorResult is a parsed xdr.TransactionResult — the raw XDR field
      // (errorResultXdr) only exists on the unparsed response shape.
      throw new Error(
        "Transaction submission failed — the network rejected the transaction."
      );
    }

    // 6. Poll for confirmation
    onStatus({
      stage: "polling",
      hash: txHash,
      explorerUrl: getExplorerUrl(txHash),
    });

    const pollResult = await pollTransaction(txHash, sourceAddress);

    if (pollResult.status === "FAILED") {
      throw new Error(`Transaction failed on-chain: ${pollResult.error || "unknown error"}`);
    }

    if (pollResult.status !== "SUCCESS") {
      throw new Error(`Transaction confirmation timeout`);
    }

    // 7. Reconcile sequence number after confirmation
    if (pollResult.sequenceNumber !== undefined) {
      reconcileSequence(sourceAddress, pollResult.sequenceNumber);
    }

    // Report success
    onStatus({
      stage: "success",
      hash: txHash,
      explorerUrl: getExplorerUrl(txHash),
    });

    // Return the decoded contract return value (if available)
    return pollResult.returnValue;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    onStatus({
      stage: "error",
      error: errorMsg,
      hash: txHash,
      explorerUrl: txHash ? getExplorerUrl(txHash) : undefined,
    });
    throw err;
  }
}

/**
 * Request the connected Freighter wallet to sign the transaction.
 * Requires Freighter to be installed and connected.
 */
async function signTransaction(
  tx: Transaction | FeeBumpTransaction,
  _sourceAddress: string
): Promise<string> {
  // Dynamically import Freighter API
  const freighter = await import("@stellar/freighter-api");
  // freigther-api v3 exports signTransaction (not sign) and returns
  // signedTxXdr (not signedTransaction).
  const sign =
    freighter.signTransaction ||
    (freighter as any).default?.signTransaction;

  if (!sign) {
    throw new Error("Freighter API signTransaction not available");
  }

  // Re-check the LIVE wallet network immediately before requesting the
  // signature (#455): Freighter can be switched between the store-level
  // check and here. Fail closed on any error — we never sign a payload we
  // could not verify the destination network for.
  let livePassphrase: string;
  try {
    const network = await freighter.getNetwork();
    if (network?.error) {
      throw new Error(network.error.message || "Could not read wallet network");
    }
    livePassphrase = network.networkPassphrase;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not verify wallet network before signing: ${msg}`);
  }

  if (livePassphrase !== STELLAR_NETWORK_PASSPHRASE) {
    useWalletStore.getState().setNetworkMismatch(true);
    throw new Error(
      "Freighter is connected to the wrong network. Switch to Testnet and try again."
    );
  }
  // Network is correct: clear any stale mismatch flag so the banner and
  // disabled buttons recover without a reload.
  useWalletStore.getState().setNetworkMismatch(false);

  const result = await sign(tx.toXDR(), {
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    address: _sourceAddress,
  });

  if (result.error) {
    throw new Error(result.error.message || "Failed to sign transaction");
  }

  const signedXdr = result.signedTxXdr;
  if (!signedXdr) {
    throw new Error("No signed transaction returned from wallet");
  }

  return signedXdr;
}

/**
 * Poll the RPC for transaction confirmation.
 * Waits until the transaction reaches a final state (SUCCESS or FAILED).
 */
interface PollResult {
  status: "SUCCESS" | "FAILED" | "TIMEOUT";
  returnValue?: unknown;
  sequenceNumber?: number | undefined;
  error?: string | undefined;
}

/**
 * Extract the account sequence number from a confirmed transaction's
 * envelope so the local tracker can be reconciled after success.
 */
function sequenceFromEnvelope(
  envelope: xdr.TransactionEnvelope
): number | undefined {
  try {
    if (envelope.switch() === xdr.EnvelopeType.envelopeTypeTx()) {
      return Number(envelope.v1().tx().seqNum());
    }
    if (envelope.switch() === xdr.EnvelopeType.envelopeTypeTxFeeBump()) {
      return Number(envelope.feeBump().tx().innerTx().v1().tx().seqNum());
    }
  } catch {
    // Malformed/unexpected envelope — leave the tracker untouched.
  }
  return undefined;
}

async function pollTransaction(
  txHash: string,
  _sourceAddress: string
): Promise<PollResult> {
  const pollIntervalMs = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS) || 1000;
  const maxWaitMs = (TX_TIMEOUT + 10) * 1000; // RPC timeout + buffer
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Idempotent read: retried / failed over by rpcCall; a transient
      // error here just falls through to the next poll interval.
      const result = await rpcCall((server) => server.getTransaction(txHash));

      if (result.status === "SUCCESS") {
        // Decode return value if present (it's an XDR ScVal)
        let returnValue: unknown = undefined;
        if (result.returnValue) {
          try {
            returnValue = scValToNative(result.returnValue);
          } catch {
            // If decoding fails, keep it as undefined
          }
        }

        return {
          status: "SUCCESS",
          returnValue,
          sequenceNumber: sequenceFromEnvelope(result.envelopeXdr),
        };
      }

      if (result.status === "FAILED") {
        return {
          status: "FAILED",
          // resultXdr is a parsed xdr.TransactionResult object — a generic
          // message beats stringifying it to "[object Object]".
          error: "Contract execution failed",
        };
      }

      // PENDING or NOT_FOUND: wait and retry
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (err) {
      // RPC error: retry
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  return { status: "TIMEOUT", error: "Transaction confirmation timeout" };
}
