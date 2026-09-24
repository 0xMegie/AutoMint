/**
 * Application-wide constants derived from environment variables.
 *
 * All NEXT_PUBLIC_* vars are inlined at build time by Next.js.
 * Non-public vars are only accessible server-side.
 */

/**
 * Soroban RPC endpoints used for transaction simulation and submission.
 *
 * `NEXT_PUBLIC_SOROBAN_RPC_URL` accepts a comma-separated list so the app
 * can fail over between endpoints (#454):
 *
 *   NEXT_PUBLIC_SOROBAN_RPC_URL="https://soroban-testnet.stellar.org,https://backup.example.com"
 *
 * Whitespace around each entry is trimmed and empty entries are dropped;
 * when nothing usable remains the public testnet default is used.
 */
const DEFAULT_SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const parsedRpcUrls = (
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? DEFAULT_SOROBAN_RPC_URL
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

export const SOROBAN_RPC_URLS: string[] =
  parsedRpcUrls.length > 0 ? parsedRpcUrls : [DEFAULT_SOROBAN_RPC_URL];

/** Primary Soroban RPC endpoint — the first entry of {@link SOROBAN_RPC_URLS}. */
export const SOROBAN_RPC_URL = SOROBAN_RPC_URLS[0];

/**
 * Number of consecutive retryable failures against the active endpoint
 * before the client fails over to the next entry in
 * {@link SOROBAN_RPC_URLS} (#454). Defaults to 3; configure via
 * `NEXT_PUBLIC_RPC_FAILOVER_AFTER`.
 */
export const RPC_FAILOVER_AFTER =
  Number(process.env.NEXT_PUBLIC_RPC_FAILOVER_AFTER) || 3;

/** Stellar network passphrase used when signing transactions. */
export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
  "Test SDF Network ; September 2015";

/** Alias kept for backward compatibility. */
export const STELLAR_NETWORK_PASSPHRASE = NETWORK_PASSPHRASE;

/** Human-readable network label, e.g. "TESTNET". */
export const NETWORK = process.env.NEXT_PUBLIC_NETWORK ?? "TESTNET";

/**
 * Public key used as the simulation source for read-only contract calls when
 * no wallet is connected — an anonymous visitor browsing the marketplace or
 * leaderboard still sees active listings and rankings. Must be a real, funded
 * account on the configured network; it is never used to sign or submit a
 * transaction.
 *
 * Configured via {@link NEXT_PUBLIC_SIMULATION_SOURCE} in `.env.local`.
 */
export const ANONYMOUS_READ_SOURCE =
  process.env.NEXT_PUBLIC_SIMULATION_SOURCE ?? "";

/** Horizon URL for account/transaction queries. */
export const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

/** Contract IDs */
export const REGISTRY_CONTRACT_ID =
  process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID ??
  "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX01";

export const BOT_NFT_CONTRACT_ID =
  process.env.NEXT_PUBLIC_BOT_NFT_CONTRACT_ID ??
  "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX02";

export const ACCRUAL_CONTRACT_ID =
  process.env.NEXT_PUBLIC_ACCRUAL_CONTRACT_ID ??
  "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX03";

export const MARKETPLACE_CONTRACT_ID =
  process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID ??
  "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX04";

export const TOKEN_CONTRACT_ID =
  process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ??
  "CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX05";

export const CONTRACT_ADDRESSES = {
  registry: REGISTRY_CONTRACT_ID,
  botNft: BOT_NFT_CONTRACT_ID,
  accrual: ACCRUAL_CONTRACT_ID,
  marketplace: MARKETPLACE_CONTRACT_ID,
  token: TOKEN_CONTRACT_ID,
} as const;

/** Transaction tunables */
export const TX_TIMEOUT = Number(process.env.NEXT_PUBLIC_TX_TIMEOUT) || 30;
export const BASE_FEE = process.env.NEXT_PUBLIC_BASE_FEE ?? "100";

/** Points-to-AMT conversion threshold. */
export const POINTS_PER_AMT = Number(process.env.NEXT_PUBLIC_POINTS_PER_AMT) || 1000;

/** Leaderboard pagination limit. */
export const LEADERBOARD_LIMIT = Number(process.env.NEXT_PUBLIC_LEADERBOARD_LIMIT) || 50;

/** Polling interval when waiting for a transaction to complete (ms). */
export const POLL_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS) || 1000;

/** Tick interval used by the accrual counter (ms). */
export const COUNTER_TICK_MS = Number(process.env.NEXT_PUBLIC_COUNTER_TICK_MS) || 1000;
