import { describe, expect, it } from "vitest";
import { createFindingKey, normalizeVendorIdentifier } from "./finding-key";

describe("createFindingKey", () => {
  it("creates a deterministic 24 character hex key", () => {
    const input = {
      adapterKey: "diff-security",
      findingKind: "vulnerability",
      affectedType: "bom-component",
      affectedId: "pkg:npm/react@19.0.0",
      vendorIdentifier: "CVE-2026-0001",
    } as const;

    expect(createFindingKey(input)).toBe(createFindingKey(input));
    expect(createFindingKey(input)).toMatch(/^[a-f0-9]{24}$/);
  });

  it("changes when the affected object changes", () => {
    const base = {
      adapterKey: "diff-security",
      findingKind: "policy-violation",
      affectedType: "source-file",
      vendorIdentifier: "xss",
    } as const;

    expect(createFindingKey({ ...base, affectedId: "a.tsx" })).not.toBe(
      createFindingKey({ ...base, affectedId: "b.tsx" }),
    );
  });
});

describe("normalizeVendorIdentifier", () => {
  it("marks scanner identifiers as strong", () => {
    expect(normalizeVendorIdentifier("CVE-2026-0001", "fallback")).toEqual({
      identifier: "CVE-2026-0001",
      stability: "strong",
    });
  });

  it("uses a weak fallback for scanners without stable identifiers", () => {
    const result = normalizeVendorIdentifier("", "Direct innerHTML assignment");
    expect(result.identifier).toMatch(/^weak:/);
    expect(result.stability).toBe("weak");
  });
});
