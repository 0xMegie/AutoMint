/**
 * Unit tests for types/index.ts helper functions (#239)
 * Tests tierFromIndex, formatPoints, xlmToStroops, stroopsToXlm for correctness
 * at normal and boundary values (0, max tier index, large bigints).
 */

import {
  tierFromIndex,
  formatPoints,
  xlmToStroops,
  stroopsToXlm,
  BOT_TIER_NAMES,
  BOT_TIER_COLORS,
  BOT_TIER_BG_COLORS,
  TIER_META,
} from "../index";

describe("types/index.ts Helpers (#239)", () => {
  describe("tierFromIndex", () => {
    it("returns correct tier for standard valid indices", () => {
      expect(tierFromIndex(0)).toBe("Basic");
      expect(tierFromIndex(1)).toBe("Bronze");
      expect(tierFromIndex(2)).toBe("Silver");
      expect(tierFromIndex(3)).toBe("Gold");
      expect(tierFromIndex(4)).toBe("Diamond");
    });

    it("clamps at maximum tier index for out-of-bounds large indices", () => {
      expect(tierFromIndex(5)).toBe("Diamond");
      expect(tierFromIndex(10)).toBe("Diamond");
      expect(tierFromIndex(9999)).toBe("Diamond");
    });

    it("handles boundary values and negative indices gracefully", () => {
      expect(tierFromIndex(-1)).toBe("Basic");
      expect(tierFromIndex(NaN as any)).toBe("Basic");
    });
  });

  describe("formatPoints", () => {
    it("formats 0 points correctly", () => {
      expect(formatPoints(0n)).toBe("0");
    });

    it("formats small and typical point amounts with comma separators", () => {
      expect(formatPoints(100n)).toBe("100");
      expect(formatPoints(1000n)).toBe("1,000");
      expect(formatPoints(25000n)).toBe("25,000");
      expect(formatPoints(1234567n)).toBe("1,234,567");
    });

    it("formats very large bigint values correctly", () => {
      expect(formatPoints(1_000_000_000n)).toBe("1,000,000,000");
      expect(formatPoints(987_654_321_000n)).toBe("987,654,321,000");
      expect(formatPoints(10_000_000_000_000n)).toBe("10,000,000,000,000");
    });
  });

  describe("xlmToStroops", () => {
    it("converts 0 XLM to 0n stroops", () => {
      expect(xlmToStroops(0)).toBe(0n);
      expect(xlmToStroops("0")).toBe(0n);
    });

    it("converts 1 XLM to 10,000,000n stroops", () => {
      expect(xlmToStroops(1)).toBe(10_000_000n);
      expect(xlmToStroops("1")).toBe(10_000_000n);
    });

    it("converts fractional XLM values correctly", () => {
      expect(xlmToStroops(0.5)).toBe(5_000_000n);
      expect(xlmToStroops(0.0000001)).toBe(1n);
      expect(xlmToStroops("0.0000001")).toBe(1n);
      expect(xlmToStroops("12.3456789")).toBe(123_456_789n);
    });

    it("converts large XLM amounts to bigints without overflow", () => {
      expect(xlmToStroops(100_000)).toBe(1_000_000_000_000n);
      expect(xlmToStroops(5_000_000)).toBe(50_000_000_000_000n);
    });
  });

  describe("stroopsToXlm", () => {
    it("converts 0n stroops to 0 XLM", () => {
      expect(stroopsToXlm(0n)).toBe(0);
    });

    it("converts 10,000,000n stroops to 1 XLM", () => {
      expect(stroopsToXlm(10_000_000n)).toBe(1);
    });

    it("converts fractional stroops to exact decimal XLM values", () => {
      expect(stroopsToXlm(5_000_000n)).toBe(0.5);
      expect(stroopsToXlm(1n)).toBe(0.0000001);
      expect(stroopsToXlm(123_456_789n)).toBe(12.3456789);
    });

    it("converts large bigint stroops amounts correctly", () => {
      expect(stroopsToXlm(1_000_000_000_000n)).toBe(100_000);
      expect(stroopsToXlm(50_000_000_000_000n)).toBe(5_000_000);
    });

    it("round-trips between XLM and stroops accurately", () => {
      const testValues = [0, 0.0000001, 0.5, 1, 5, 40, 100, 2500.5, 1000000];
      for (const xlm of testValues) {
        const stroops = xlmToStroops(xlm);
        const backToXlm = stroopsToXlm(stroops);
        expect(backToXlm).toBeCloseTo(xlm, 7);
      }
    });
  });

  describe("Tier metadata and styling dictionaries", () => {
    it("defines valid metadata and colors for all 5 tiers", () => {
      const tiers = ["Basic", "Bronze", "Silver", "Gold", "Diamond"] as const;
      for (const tier of tiers) {
        expect(BOT_TIER_NAMES[tier]).toBe(tier);
        expect(BOT_TIER_COLORS[tier]).toBeDefined();
        expect(BOT_TIER_BG_COLORS[tier]).toBeDefined();
        expect(TIER_META[tier]).toBeDefined();
        expect(TIER_META[tier].rate).toBeGreaterThan(0);
        expect(typeof TIER_META[tier].price).toBe("number");
        expect(TIER_META[tier].emoji).toBeDefined();
      }
    });
  });
});
