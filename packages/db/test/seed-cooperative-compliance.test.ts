import { describe, expect, it } from "vitest";
import {
  COOPERATIVE_CONTROLS,
  COOPERATIVE_REGULATIONS,
} from "../src/seed-cooperative-compliance";

// Pure-data integrity tests — no database. Mirrors the public-sector pack tests.

describe("cooperative compliance pack data", () => {
  it("ships Subchapter T and co-op governance with the expected obligation counts", () => {
    expect(COOPERATIVE_REGULATIONS.map((r) => r.regulationId).sort()).toEqual([
      "REG-US-COOP-GOVERNANCE",
      "REG-US-IRS-SUBCHAPTER-T",
    ]);
    const total = COOPERATIVE_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
    expect(total).toBe(8);
    for (const reg of COOPERATIVE_REGULATIONS) {
      expect(reg.industry).toBe("cooperative");
      if (reg.jurisdiction === "US-federal") {
        expect(reg.sourceUrl).toMatch(/^https:\/\//);
      } else {
        expect(reg.sourceUrl).toBeNull();
      }
      expect(reg.obligations.length).toBeGreaterThan(0);
    }
  });

  it("obligation references are globally unique", () => {
    const refs = COOPERATIVE_REGULATIONS.flatMap((r) => r.obligations.map((o) => o.reference));
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("every control references only known obligations", () => {
    const known = new Set(
      COOPERATIVE_REGULATIONS.flatMap((r) => r.obligations.map((o) => o.reference)),
    );
    for (const control of COOPERATIVE_CONTROLS) {
      expect(control.obligationRefs.length).toBeGreaterThan(0);
      for (const ref of control.obligationRefs) {
        expect(known.has(ref), `${control.title} references unknown obligation ${ref}`).toBe(true);
      }
    }
  });

  it("every obligation carries the fields the compliance surfaces render", () => {
    for (const reg of COOPERATIVE_REGULATIONS) {
      for (const obl of reg.obligations) {
        expect(obl.title.length).toBeGreaterThan(10);
        expect(obl.description.length).toBeGreaterThan(40);
        expect(["governance", "finance"]).toContain(obl.category);
        expect(["event-driven", "continuous", "annual", "monthly"]).toContain(obl.frequency);
      }
    }
  });
});
