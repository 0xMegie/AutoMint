import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  scValToNative,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import {
  REGISTRY_CONTRACT_ID,
  BOT_NFT_CONTRACT_ID,
  MARKETPLACE_CONTRACT_ID,
  TOKEN_CONTRACT_ID,
  ACCRUAL_CONTRACT_ID,
  BASE_FEE,
  STELLAR_NETWORK_PASSPHRASE,
  ANONYMOUS_READ_SOURCE,
} from "./constants";
import { getServer, simulateContractCall, buildPreparedTx } from "./stellar";
import { withRetry } from "./rpcRetry";
import type { BotNFT, UserProfile, BotTier, MarketplaceListing, AccrualState } from "@/types";

const toBigInt = (v: unknown): bigint =>
  typeof v === "bigint" ? v : BigInt(String(v ?? 0));

/**
 * Resolve the source address used for read-only simulations that have no
 * natural per-user address. Simulations don't sign, so any loadable account
 * works; the connected wallet's public key is the sensible default. A
 * configured {@link ANONYMOUS_READ_SOURCE} lets disconnected visitors still
 * read public data (marketplace listings, leaderboard) before they connect.
 */
function defaultSource(sourceAddress?: string): string {
  if (sourceAddress) return sourceAddress;
  if (typeof window !== "undefined") {
    const win = window as unknown as { selectedPublicKey?: string };
    if (win.selectedPublicKey) return win.selectedPublicKey;
  }
  if (ANONYMOUS_READ_SOURCE) return ANONYMOUS_READ_SOURCE;
  throw new Error("No source address available for contract simulation");
}

/**
 * Build a state-changing transaction that invokes `method(...args)` on
 * `contractId` and return its base64 XDR for the wallet to sign.
 *
 * Delegates to {@link buildPreparedTx}, which simulates the call so the
 * returned XDR carries the correct Soroban resource fee and footprint, not
 * just the BASE_FEE inclusion fee.
 */
async function buildTxXdr(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string
): Promise<string> {
  return buildPreparedTx(contractId, method, args, sourceAddress);
}

/**
 * Parse a raw scVal map from the registry contract into a typed UserProfile.
 * The on-chain struct exposes `total_points`; older shapes used `points`.
 *
 * `address` is carried through so callers can tell whose profile a row is:
 * the leaderboard needs it to render the owner and to match the connected
 * wallet against a row. `scValToNative` renders a Soroban `Address` as its
 * strkey string, so no further decoding is required.
 */
export function parseUserProfile(
  rawData: Record<string, unknown>
): UserProfile {
  const raw = rawData.total_points ?? rawData.points;
  const points = typeof raw === "bigint" ? raw : BigInt(String(raw ?? 0));
  return {
    address: String(rawData.address ?? ""),
    username: String(rawData.username ?? ""),
    points,
  };
}

/**
 * Parse a raw scVal map from the bot_nft contract into a typed BotNFT.
 * Handles the tier enum being returned as a string, array, or object.
 */
export function parseBotNFT(rawData: Record<string, unknown>): BotNFT {
  let tier: BotTier = "Basic";

  // Handle tier as string
  if (typeof rawData.tier === "string") {
    tier = rawData.tier as BotTier;
  }
  // Handle tier as array (variant index + name)
  else if (Array.isArray(rawData.tier)) {
    const tierName = rawData.tier[1] ?? rawData.tier[0];
    if (typeof tierName === "string") {
      tier = tierName as BotTier;
    }
  }
  // Handle tier as object with variant property
  else if (typeof rawData.tier === "object" && rawData.tier !== null) {
    const tierObj = rawData.tier as Record<string, unknown>;
    tier = (tierObj.variant ?? tierObj.tag ?? "Basic") as BotTier;
  }

  return {
    id: toBigInt(rawData.id),
    name: String(rawData.name ?? ""),
    owner: String(rawData.owner ?? ""),
    tier,
    accrual_rate: toBigInt(rawData.accrual_rate),
    minted_at: Number(rawData.minted_at ?? 0),
    last_claim_timestamp: toBigInt(rawData.last_claim_timestamp),
  };
}

/**
 * Parse a raw scVal map from the marketplace contract into a typed MarketplaceListing.
 */
export function parseListing(
  rawData: Record<string, unknown>
): MarketplaceListing {
  return {
    id: toBigInt(rawData.id),
    seller: String(rawData.seller ?? ""),
    bot_id: toBigInt(rawData.bot_id),
    price: toBigInt(rawData.price),
    listed_at: toBigInt(rawData.listed_at),
  };
}

/**
 * Get the AMT token balance for a user.
 * Calls token contract's balance() function.
 */
export async function getAmtBalance(userAddress: string): Promise<bigint> {
  const balance = await simulateContractCall(
    TOKEN_CONTRACT_ID,
    "balance",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress
  );
  return toBigInt(balance);
}

/**
 * List a bot on the marketplace.
 * Transfers bot to marketplace contract and creates listing.
 */
export async function listBot(
  userAddress: string,
  botId: bigint,
  price: bigint
): Promise<string> {
  return buildTxXdr(
    MARKETPLACE_CONTRACT_ID,
    "list_bot",
    [
      nativeToScVal(botId, { type: "u128" }),
      nativeToScVal(price, { type: "u128" }),
    ],
    userAddress
  );
}

/**
 * Buy a bot from the marketplace.
 * Transfers AMT tokens to seller and bot to buyer.
 */
export async function buyBot(address: string, listingId: bigint): Promise<string> {
  return buildTxXdr(
    MARKETPLACE_CONTRACT_ID,
    "buy_bot",
    [nativeToScVal(listingId, { type: "u128" })],
    address
  );
}

/**
 * Fetch the leaderboard of top users by points.
 */
export async function getLeaderboard(
  limit: number = 50,
  sourceAddress?: string
): Promise<UserProfile[]> {
  const raw = await simulateContractCall(
    REGISTRY_CONTRACT_ID,
    "get_leaderboard",
    [nativeToScVal(limit, { type: "u32" })],
    defaultSource(sourceAddress)
  );
  if (!Array.isArray(raw)) return [];
  return raw.map((entry: Record<string, unknown>) => parseUserProfile(entry));
}

/**
 * The registry's `get_rank` returns `u32::MAX` for a user who sits below the
 * ranked cutoff. Treated as "unranked", never as a position.
 */
export const UNRANKED_SENTINEL = 4_294_967_295;

/**
 * How many leaderboard rows `getUserRank` scans to place a user itself.
 * Anyone inside this window is ranked without a second contract call, and
 * the row directly above them supplies the "points to next position" gap.
 */
const RANK_WINDOW = 500;

/** Where a single user stands on the leaderboard. */
export interface UserRank {
  address: string;
  username: string;
  /** 1-based position, or `null` when the user holds no ranked position. */
  rank: number | null;
  points: bigint;
  /**
   * Points needed to draw level with the position immediately above.
   * `null` at rank 1, and whenever the neighbour above is not known.
   */
  pointsToNextRank: bigint | null;
}

/**
 * Ask the registry directly where a user stands (AM-052's `get_rank`).
 *
 * Returns `null` — never throws — when the user is unranked, when they are
 * not registered, or when the deployed registry predates `get_rank`. The
 * caller falls back to deriving the rank from the leaderboard ordering,
 * which is the same ordering `get_rank` reports.
 */
async function getRegistryRank(
  userAddress: string,
  sourceAddress: string
): Promise<number | null> {
  try {
    const raw = await simulateContractCall(
      REGISTRY_CONTRACT_ID,
      "get_rank",
      [nativeToScVal(userAddress, { type: "address" })],
      sourceAddress
    );
    const rank = Number(raw);
    if (!Number.isInteger(rank) || rank <= 0 || rank >= UNRANKED_SENTINEL) {
      return null;
    }
    return rank;
  } catch {
    return null;
  }
}

/**
 * Resolve the connected user's own leaderboard standing.
 *
 * Returns `null` when there is nothing to show — an unregistered address
 * has no profile and therefore no position to pin.
 */
export async function getUserRank(
  userAddress: string,
  sourceAddress?: string
): Promise<UserRank | null> {
  const source = sourceAddress ?? userAddress;
  const board = await getLeaderboard(RANK_WINDOW, source);
  const index = board.findIndex((entry) => entry.address === userAddress);
  const self = index >= 0 ? board[index] : undefined;

  if (self) {
    const above = index > 0 ? board[index - 1] : undefined;
    return {
      address: self.address,
      username: self.username,
      rank: index + 1,
      points: self.points,
      pointsToNextRank: above ? above.points - self.points : null,
    };
  }

  // Below the scanned window: the contract is the only source for the
  // position, and the user's own profile for their points.
  const [rank, profile] = await Promise.all([
    getRegistryRank(userAddress, source),
    getUserProfile(userAddress).catch(() => null),
  ]);

  if (!profile) return null;

  return {
    address: profile.address || userAddress,
    username: profile.username,
    rank,
    points: profile.points,
    pointsToNextRank: null,
  };
}

/**
 * Mint a bot of a specific tier.
 */
export async function mintTierBot(address: string, tier: string, token: string): Promise<string> {
  return buildTxXdr(
    BOT_NFT_CONTRACT_ID,
    "mint",
    [
      nativeToScVal(address, { type: "address" }),
      nativeToScVal(tier, { type: "symbol" }),
      nativeToScVal(token, { type: "string" }),
    ],
    address
  );
}

/**
 * Cancel a marketplace listing.
 * Returns the bot to the seller's wallet.
 */
export async function cancelListing(
  userAddress: string,
  listingId: bigint
): Promise<string> {
  return buildTxXdr(
    MARKETPLACE_CONTRACT_ID,
    "cancel_listing",
    [nativeToScVal(listingId, { type: "u128" })],
    userAddress
  );
}

/**
 * Get all active marketplace listings.
 * Returns array of listing objects.
 */
export async function getActiveListings(
  start: number = 0,
  limit: number = 100,
  sourceAddress?: string
): Promise<MarketplaceListing[]> {
  const listingsRaw = await simulateContractCall(
    MARKETPLACE_CONTRACT_ID,
    "get_active_listings",
    [
      nativeToScVal(start, { type: "u64" }),
      nativeToScVal(limit, { type: "u32" }),
    ],
    defaultSource(sourceAddress)
  );
  if (!Array.isArray(listingsRaw)) return [];
  return listingsRaw.map((listing: Record<string, unknown>) => parseListing(listing));
}

/**
 * Get marketplace listings for a specific user.
 * Returns array of listings where user is the seller.
 */
export async function getUserListings(
  userAddress: string
): Promise<MarketplaceListing[]> {
  const listingsRaw = await simulateContractCall(
    MARKETPLACE_CONTRACT_ID,
    "get_user_listings",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress
  );
  if (!Array.isArray(listingsRaw)) return [];
  return listingsRaw.map((listing: Record<string, unknown>) => parseListing(listing));
}

/**
 * Check whether an address is registered in the registry contract.
 * Read-only simulation of the registry's `is_registered` method.
 */
export async function isRegistered(userAddress: string): Promise<boolean> {
  const result = await simulateContractCall(
    REGISTRY_CONTRACT_ID,
    "is_registered",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress
  );
  return Boolean(result);
}

/**
 * Get the total number of registered users from the registry contract.
 * Read-only simulation of the registry's `total_users` method.
 */
export async function getTotalUsers(sourceAddress?: string): Promise<number> {
  const result = await simulateContractCall(
    REGISTRY_CONTRACT_ID,
    "total_users",
    [],
    defaultSource(sourceAddress)
  );
  return Number(result ?? 0);
}

/**
 * Register a user in the registry contract.
 * State-changing — returns an XDR for the wallet to sign.
 */
export async function registerUser(userAddress: string, username: string): Promise<string> {
  return buildTxXdr(
    REGISTRY_CONTRACT_ID,
    "register",
    [
      nativeToScVal(userAddress, { type: "address" }),
      nativeToScVal(username, { type: "string" }),
    ],
    userAddress
  );
}

/**
 * Mint a basic bot from the bot_nft contract.
 */
export async function mintBasicBot(userAddress: string): Promise<string> {
  return buildTxXdr(
    BOT_NFT_CONTRACT_ID,
    "mint_basic",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress
  );
}

/**
 * Start accrual for a user in the accrual contract.
 */
export async function startAccrual(userAddress: string, rate: number): Promise<string> {
  return buildTxXdr(
    ACCRUAL_CONTRACT_ID,
    "start_accrual",
    [
      nativeToScVal(userAddress, { type: "address" }),
      nativeToScVal(rate, { type: "u32" }),
    ],
    userAddress
  );
}

/**
 * Get accrual state for a user from the accrual contract.
 */
export async function getAccrualState(userAddress: string): Promise<AccrualState | null> {
  const stateRaw = (await simulateContractCall(
    ACCRUAL_CONTRACT_ID,
    "get_accrual_state",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress
  )) as Record<string, unknown> | null;

  if (!stateRaw) return null;

  return {
    last_claim_ts: toBigInt(stateRaw.last_claim_ts),
    total_claimed_points: toBigInt(stateRaw.total_claimed_points),
  };
}

/**
 * Get pending (unclaimed) points accrued for a user since their last claim.
 * Calls the accrual contract's pending_points() function.
 */
export async function getPendingPoints(userAddress: string): Promise<bigint> {
  const server = getServer();
  const contract = new Contract(ACCRUAL_CONTRACT_ID);

  const tx = new TransactionBuilder(
    await server.getAccount(userAddress),
    { fee: BASE_FEE, networkPassphrase: STELLAR_NETWORK_PASSPHRASE }
  )
    .addOperation(contract.call("pending_points", nativeToScVal(userAddress, { type: "address" })))
    .setTimeout(30)
    .build();

  const result = await withRetry(() => server.simulateTransaction(tx));

  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`Simulation error fetching pending points: ${result.error}`);
  }

  if (!result.result?.retval) {
    return BigInt(0);
  }

  return toBigInt(scValToNative(result.result.retval));
}

/**
 * Claim accrued points, converting them to AMT tokens where the points
 * threshold is met. Calls the accrual contract's claim() function.
 */
export async function claimPoints(userAddress: string): Promise<string> {
  return buildTxXdr(
    ACCRUAL_CONTRACT_ID,
    "claim",
    [
      nativeToScVal(userAddress, { type: "address" }),
      nativeToScVal(TOKEN_CONTRACT_ID, { type: "address" }),
      nativeToScVal(REGISTRY_CONTRACT_ID, { type: "address" }),
    ],
    userAddress
  );
}

/**
 * Get user profile from the registry contract.
 */
export async function getUserProfile(userAddress: string): Promise<UserProfile | null> {
  const profileRaw = (await simulateContractCall(
    REGISTRY_CONTRACT_ID,
    "get_user",
    [nativeToScVal(userAddress, { type: "address" })],
    userAddress
  )) as Record<string, unknown> | null;

  if (!profileRaw) return null;
  return parseUserProfile(profileRaw);
}

/**
 * Get the list of bot IDs owned by a user from the bot_nft contract.
 */
export async function getUserBots(userAddress: string): Promise<bigint[]> {
  const server = getServer();
  const contract = new Contract(BOT_NFT_CONTRACT_ID);

  const tx = new TransactionBuilder(
    await server.getAccount(userAddress),
    { fee: BASE_FEE, networkPassphrase: STELLAR_NETWORK_PASSPHRASE }
  )
    .addOperation(contract.call("get_user_bots", nativeToScVal(userAddress, { type: "address" })))
    .setTimeout(30)
    .build();

  const result = await withRetry(() => server.simulateTransaction(tx));

  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`Simulation error fetching user bots: ${result.error}`);
  }

  if (!result.result?.retval) {
    return [];
  }

  const raw = scValToNative(result.result.retval);
  if (!Array.isArray(raw)) return [];

  return raw.map((id) => toBigInt(id));
}

/**
 * Get a single bot's full record by ID from the bot_nft contract.
 */
export async function getBotById(
  userAddress: string,
  botId: bigint
): Promise<BotNFT | null> {
  const server = getServer();
  const contract = new Contract(BOT_NFT_CONTRACT_ID);

  const tx = new TransactionBuilder(
    await server.getAccount(userAddress),
    { fee: BASE_FEE, networkPassphrase: STELLAR_NETWORK_PASSPHRASE }
  )
    .addOperation(contract.call("get_bot", nativeToScVal(botId, { type: "u64" })))
    .setTimeout(30)
    .build();

  const result = await withRetry(() => server.simulateTransaction(tx));

  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`Simulation error fetching bot #${botId.toString()}: ${result.error}`);
  }

  if (!result.result?.retval) {
    return null;
  }

  const raw = scValToNative(result.result.retval);
  if (!raw) return null;

  return parseBotNFT(raw as Record<string, unknown>);
}

/**
 * Get a user's combined accrual rate across all owned bots from the
 * bot_nft contract.
 */
export async function getUserTotalRate(userAddress: string): Promise<bigint> {
  const server = getServer();
  const contract = new Contract(BOT_NFT_CONTRACT_ID);

  const tx = new TransactionBuilder(
    await server.getAccount(userAddress),
    { fee: BASE_FEE, networkPassphrase: STELLAR_NETWORK_PASSPHRASE }
  )
    .addOperation(contract.call("get_user_total_rate", nativeToScVal(userAddress, { type: "address" })))
    .setTimeout(30)
    .build();

  const result = await withRetry(() => server.simulateTransaction(tx));

  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`Simulation error fetching user total rate: ${result.error}`);
  }

  if (!result.result?.retval) {
    return BigInt(0);
  }

  return toBigInt(scValToNative(result.result.retval));
}
