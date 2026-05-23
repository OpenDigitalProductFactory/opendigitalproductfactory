import { describe, expect, it } from "vitest";

import { assertSafeKey, isSafeKey } from "./safe-property";

describe("isSafeKey", () => {
  it("rejects __proto__", () => {
    expect(isSafeKey("__proto__")).toBe(false);
  });

  it("rejects constructor", () => {
    expect(isSafeKey("constructor")).toBe(false);
  });

  it("rejects prototype", () => {
    expect(isSafeKey("prototype")).toBe(false);
  });

  it("accepts ordinary property names", () => {
    expect(isSafeKey("name")).toBe(true);
    expect(isSafeKey("id")).toBe(true);
    expect(isSafeKey("user-id")).toBe(true);
    expect(isSafeKey("")).toBe(true);
    expect(isSafeKey("0")).toBe(true);
    expect(isSafeKey("constructor_safe")).toBe(true);
    expect(isSafeKey("__proto__suffix")).toBe(true);
  });

  it("is case-sensitive (uppercase variants are safe)", () => {
    // JavaScript property lookup is case-sensitive; PROTOTYPE != prototype.
    expect(isSafeKey("PROTOTYPE")).toBe(true);
    expect(isSafeKey("Constructor")).toBe(true);
    expect(isSafeKey("__PROTO__")).toBe(true);
  });
});

describe("assertSafeKey", () => {
  it("throws on each dangerous key", () => {
    expect(() => assertSafeKey("__proto__")).toThrow(/prototype-polluting/);
    expect(() => assertSafeKey("constructor")).toThrow(/prototype-polluting/);
    expect(() => assertSafeKey("prototype")).toThrow(/prototype-polluting/);
  });

  it("does not throw on safe keys", () => {
    expect(() => assertSafeKey("anything-else")).not.toThrow();
  });
});

describe("Object usage smoke test", () => {
  it("prevents Object.prototype pollution when used as a guard", () => {
    const target: Record<string, unknown> = {};
    const malicious: Record<string, unknown> = JSON.parse(
      '{"__proto__":{"polluted":true},"safe":"value"}',
    );
    for (const [key, value] of Object.entries(malicious)) {
      if (!isSafeKey(key)) continue;
      target[key] = value;
    }
    // The literal "__proto__" key from JSON.parse is an own property, not
    // a real prototype mutation, so this test mainly checks that the guard
    // skips the key. We assert by checking the target shape.
    expect(target).toEqual({ safe: "value" });
    expect(Object.prototype.hasOwnProperty.call(target, "__proto__")).toBe(false);
  });
});
