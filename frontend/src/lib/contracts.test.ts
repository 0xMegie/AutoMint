import {
  parseListing,
  parseUserProfile,
  parseBotNFT,
  toBigInt,
  toBigIntOr,
} from "./contracts";

describe("parse helpers in contracts.ts", () => {
  describe("parseUserProfile", () => {
    it("should parse raw user profile data correctly with all six fields", () => {
      const rawData = {
        address: "GALICE",
        username: "alice",
        total_points: "150",
        claimed_amt: "10",
        registered_at: 1700000000,
        bot_count: 2,
      };

      const result = parseUserProfile(rawData);

      expect(result).toEqual({
        address: "GALICE",
        username: "alice",
        total_points: 150n,
        points: 150n,
        claimed_amt: 10n,
        claimedAmt: 10n,
        registered_at: 1700000000,
        registeredAt: 1700000000,
        bot_count: 2,
        botCount: 2,
      });
    });

    it("parses correctly with bigint total_points", () => {
      const raw = {
        address: "GALICE",
        username: "alice",
        total_points: 100n,
        claimed_amt: 0n,
        registered_at: 0,
        bot_count: 0,
      };
      const parsed = parseUserProfile(raw);
      expect(parsed.total_points).toBe(100n);
      expect(parsed.points).toBe(100n);
    });

    it("parses correctly with number total_points", () => {
      const raw = {
        address: "GBOB",
        username: "bob",
        total_points: 50,
        claimed_amt: 5,
        registered_at: 100,
        bot_count: 1,
      };
      const parsed = parseUserProfile(raw);
      expect(parsed.total_points).toBe(50n);

      // A profile shape with no address still parses; the field is an empty
      // string rather than undefined so consumers never branch on it.
      expect(
        parseUserProfile({
          username: "bob",
          total_points: 50,
          claimed_amt: 0,
          registered_at: 0,
          bot_count: 0,
        }).address
      ).toBe("");
    });

    it("throws naming the field when total_points is absent (#484)", () => {
      expect(() => parseUserProfile({ address: "G", username: "u" } as any)).toThrow(
        /"total_points"/
      );
    });

    it("defaults claimed_amt when absent (backward compatible)", () => {
      const parsed = parseUserProfile({
        address: "G",
        username: "u",
        total_points: 0,
      } as any);
      expect(parsed.claimed_amt).toBe(0n);
      expect(parsed.claimedAmt).toBe(0n);
    });

    it("deletes the legacy points fallback (no points field)", () => {
      const raw = {
        address: "GALICE",
        username: "alice",
        total_points: 150n,
        claimed_amt: 0n,
        registered_at: 0,
        bot_count: 0,
        points: 999n, // legacy field should be ignored
      };
      const parsed = parseUserProfile(raw as any);
      // Should use total_points, not points, so legacy 999 is ignored
      expect(parsed.total_points).toBe(150n);
      expect(parsed.points).toBe(150n);
    });

    it("exposes camelCase aliases for UI compatibility", () => {
      const raw = {
        address: "GTEST",
        username: "tester",
        total_points: 42n,
        claimed_amt: 7n,
        registered_at: 1234567890,
        bot_count: 3,
      };
      const parsed = parseUserProfile(raw);
      expect(parsed.claimedAmt).toBe(7n);
      expect(parsed.registeredAt).toBe(1234567890);
      expect(parsed.botCount).toBe(3);
    });
  });

  describe("parseBotNFT", () => {
    const baseRaw = {
      id: 1n,
      name: "Bot1",
      owner: "GBDUJF...",
      accrual_rate: 10n,
      minted_at: 123456789,
      last_claim_timestamp: 123456789n,
    };

    // Real simulation fixture: tier as ScVec([ScSymbol("Gold")]) decodes to ["Gold"]
    // via scValToNative. This is the sole shape we accept; string "Gold" is also
    // accepted as the spec-aware generated client decodes the same enum directly
    // to its string name.
    const realBotFixture: Record<string, unknown> = {
      id: 42n,
      name: "Gold Bot",
      owner: "GBDUJFNDCXMOAY654HWWDVOHGGCL4NZIAXGXDF4WODNUMUPTIGULZTN2",
      tier: ["Gold"],
      accrual_rate: 100n,
      minted_at: 1700000000,
      last_claim_timestamp: 1700000000n,
      variant: 3,
      bonus_bps: 123,
    };

    it("should parse raw bot NFT data correctly with string tier", () => {
      const rawData = {
        id: 10,
        name: "Bot #10",
        owner: "GXYZ987654321",
        tier: "Gold",
        accrual_rate: "50",
        minted_at: 1690000000,
        last_claim_timestamp: "1690005000",
      };

      const result = parseBotNFT(rawData);

      expect(result).toEqual({
        id: 10n,
        name: "Bot #10",
        owner: "GXYZ987654321",
        tier: "Gold",
        accrual_rate: 50n,
        minted_at: 1690000000,
        last_claim_timestamp: 1690005000n,
      });
    });

    it("parses tier as array-wrapped string from real simulation", () => {
      const parsed = parseBotNFT({ ...baseRaw, tier: ["Gold"] });
      expect(parsed.tier).toBe("Gold");
    });

    it("decodes all five tiers correctly from real response shape", () => {
      (["Basic", "Bronze", "Silver", "Gold", "Diamond"] as const).forEach((t) => {
        const parsed = parseBotNFT({ ...baseRaw, tier: [t] });
        expect(parsed.tier).toBe(t);
      });
      // String shape from generated client is also accepted
      (["Basic", "Bronze", "Silver", "Gold", "Diamond"] as const).forEach((t) => {
        const parsed = parseBotNFT({ ...baseRaw, tier: t });
        expect(parsed.tier).toBe(t);
      });
    });

    it("parses real bot fixture from simulation and round-trips tier", () => {
      const parsed = parseBotNFT(realBotFixture);
      expect(parsed.tier).toBe("Gold");
      expect(parsed.id).toBe(42n);
      expect(parsed.accrual_rate).toBe(100n);
      // Fixture's tier round-trips
      expect(parsed.tier).toBe(realBotFixture.tier[0]);
    });

    it("throws on unrecognized tier instead of silently defaulting to Basic", () => {
      expect(() => parseBotNFT({ ...baseRaw, tier: ["UnknownTier"] })).toThrow(
        /unrecognized tier/
      );
      expect(() => parseBotNFT({ ...baseRaw, tier: "UnknownTier" })).toThrow(
        /unrecognized tier/
      );
      expect(() => parseBotNFT({ ...baseRaw, tier: { variant: "Pro" } as any })).toThrow(
        /unexpected tier shape/
      );
      expect(() => parseBotNFT({ ...baseRaw, tier: { foo: "bar" } as any })).toThrow(
        /unexpected tier shape/
      );
      expect(() => parseBotNFT({ ...baseRaw, tier: [0, "Enterprise"] as any })).toThrow(
        /unexpected tier shape/
      );
    });

    it("throws naming the field when required fields are missing (#484)", () => {
      // Provide tier so the parser reaches the id/accrual_rate checks, not tier shape
      expect(() => parseBotNFT({} as any)).toThrow(/unexpected tier shape/);
      expect(() => parseBotNFT({ tier: ["Basic"] } as any)).toThrow(/"id"/);
      expect(() => parseBotNFT({ id: 1n, tier: ["Basic"] } as any)).toThrow(
        /"accrual_rate"/
      );
    });

    it("defaults the genuinely optional fields via toBigIntOr (#484)", () => {
      const parsed = parseBotNFT({
        id: 1n,
        name: "Bot",
        owner: "GOWNER",
        tier: ["Basic"],
        accrual_rate: 1n,
        // minted_at and last_claim_timestamp intentionally absent
      });
      expect(parsed.minted_at).toBe(0);
      expect(parsed.last_claim_timestamp).toBe(0n);
    });
  });

  describe("parseListing", () => {
    it("should parse a valid raw marketplace listing map into a MarketplaceListing object", () => {
      const rawData = {
        id: "1",
        seller: "GABC1234567890",
        bot_id: 42,
        price: "1000000000",
        listed_at: 1700000000n,
      };

      const result = parseListing(rawData);

      expect(result).toEqual({
        id: 1n,
        seller: "GABC1234567890",
        bot_id: 42n,
        price: 1000000000n,
        listed_at: 1700000000n,
      });
    });

    it("throws naming the field when a required field is missing (#484)", () => {
      expect(() => parseListing({})).toThrow(/"id"/);
      expect(() => parseListing({ id: 1n })).toThrow(/"bot_id"/);
    });
  });
});

// ---------------------------------------------------------------------------
// toBigInt / toBigIntOr (#484)
// ---------------------------------------------------------------------------
describe("toBigInt (#484)", () => {
  it("accepts a bigint", () => {
    expect(toBigInt(42n, "value")).toBe(42n);
  });

  it("accepts an integral number", () => {
    expect(toBigInt(42, "value")).toBe(42n);
    expect(toBigInt(0, "value")).toBe(0n);
    expect(toBigInt(-7, "value")).toBe(-7n);
  });

  it("accepts a base-10 integer string", () => {
    expect(toBigInt("42", "value")).toBe(42n);
    expect(toBigInt("-42", "value")).toBe(-42n);
    expect(toBigInt("18446744073709551615", "value")).toBe(
      18446744073709551615n
    );
  });

  it("throws naming the field when the value is missing", () => {
    expect(() => toBigInt(undefined, "phantom")).toThrow(/"phantom"/);
    expect(() => toBigInt(null, "phantom")).toThrow(/"phantom"/);
    expect(() => toBigInt(undefined, "phantom")).toThrow(/missing/);
  });

  it("throws naming the field for garbage that String() would stringify", () => {
    expect(() => toBigInt({}, "phantom")).toThrow(/"phantom"/);
    expect(() => toBigInt("[object Object]", "phantom")).toThrow(/"phantom"/);
    expect(() => toBigInt(true, "phantom")).toThrow(/"phantom"/);
    expect(() => toBigInt(1.5, "phantom")).toThrow(/"phantom"/);
    expect(() => toBigInt(10n ** 30n, "phantom")).not.toThrow();
  });
});

describe("toBigIntOr (#484)", () => {
  it("returns the explicit fallback when the field is absent", () => {
    expect(toBigIntOr(undefined, 7n, "opt")).toBe(7n);
    expect(toBigIntOr(null, 7n, "opt")).toBe(7n);
  });

  it("converts present values through toBigInt", () => {
    expect(toBigIntOr(9, 7n, "opt")).toBe(9n);
    expect(toBigIntOr("9", 7n, "opt")).toBe(9n);
    expect(toBigIntOr(0n, 7n, "opt")).toBe(0n);
  });

  it("still throws for present-but-garbage values, naming the field", () => {
    expect(() => toBigIntOr("garbage", 7n, "opt")).toThrow(/"opt"/);
    expect(() => toBigIntOr({}, 7n, "opt")).toThrow(/"opt"/);
    expect(() => toBigIntOr(1.5, 7n, "opt")).toThrow(/"opt"/);
  });
});
