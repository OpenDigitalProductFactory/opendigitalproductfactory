import { describe, expect, it } from "vitest";
import {
  PRINCIPLE_FINDING_KIND_OPTIONS,
  PRINCIPLE_FINDING_KIND_SET,
  isPrincipleFindingKind,
} from "./principle-finding-kinds";

describe("PRINCIPLE_FINDING_KIND_OPTIONS", () => {
  // Commandment-cap detector removed 2026-05-22 per scope-refactor plan;
  // commandments are now uncapped (see PRINCIPLE_TIER_CAPS in wiki-taxonomy.ts).
  // The list dropped from 12 to 11 finding kinds.
  it("includes the canonical 11-detector set", () => {
    const values = PRINCIPLE_FINDING_KIND_OPTIONS.map((o) => o.value).sort();
    expect(values).toEqual(
      [
        "principle-contradiction-review",
        "principle-duplicate",
        "principle-missing-applies-to",
        "principle-missing-direction",
        "principle-missing-tier",
        "principle-missing-vector",
        "principle-public-missing-rationale",
        "principle-public-unsafe-marker",
        "principle-tier-weight-mismatch",
        "principle-unknown-dimension",
        "principle-vector-dimension-mismatch",
      ].sort(),
    );
    expect(PRINCIPLE_FINDING_KIND_OPTIONS).toHaveLength(11);
  });

  it("marks 6 detectors as blocking (errors) and 5 as non-blocking (warns)", () => {
    const blocking = PRINCIPLE_FINDING_KIND_OPTIONS.filter((o) => o.blocking);
    const nonBlocking = PRINCIPLE_FINDING_KIND_OPTIONS.filter(
      (o) => !o.blocking,
    );
    expect(blocking).toHaveLength(6);
    expect(nonBlocking).toHaveLength(5);
  });

  it("orders blocking detectors before non-blocking detectors", () => {
    let sawNonBlocking = false;
    for (const opt of PRINCIPLE_FINDING_KIND_OPTIONS) {
      if (!opt.blocking) sawNonBlocking = true;
      if (sawNonBlocking) {
        expect(opt.blocking).toBe(false);
      }
    }
  });

  it("provides a human-readable label for each kind", () => {
    for (const opt of PRINCIPLE_FINDING_KIND_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
      // No raw detector slugs leaking into labels
      expect(opt.label).not.toContain("principle-");
      expect(opt.label).not.toContain("_");
    }
  });
});

describe("isPrincipleFindingKind", () => {
  it("returns true for every documented principle finding kind", () => {
    for (const opt of PRINCIPLE_FINDING_KIND_OPTIONS) {
      expect(isPrincipleFindingKind(opt.value)).toBe(true);
    }
  });

  it("returns false for non-principle finding kinds", () => {
    expect(isPrincipleFindingKind("orphan")).toBe(false);
    expect(isPrincipleFindingKind("stale")).toBe(false);
    expect(isPrincipleFindingKind("dangling-xref")).toBe(false);
    expect(isPrincipleFindingKind("")).toBe(false);
  });
});

describe("PRINCIPLE_FINDING_KIND_SET", () => {
  it("mirrors PRINCIPLE_FINDING_KIND_OPTIONS as a Set for O(1) lookups", () => {
    expect(PRINCIPLE_FINDING_KIND_SET.size).toBe(11);
    for (const opt of PRINCIPLE_FINDING_KIND_OPTIONS) {
      expect(PRINCIPLE_FINDING_KIND_SET.has(opt.value)).toBe(true);
    }
  });
});
