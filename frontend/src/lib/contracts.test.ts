import {
  parseListing,
  parseUserProfile,
  parseBotNFT,
  toBigInt,
  toBigIntOr,
} from "./contracts";

describe("parse helpers in contracts.ts", () => {
  describe("parseUserProfile", () => {
    it("should parse raw user profile data correctly with total_points or points", () => {
      const rawData = {
        address: "GALICE",
        username: "alice",
        points: "150",
      };

      const result = parseUserProfile(rawData);

      expect(result).toEqual({
        address: "GALICE",
        username: "alice",
        points: 150n,
      });
    });

    it("parses correctly with bigint points", () => {
      const raw = { address: "GALICE", username: "alice", points: 100n };
      const parsed = parseUserProfile(raw);
      expect(parsed).toEqual({ address: "GALICE", username: "alice", points: 100n });
    });

    it("parses correctly with number points", () => {
      const raw = { address: "GBOB", username: "bob", points: 50 };
      const parsed = parseUserProfile(raw);
      expect(parsed).toEqual({ address: "GBOB", username: "bob", points: 50n });

      // A profile shape with no address still parses; the field is an empty
      // string rather than undefined so consumers never branch on it.
      expect(parseUserProfile({ username: "bob", points: 50 }).address).toBe("");
    });

    it("throws naming the field when points are absent (#484)", () => {
      expect(() => parseUserProfile({ address: "G", username: "u" })).toThrow(
        /"total_points"/
      );
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

    it("parses tier as string", () => {
      const parsed = parseBotNFT({ ...baseRaw, tier: "Premium" });
      expect(parsed.tier).toBe("Premium");
    });

    it("parses tier as array", () => {
      const parsed = parseBotNFT({ ...baseRaw, tier: [0, "Enterprise"] });
      expect(parsed.tier).toBe("Enterprise");
    });

    it("parses tier as object with variant", () => {
      const parsed = parseBotNFT({ ...baseRaw, tier: { variant: "Pro" } });
      expect(parsed.tier).toBe("Pro");
    });

    it("parses tier as object with tag", () => {
      const parsed = parseBotNFT({ ...baseRaw, tier: { tag: "Pro" } });
      expect(parsed.tier).toBe("Pro");
    });

    it("defaults to Basic if tier format is unknown", () => {
      const parsed = parseBotNFT({ ...baseRaw, tier: { foo: "bar" } });
      expect(parsed.tier).toBe("Basic");
    });

    it("throws naming the field when required fields are missing (#484)", () => {
      // The old BigInt(String(v ?? 0)) silently produced 0n for an absent
      // field, hiding phantom fields; a missing required field now throws.
      expect(() => parseBotNFT({})).toThrow(/"id"/);
      expect(() => parseBotNFT({ id: 1n })).toThrow(/"accrual_rate"/);
    });

    it("defaults the genuinely optional fields via toBigIntOr (#484)", () => {
      const parsed = parseBotNFT({
        id: 1n,
        name: "Bot",
        owner: "GOWNER",
        tier: "Basic",
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
