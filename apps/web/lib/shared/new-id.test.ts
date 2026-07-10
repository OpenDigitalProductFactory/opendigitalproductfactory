// apps/web/lib/shared/new-id.test.ts — EP-8DC217EB BET-14
import { describe, it, expect } from "vitest";
import { newId } from "./new-id";

const ALPHABET =
  "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const ALPHABET_RE = new RegExp(
  `^[${ALPHABET.replace(/[-\\]/g, "\\$&")}]+$`,
);

describe("newId", () => {
  it("defaults to length 21 (nanoid's default)", () => {
    expect(newId()).toHaveLength(21);
  });

  it("honours the requested size", () => {
    for (const size of [1, 6, 8, 10, 12, 32, 64]) {
      expect(newId(size)).toHaveLength(size);
    }
  });

  it("emits only characters from the url-safe alphabet", () => {
    for (let i = 0; i < 200; i++) {
      expect(newId(32)).toMatch(ALPHABET_RE);
    }
  });

  it("produces distinct ids across many calls", () => {
    const seen = new Set<string>();
    const n = 10_000;
    for (let i = 0; i < n; i++) seen.add(newId());
    expect(seen.size).toBe(n);
  });
});
