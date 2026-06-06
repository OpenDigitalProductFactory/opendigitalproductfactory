import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(testDir, "promotions.ts");

describe("promotion action bundle boundary", () => {
  it("does not import the self-upgrade barrel into ops server actions", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toMatch(
      /from\s+["']@\/lib\/self-upgrade(?:\/index)?["']/,
    );
  });
});
