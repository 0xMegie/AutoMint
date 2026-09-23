import {
  addressToScVal,
  u64ToScVal,
  u32ToScVal,
  i128ToScVal,
  stringToScVal,
  boolToScVal
} from "./stellar";
import { scValToNative } from "@stellar/stellar-sdk";

describe("ScVal helpers in stellar.ts", () => {
  it("addressToScVal round-trips correctly via scValToNative", () => {
    const address = "GBDUJFNDCXMOAY654HWWDVOHGGCL4NZIAXGXDF4WODNUMUPTIGULZTN2";
    const scVal = addressToScVal(address);
    const native = scValToNative(scVal);
    expect(native).toBe(address);
  });

  it("u64ToScVal round-trips correctly via scValToNative", () => {
    const val = 123456789n;
    const scVal = u64ToScVal(val);
    const native = scValToNative(scVal);
    expect(native).toBe(val);
  });

  it("u32ToScVal round-trips correctly via scValToNative", () => {
    const val = 12345;
    const scVal = u32ToScVal(val);
    const native = scValToNative(scVal);
    expect(native).toBe(val);
  });

  it("i128ToScVal round-trips correctly via scValToNative", () => {
    const val = -12345678901234567890n;
    const scVal = i128ToScVal(val);
    const native = scValToNative(scVal);
    expect(native).toBe(val);
  });

  it("stringToScVal round-trips correctly via scValToNative", () => {
    const val = "hello world";
    const scVal = stringToScVal(val);
    const native = scValToNative(scVal);
    // Note: Soroban strings often decode to Buffer or string depending on SDK versions.
    // The stellar-sdk scValToNative typically decodes string to Buffer or string?
    // We will see what test says. We might need to convert Buffer to string.
    if (Buffer.isBuffer(native)) {
      expect(native.toString("utf-8")).toBe(val);
    } else {
      expect(native).toBe(val);
    }
  });

  it("boolToScVal round-trips correctly via scValToNative", () => {
    expect(scValToNative(boolToScVal(true))).toBe(true);
    expect(scValToNative(boolToScVal(false))).toBe(false);
  });

  describe("u64ToScVal edge cases", () => {
    it("encodes zero correctly", () => {
      const val = 0n;
      const scVal = u64ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });

    it("encodes max safe integer for u64 correctly", () => {
      const val = 18446744073709551615n; // 2^64 - 1
      const scVal = u64ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });

    it("encodes very large bigint correctly", () => {
      const val = 9223372036854775807n; // Max i64
      const scVal = u64ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });
  });

  describe("i128ToScVal edge cases", () => {
    it("encodes zero correctly", () => {
      const val = 0n;
      const scVal = i128ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });

    it("encodes max safe integer for i128 correctly", () => {
      const val = 170141183460469231731687303715884105727n; // 2^127 - 1
      const scVal = i128ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });

    it("encodes min value for i128 correctly", () => {
      const val = -170141183460469231731687303715884105728n; // -2^127
      const scVal = i128ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });

    it("encodes very large negative bigint correctly", () => {
      const val = -9223372036854775808n; // Min i64
      const scVal = i128ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });

    it("encodes very large positive bigint correctly", () => {
      const val = 9223372036854775807n; // Max i64
      const scVal = i128ToScVal(val);
      const native = scValToNative(scVal);
      expect(native).toBe(val);
    });
  });
});
