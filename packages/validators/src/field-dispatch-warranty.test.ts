import { describe, expect, it } from "vitest";

import {
  type EquipmentWarranty,
  type ServiceLine,
  assessWarranty,
  billableTotal,
  classifyServiceLines,
  parseEquipmentWarranty,
  warrantyAgeMonths,
} from "./field-dispatch-warranty";

// An AC unit installed mid-2019: compressor 10yr parts / 0 labor; other parts 5yr; labor 1yr.
const AC_UNIT: EquipmentWarranty = {
  installDateIso: "2019-06-15T00:00:00.000Z",
  components: [
    { component: "compressor", partsWarrantyMonths: 120, laborWarrantyMonths: 0, source: "manufacturer" },
    { component: "coil", partsWarrantyMonths: 60, laborWarrantyMonths: 12, source: "manufacturer" },
  ],
};

describe("warrantyAgeMonths", () => {
  it("counts whole calendar months", () => {
    expect(warrantyAgeMonths("2019-06-15T00:00:00Z", "2026-06-15T00:00:00Z")).toBe(84); // 7 years
    expect(warrantyAgeMonths("2019-06-15T00:00:00Z", "2026-06-14T00:00:00Z")).toBe(83); // a day short
    expect(warrantyAgeMonths("2026-06-15T00:00:00Z", "2019-06-15T00:00:00Z")).toBe(0); // floored
  });
});

describe("assessWarranty — the compressor case", () => {
  it("covers the compressor PART but not labor in year 7", () => {
    const a = assessWarranty(AC_UNIT, "compressor", "2026-06-15T00:00:00Z");
    expect(a.ageMonths).toBe(84);
    expect(a.partsCovered).toBe(true); // 84 <= 120
    expect(a.laborCovered).toBe(false); // 84 > 0
    expect(a.note).toMatch(/part covered; labor billable/);
  });

  it("covers neither once past the parts term", () => {
    const a = assessWarranty(AC_UNIT, "compressor", "2030-06-15T00:00:00Z"); // year 11
    expect(a.partsCovered).toBe(false);
    expect(a.laborCovered).toBe(false);
  });

  it("covers both parts and labor for the coil within its labor term", () => {
    const a = assessWarranty(AC_UNIT, "coil", "2020-01-15T00:00:00Z"); // ~7 months
    expect(a.partsCovered).toBe(true);
    expect(a.laborCovered).toBe(true);
  });

  it("defaults an unknown component to not-covered (conservative)", () => {
    const a = assessWarranty(AC_UNIT, "thermostat", "2020-01-15T00:00:00Z");
    expect(a.partsCovered).toBe(false);
    expect(a.laborCovered).toBe(false);
    expect(a.note).toMatch(/no warranty terms/);
  });
});

describe("classifyServiceLines + billableTotal", () => {
  it("zeros a warranted compressor part and bills the labor", () => {
    const lines: ServiceLine[] = [
      { kind: "part", component: "compressor", description: "Compressor replacement", amount: 1400 },
      { kind: "labor", component: "compressor", description: "Labor (4 hrs)", amount: 520 },
      { kind: "part", component: "filter", description: "Air filter", amount: 35 },
    ];
    const classified = classifyServiceLines(AC_UNIT, lines, "2026-06-15T00:00:00Z");
    expect(classified[0]).toMatchObject({ covered: true, billedAmount: 0 }); // compressor part free
    expect(classified[1]).toMatchObject({ covered: false, billedAmount: 520 }); // labor billed
    expect(classified[2]).toMatchObject({ covered: false, billedAmount: 35 }); // unknown component billed
    expect(billableTotal(classified)).toBe(555); // 0 + 520 + 35
  });
});

describe("parseEquipmentWarranty", () => {
  it("parses a valid record and rejects malformed input", () => {
    expect(parseEquipmentWarranty(AC_UNIT)).not.toBeNull();
    expect(parseEquipmentWarranty({ installDateIso: "2019-06-15", components: "nope" })).toBeNull();
    expect(parseEquipmentWarranty(null)).toBeNull();
  });
});
