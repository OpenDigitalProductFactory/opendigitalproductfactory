import { describe, expect, it } from "vitest";
import {
  LAW_ENFORCEMENT_CONTROLS,
  LAW_ENFORCEMENT_REGULATIONS,
} from "../src/seed-law-enforcement-compliance";

// Pure-data integrity tests — no database. Mirrors the public-sector pack tests.

describe("law-enforcement compliance pack data", () => {
  it("ships POST, policy attestation, and the CJIS readiness gate with expected counts", () => {
    expect(LAW_ENFORCEMENT_REGULATIONS.map((r) => r.regulationId).sort()).toEqual([
      "REG-US-CJIS-READINESS",
      "REG-US-LE-POLICY-ATTESTATION",
      "REG-US-STATE-POST",
    ]);
    const total = LAW_ENFORCEMENT_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
    expect(total).toBe(8);
    for (const reg of LAW_ENFORCEMENT_REGULATIONS) {
      expect(reg.industry).toBe("public-safety");
      expect(reg.obligations.length).toBeGreaterThan(0);
    }
  });

  it("frames the CJIS entry as a Phase-2 gate, not a Phase-1 compliance claim", () => {
    const cjis = LAW_ENFORCEMENT_REGULATIONS.find((r) => r.regulationId === "REG-US-CJIS-READINESS");
    expect(cjis).toBeDefined();
    expect(cjis!.obligations).toHaveLength(1);
    const gate = cjis!.obligations[0]!;
    // The applicability and description must make the no-CJI Phase-1 boundary explicit.
    expect(gate.applicability.toLowerCase()).toContain("phase 2");
    expect(gate.description.toLowerCase()).toContain("phase 1 stores no cji");
  });

  it("obligation references are globally unique", () => {
    const refs = LAW_ENFORCEMENT_REGULATIONS.flatMap((r) => r.obligations.map((o) => o.reference));
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("every control references only known obligations", () => {
    const known = new Set(
      LAW_ENFORCEMENT_REGULATIONS.flatMap((r) => r.obligations.map((o) => o.reference)),
    );
    for (const control of LAW_ENFORCEMENT_CONTROLS) {
      expect(control.obligationRefs.length).toBeGreaterThan(0);
      for (const ref of control.obligationRefs) {
        expect(known.has(ref), `${control.title} references unknown obligation ${ref}`).toBe(true);
      }
    }
  });

  it("every obligation carries the fields the compliance surfaces render", () => {
    for (const reg of LAW_ENFORCEMENT_REGULATIONS) {
      for (const obl of reg.obligations) {
        expect(obl.title.length).toBeGreaterThan(10);
        expect(obl.description.length).toBeGreaterThan(40);
        expect(["governance", "operational"]).toContain(obl.category);
        expect(["event-driven", "continuous", "annual", "monthly"]).toContain(obl.frequency);
      }
    }
  });
});
