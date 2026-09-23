/**
 * Shared TypeScript types for the AutoMint frontend.
 */

export type BotTier = "Basic" | "Bronze" | "Silver" | "Gold" | "Diamond";
export type Tier = BotTier;

export interface UserProfile {
  /** Wallet address the profile belongs to. Always present — `parseUserProfile`
   *  reads it from the registry's `UserProfile.address` field. */
  address: string;
  username: string;
  points: bigint;
  botCount?: number;
  claimedAmt?: bigint;
  registeredAt?: number;
}

export interface BotNFT {
  id: bigint;
  name: string;
  owner: string;
  tier: BotTier;
  accrual_rate: bigint;
  minted_at: number;
  last_claim_timestamp: bigint;
}

export interface MarketplaceListing {
  id: bigint;
  seller: string;
  bot_id: bigint;
  price: bigint;
  listed_at: bigint;
}

export type Listing = MarketplaceListing;

export interface UserVault {
  user: string;
  balance: bigint;
}

export const BOT_TIER_NAMES: Record<BotTier, string> = {
  Basic: "Basic",
  Bronze: "Bronze",
  Silver: "Silver",
  Gold: "Gold",
  Diamond: "Diamond",
};

export const BOT_TIER_COLORS: Record<BotTier, string> = {
  Basic: "text-tier-basic",
  Bronze: "text-tier-bronze",
  Silver: "text-tier-silver",
  Gold: "text-tier-gold",
  Diamond: "text-tier-diamond",
};

export const BOT_TIER_BG_COLORS: Record<BotTier, string> = {
  Basic: "bg-tier-basic/20",
  Bronze: "bg-tier-bronze/20",
  Silver: "bg-tier-silver/20",
  Gold: "bg-tier-gold/20",
  Diamond: "bg-tier-diamond/20",
};
export interface AccrualState {
  last_claim_ts: bigint;
  total_claimed_points: bigint;
}

export interface TierMeta {
  color: string;
  rate: number;
  price: number;
  emoji: string;
}

export const TIER_META: Record<BotTier, TierMeta> = {
  Basic: { color: "text-tier-basic", rate: 1, price: 0, emoji: "🤖" },
  Bronze: { color: "text-tier-bronze", rate: 5, price: 500, emoji: "🥉" },
  Silver: { color: "text-tier-silver", rate: 25, price: 2000, emoji: "🥈" },
  Gold: { color: "text-tier-gold", rate: 100, price: 7500, emoji: "🥇" },
  Diamond: { color: "text-tier-diamond", rate: 500, price: 25000, emoji: "💎" },
};

const TIER_ORDER: BotTier[] = ["Basic", "Bronze", "Silver", "Gold", "Diamond"];

export function tierFromIndex(index: number): BotTier {
  return TIER_ORDER[Math.min(index, TIER_ORDER.length - 1)] ?? "Basic";
}

export function formatPoints(points: bigint): string {
  // `Intl` formats a BigInt directly. Going through `Number` first would
  // round away every digit past 2^53, so a large points balance would render
  // a value the contract never held.
  return points.toLocaleString("en-US");
}

export const XLM_DECIMALS = 7;
export const STROOPS_PER_XLM = 10_000_000n;

export function xlmToStroops(xlm: number | string): bigint {
  if (typeof xlm === "string") {
    const trimmed = xlm.trim();
    if (!trimmed || isNaN(Number(trimmed))) return 0n;
    const parts = trimmed.split(".");
    const integerPart = parts[0] ? BigInt(parts[0]) : 0n;
    let fractionStr = parts[1] || "";
    if (fractionStr.length > XLM_DECIMALS) {
      fractionStr = fractionStr.slice(0, XLM_DECIMALS);
    } else {
      fractionStr = fractionStr.padEnd(XLM_DECIMALS, "0");
    }
    const sign = integerPart < 0n || trimmed.startsWith("-") ? -1n : 1n;
    const absInt = integerPart < 0n ? -integerPart : integerPart;
    const fractionPart = BigInt(fractionStr);
    return sign * (absInt * STROOPS_PER_XLM + fractionPart);
  }
  if (typeof xlm === "number") {
    if (isNaN(xlm) || !isFinite(xlm)) return 0n;
    return BigInt(Math.round(xlm * 10_000_000));
  }
  return 0n;
}

export function stroopsToXlm(stroops: bigint): number {
  return Number(stroops) / 10_000_000;
}

export function stroopsToXlmString(stroops: bigint): string {
  const isNegative = stroops < 0n;
  const absStroops = isNegative ? -stroops : stroops;
  const intPart = absStroops / STROOPS_PER_XLM;
  const fracPart = absStroops % STROOPS_PER_XLM;
  if (fracPart === 0n) {
    return `${isNegative ? "-" : ""}${intPart.toString()}`;
  }
  const fracStr = fracPart.toString().padStart(XLM_DECIMALS, "0").replace(/0+$/, "");
  return `${isNegative ? "-" : ""}${intPart.toString()}.${fracStr}`;
}

