import { parseListing, parseUserProfile, parseBotNFT } from "./contracts";

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

    it("parses missing fields gracefully", () => {
      const parsed = parseBotNFT({});
      expect(parsed.id).toBe(0n);
      expect(parsed.name).toBe("");
      expect(parsed.owner).toBe("");
      expect(parsed.tier).toBe("Basic");
      expect(parsed.accrual_rate).toBe(0n);
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

    it("parses missing fields gracefully", () => {
      const parsed = parseListing({});
      expect(parsed.id).toBe(0n);
      expect(parsed.seller).toBe("");
      expect(parsed.bot_id).toBe(0n);
      expect(parsed.price).toBe(0n);
      expect(parsed.listed_at).toBe(0n);
    });
  });
});
