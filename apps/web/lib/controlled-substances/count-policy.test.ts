import { describe, expect, it } from "vitest";

import { evaluateCount, nextCountDue, requiredCountMethod, type CountLineProposal } from "./count-policy";
import type { HandlerGrant } from "./ledger-policy";
import { parseQuantity } from "./quantity";

const T0 = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-09-30T15:00:00Z");
const julia = { id: "p-julia", kind: "human", status: "active" };
const theo = { id: "p-theo", kind: "human", status: "active" };
const grants: HandlerGrant[] = [
  { principalId: julia.id, scope: "count", effectiveFrom: T0, effectiveTo: null },
  { principalId: theo.id, scope: "witness", effectiveFrom: T0, effectiveTo: null },
];

function line(overrides: Partial<CountLineProposal> = {}): CountLineProposal {
  return {
    productId: "prod-1",
    productName: "Hydromorphone 2 mg/mL",
    schedule: "c_ii",
    method: "exact",
    openedContainer: true,
    containerUnits: parseQuantity("10"),
    expected: parseQuantity("7.5"),
    counted: parseQuantity("7.5"),
    ...overrides,
  };
}

describe("requiredCountMethod (21 CFR 1304.11(e))", () => {
  it("requires an exact count for Schedule I and II", () => {
    for (const schedule of ["c_i", "c_ii", "c_ii_n"] as const) {
      expect(requiredCountMethod({ schedule, openedContainer: true, containerUnits: parseQuantity("10") })).toBe("exact");
    }
  });

  it("allows an estimate for an opened Schedule III-V container of 1,000 units or fewer", () => {
    expect(requiredCountMethod({ schedule: "c_iv", openedContainer: true, containerUnits: parseQuantity("1000") })).toBe(
      "exact_or_estimated",
    );
    expect(requiredCountMethod({ schedule: "c_iv", openedContainer: true, containerUnits: parseQuantity("1001") })).toBe(
      "exact",
    );
    expect(requiredCountMethod({ schedule: "c_iii", openedContainer: false, containerUnits: null })).toBe("exact");
  });
});

describe("evaluateCount", () => {
  const base = { kind: "biennial" as const, takenAt: NOW, taker: julia, witness: null, witnessRequired: false, grants };

  it("records zero-variance lines and lists variances separately", () => {
    const result = evaluateCount({
      ...base,
      lines: [line(), line({ productId: "prod-2", counted: parseQuantity("7"), productName: "Ketamine" })],
    });
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.lines).toHaveLength(2);
    expect(result.variances).toEqual([expect.objectContaining({ productId: "prod-2", variance: parseQuantity("-0.5") })]);
  });

  it("refuses an estimate where an exact count is required", () => {
    const result = evaluateCount({ ...base, lines: [line({ method: "estimated" })] });
    expect(result).toMatchObject({ allowed: false, refusals: [{ code: "estimate_not_permitted", productId: "prod-1" }] });
  });

  it("refuses an unauthorized taker, a self-witness and duplicate or negative lines", () => {
    const result = evaluateCount({
      ...base,
      taker: theo,
      witness: theo,
      lines: [line(), line({ counted: parseQuantity("-1") })],
    });
    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.refusals.map((refusal) => refusal.code)).toEqual(
      expect.arrayContaining(["taker_not_authorized", "witness_is_taker", "duplicate_product", "negative_count"]),
    );
  });

  it("enforces a witness when the policy overlay requires one", () => {
    expect(evaluateCount({ ...base, witnessRequired: true, lines: [line()] })).toMatchObject({
      allowed: false,
      refusals: [{ code: "witness_required" }],
    });
    expect(evaluateCount({ ...base, witnessRequired: true, witness: theo, lines: [line()] }).allowed).toBe(true);
  });
});

describe("nextCountDue", () => {
  it("demands an initial inventory when none exists", () => {
    expect(nextCountDue([], NOW)).toMatchObject({ kind: "initial", overdue: true });
  });

  it("runs the biennial clock from the latest initial or biennial count only", () => {
    const history = [
      { kind: "initial" as const, takenAt: new Date("2024-03-01T12:00:00Z") },
      { kind: "periodic" as const, takenAt: new Date("2026-08-01T12:00:00Z") },
    ];
    expect(nextCountDue(history, NOW)).toMatchObject({
      kind: "biennial",
      dueAt: new Date("2026-03-01T12:00:00Z"),
      overdue: true,
    });
    const withBiennial = [...history, { kind: "biennial" as const, takenAt: new Date("2026-02-15T12:00:00Z") }];
    expect(nextCountDue(withBiennial, NOW)).toMatchObject({ dueAt: new Date("2028-02-15T12:00:00Z"), overdue: false });
  });
});
