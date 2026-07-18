import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("diagnostics preflight lifecycle contract", () => {
  it("does not emit retired vector-runtime probes or remediation", async () => {
    const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
    for (const retired of [/qdrant/i, /6333/, /collections\//, /restart qdrant/i, /QDRANT_(?:URL|INTERNAL_URL)/]) {
      expect(source).not.toMatch(retired);
    }
  });
});
