import { describe, expect, it } from "vitest";
import {
  PUBLIC_SECTOR_CONTROLS,
  PUBLIC_SECTOR_REGULATIONS,
} from "../src/seed-public-sector-compliance";

// Pure-data integrity tests — no database. The seeder itself throws on a
// control referencing an unknown obligation (silent-skip guard); these tests
// catch the same class at review time.

describe("public-sector compliance pack data", () => {
  it("ships the three state-law families with the expected obligation counts", () => {
    expect(PUBLIC_SECTOR_REGULATIONS.map((r) => r.regulationId).sort()).toEqual([
      "REG-US-STATE-MUNI-FINANCE",
      "REG-US-STATE-OPEN-MEETINGS",
      "REG-US-STATE-PUBLIC-RECORDS",
    ]);
    const total = PUBLIC_SECTOR_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
    expect(total).toBe(11);
    for (const reg of PUBLIC_SECTOR_REGULATIONS) {
      expect(reg.industry).toBe("public-sector");
      expect(reg.obligations.length).toBeGreaterThan(0);
    }
  });

  it("obligation references are globally unique", () => {
    const refs = PUBLIC_SECTOR_REGULATIONS.flatMap((r) => r.obligations.map((o) => o.reference));
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("every control references only known obligations", () => {
    const known = new Set(
      PUBLIC_SECTOR_REGULATIONS.flatMap((r) => r.obligations.map((o) => o.reference)),
    );
    for (const control of PUBLIC_SECTOR_CONTROLS) {
      expect(control.obligationRefs.length).toBeGreaterThan(0);
      for (const ref of control.obligationRefs) {
        expect(known.has(ref), `${control.title} references unknown obligation ${ref}`).toBe(true);
      }
    }
  });

  it("every obligation carries the fields the compliance surfaces render", () => {
    for (const reg of PUBLIC_SECTOR_REGULATIONS) {
      for (const obl of reg.obligations) {
        expect(obl.title.length).toBeGreaterThan(10);
        expect(obl.description.length).toBeGreaterThan(40);
        expect(["governance", "records", "finance", "procurement"]).toContain(obl.category);
        expect(["event-driven", "continuous", "annual", "monthly"]).toContain(obl.frequency);
      }
    }
  });
});
