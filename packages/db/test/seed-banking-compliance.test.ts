import { describe, expect, it } from "vitest";
import {
  BANKING_CONTROLS,
  BANKING_REGULATIONS,
} from "../src/seed-banking-compliance";

// Pure-data integrity tests — no database. Mirrors the other compliance packs.

describe("banking compliance pack data", () => {
  it("ships BSA/AML (shared), NCUA (credit union), and FDIC/CRA (bank) with expected counts", () => {
    expect(BANKING_REGULATIONS.map((r) => r.regulationId).sort()).toEqual([
      "REG-US-BSA-AML",
      "REG-US-FDIC-CRA",
      "REG-US-NCUA",
    ]);
    const total = BANKING_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
    expect(total).toBe(14);
    for (const reg of BANKING_REGULATIONS) {
      expect(reg.industry).toBe("financial");
      expect(reg.sourceUrl).toMatch(/^https:\/\//);
      expect(reg.obligations.length).toBeGreaterThan(0);
    }
  });

  it("models BSA/AML as a single shared regulation, not double-seeded per archetype", () => {
    const bsa = BANKING_REGULATIONS.filter((r) => r.regulationId === "REG-US-BSA-AML");
    expect(bsa).toHaveLength(1);
    expect(bsa[0]!.notes.toLowerCase()).toContain("credit unions");
    expect(bsa[0]!.notes.toLowerCase()).toContain("community banks");
  });

  it("obligation references are globally unique", () => {
    const refs = BANKING_REGULATIONS.flatMap((r) => r.obligations.map((o) => o.reference));
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("every control references only known obligations", () => {
    const known = new Set(
      BANKING_REGULATIONS.flatMap((r) => r.obligations.map((o) => o.reference)),
    );
    for (const control of BANKING_CONTROLS) {
      expect(control.obligationRefs.length).toBeGreaterThan(0);
      for (const ref of control.obligationRefs) {
        expect(known.has(ref), `${control.title} references unknown obligation ${ref}`).toBe(true);
      }
    }
  });

  it("every obligation carries the fields the compliance surfaces render", () => {
    for (const reg of BANKING_REGULATIONS) {
      for (const obl of reg.obligations) {
        expect(obl.title.length).toBeGreaterThan(10);
        expect(obl.description.length).toBeGreaterThan(40);
        expect(["governance", "finance", "operational"]).toContain(obl.category);
        expect(["event-driven", "continuous", "annual", "monthly"]).toContain(obl.frequency);
      }
    }
  });
});
