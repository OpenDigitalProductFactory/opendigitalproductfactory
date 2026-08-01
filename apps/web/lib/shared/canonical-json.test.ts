import { describe, expect, it } from "vitest";

import { canonicalJson } from "./canonical-json";

describe("canonicalJson is stable regardless of key order", () => {
  it("produces identical output for the same object built two ways", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("sorts nested objects too", () => {
    expect(canonicalJson({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it("never reorders arrays — array order is semantic", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("canonicalJson sorts by code unit, not locale", () => {
  // The reason this module exists. `localeCompare` resolves against the host's default
  // locale and ICU data, so the same input can canonicalise differently on two machines —
  // which turns a signature mismatch into a false tampering signal (BI-2F318FB3).
  it("orders uppercase before lowercase, as code units do", () => {
    // Under many locales `a` sorts before `B`; by code unit `B` (0x42) precedes `a` (0x61).
    expect(canonicalJson({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
  });

  it("gives the same answer as an explicit code-unit sort", () => {
    const keys = ["a", "B", "_x", "Z", "0", "á"];
    const object = Object.fromEntries(keys.map((key, index) => [key, index]));
    const expected = `{${[...keys]
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${object[key]}`)
      .join(",")}}`;

    expect(canonicalJson(object)).toBe(expected);
  });
});

describe("canonicalJson handles the awkward values", () => {
  it("drops undefined properties, matching JSON.stringify", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("normalises a bare undefined to null rather than the string 'undefined'", () => {
    // JSON.stringify(undefined) returns undefined, not a string — left unhandled that
    // would splice the literal text "undefined" into a signed payload.
    expect(canonicalJson(undefined)).toBe("null");
  });

  it("serializes primitives and null as JSON does", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("x")).toBe('"x"');
    expect(canonicalJson(true)).toBe("true");
  });

  it("escapes keys and values rather than concatenating them raw", () => {
    expect(canonicalJson({ 'a"b': 'c"d' })).toBe('{"a\\"b":"c\\"d"}');
  });

  it("handles nesting inside arrays", () => {
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });
});
