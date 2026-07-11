// Guards the union-mergeable tool-pack registry (EP-8DC217EB BET-4). A union
// merge (or a human double-add) could duplicate a pack import + array entry;
// these tests fail loudly rather than shipping a registry with duplicate tools.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TOOL_PACK_REGISTRY } from "./pack-registry";

const REGISTRY_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "pack-registry.ts"),
  "utf8",
);

describe("tool-pack registry (union-mergeable)", () => {
  it("registers a non-empty set of tools with no duplicate tool names", () => {
    const names = TOOL_PACK_REGISTRY.definitions.map((d) => d.name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has no duplicate pack import lines (a union-merge duplication signal)", () => {
    const importLines = REGISTRY_SRC.split("\n").filter((l) =>
      /^import \{ \w+Pack \} from "\.\/packs\//.test(l),
    );
    expect(new Set(importLines).size).toBe(importLines.length);
  });

  it("has no duplicate pack entries in the composeToolPacks array", () => {
    const arrayEntries = REGISTRY_SRC.split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\w+Pack,$/.test(l));
    expect(new Set(arrayEntries).size).toBe(arrayEntries.length);
  });

  it("every imported pack appears in the array and vice-versa", () => {
    const imported = [...REGISTRY_SRC.matchAll(/^import \{ (\w+Pack) \} from "\.\/packs\//gm)].map(
      (m) => m[1],
    );
    const inArray = [...REGISTRY_SRC.matchAll(/^  (\w+Pack),$/gm)].map((m) => m[1]);
    expect([...imported].sort()).toEqual([...inArray].sort());
  });

  it("is one-pack-per-line (each array entry on its own line, trailing comma)", () => {
    // No single line may carry two pack entries — that's what keeps additions
    // union-mergeable (two branches adding a line each merge cleanly).
    const twoOnOneLine = REGISTRY_SRC.split("\n").some((l) => /Pack,[^\n]*\bPack,/.test(l));
    expect(twoOnOneLine).toBe(false);
  });
});
