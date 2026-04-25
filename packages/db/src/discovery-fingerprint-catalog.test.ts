import { describe, expect, it } from "vitest";
import { validateFingerprintCatalog } from "./discovery-fingerprint-catalog";

describe("validateFingerprintCatalog", () => {
  it("accepts the repo catalog fixtures", async () => {
    const result = await validateFingerprintCatalog("packages/db/data/discovery_fingerprints/catalog.json");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
