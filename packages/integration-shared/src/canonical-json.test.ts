import { describe, expect, it } from "vitest";

import { canonicalJson } from "./canonical-json";
// The scripts/ home (plain .mjs cannot import this TypeScript module). It must stay
// byte-identical to the one above: both feed hashes and signatures.
import { canonicalJson as scriptsCanonicalJson } from "../../../scripts/lib/canonical-json.mjs";

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

describe("canonicalJson pins its non-JSON edge cases", () => {
  it("writes -0 as 0 and non-finite numbers as null, as JSON.stringify does", () => {
    expect(canonicalJson({ z: -0, n: NaN, p: Infinity, m: -Infinity })).toBe('{"m":null,"n":null,"p":null,"z":0}');
  });

  it("writes undefined array entries as null", () => {
    expect(canonicalJson([undefined, 1])).toBe("[null,1]");
  });

  it("sorts integer-like keys as strings, not numerically", () => {
    // An object rebuilt with Object.fromEntries would put "2" before "10"; this does not.
    expect(canonicalJson({ "2": "b", "10": "a" })).toBe('{"10":"a","2":"b"}');
  });

  it("does not call toJSON: a Date is walked as an object with no own keys", () => {
    expect(canonicalJson({ at: new Date(0) })).toBe('{"at":{}}');
  });

  it("throws on bigint, as JSON.stringify does", () => {
    expect(() => canonicalJson({ n: 1n })).toThrow(TypeError);
  });
});

// A seeded generator, so a failure reproduces. Covers nested objects and arrays, unicode
// and integer-like keys, -0, NaN, ±Infinity, null and undefined.
function makeGenerator(seed: number) {
  let state = seed;
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const keys = ["a", "A", "b", "B", "_", "0", "2", "10", "01", "-1", "1.5", "é", "e", "ß", "ä", "日本", "😀", "\u{10000}", "\uffff", "", " ", 'q"t', "a\\b"];
  const leaves: unknown[] = [null, undefined, true, false, "", "x", "é", "😀", "\u2028", 0, -0, 1, -1, 1.5, 1e21, 1e-7, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER];
  const value = (depth: number): unknown => {
    const roll = next();
    if (depth <= 0 || roll < 0.35) return pick(leaves);
    if (roll < 0.65) return Array.from({ length: Math.floor(next() * 4) }, () => value(depth - 1));
    const out: Record<string, unknown> = {};
    for (let index = Math.floor(next() * 5); index > 0; index -= 1) out[pick(keys)] = value(depth - 1);
    return out;
  };
  return value;
}

describe("the scripts/ home is byte-identical to this one", () => {
  it("agrees on the edge cases", () => {
    const cases: unknown[] = [undefined, null, -0, NaN, Infinity, -Infinity, [undefined], { a: undefined }, { "2": 1, "10": 2 }, { B: 1, a: 2 }, { at: new Date(0) }];
    for (const value of cases) expect(scriptsCanonicalJson(value)).toBe(canonicalJson(value));
    expect(() => scriptsCanonicalJson({ n: 1n })).toThrow(TypeError);
  });

  it("agrees on 5000 randomized nested values", () => {
    const value = makeGenerator(0x5eed);
    for (let index = 0; index < 5000; index += 1) {
      const input = value(4);
      expect(scriptsCanonicalJson(input)).toBe(canonicalJson(input));
    }
  });
});
