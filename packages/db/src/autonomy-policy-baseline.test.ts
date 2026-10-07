import { describe, expect, it, vi } from "vitest";

import {
  PLATFORM_DEVELOPMENT_ACTIVITY_CLASSES,
  assertHumanControlHasBasis,
  buildWwmdBaselinePolicies,
} from "./autonomy-policy-baseline";
import { seedAutonomyPolicyBaseline } from "./seed-autonomy-policy-baseline";

describe("WWMD platform-development baseline (BI-E30C0F4F)", () => {
  it("covers every platform-development activity class at autopilot, on every install, without human control", () => {
    const rows = buildWwmdBaselinePolicies();
    expect(rows.map((row) => row.activityClass).sort()).toEqual([...PLATFORM_DEVELOPMENT_ACTIVITY_CLASSES].sort());
    for (const row of rows) {
      expect(row).toMatchObject({
        sourceKind: "wwmd-baseline",
        maxAutonomyLevel: "autopilot",
        humanControlRequired: false,
        industry: null,
        jurisdiction: "global",
        jurisdictionBasis: "global",
        status: "active",
      });
      expect(row.requiredEvidence).toEqual(expect.arrayContaining(["independent-review", "ci-gate"]));
      expect(row.rationale).toMatch(/operator decision 2026-10-07/i);
    }
  });

  it("names build.implement, the class the build runtime, tee-up and pattern promotion ask about", () => {
    expect(PLATFORM_DEVELOPMENT_ACTIVITY_CLASSES).toContain("build.implement");
  });
});

describe("assertHumanControlHasBasis", () => {
  it("refuses a human-control row that names no regulation or policy", () => {
    expect(() => assertHumanControlHasBasis({ policyKey: "x", humanControlRequired: true, regulationId: null, rationale: "seemed risky" }))
      .toThrow(/human_control_without_basis/);
  });

  it("accepts a human-control row that names its regulation, or a policy reference in its rationale", () => {
    expect(() => assertHumanControlHasBasis({ policyKey: "x", humanControlRequired: true, regulationId: "REG-GDPR", rationale: null })).not.toThrow();
    expect(() => assertHumanControlHasBasis({ policyKey: "x", humanControlRequired: true, regulationId: null, rationale: "policy: WWWD/approvals#payments" })).not.toThrow();
    expect(() => assertHumanControlHasBasis({ policyKey: "x", humanControlRequired: false, regulationId: null, rationale: null })).not.toThrow();
  });
});

function fakeDb(existing: Array<Record<string, unknown>> = []) {
  const rows = [...existing];
  return {
    rows,
    regulatoryAutonomyPolicy: {
      findMany: vi.fn(async ({ where }: { where: { policyKey: string } }) =>
        rows.filter((row) => row.policyKey === where.policyKey).sort((a, b) => Number(b.version) - Number(a.version))),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { rows.push({ ...data }); return data; }),
      update: vi.fn(async ({ where, data }: { where: { policyId: string }; data: Record<string, unknown> }) => {
        const row = rows.find((candidate) => candidate.policyId === where.policyId)!;
        Object.assign(row, data);
        return row;
      }),
    },
  };
}

describe("seedAutonomyPolicyBaseline", () => {
  it("creates the baseline once and is a no-op on the next run", async () => {
    const db = fakeDb();
    const first = await seedAutonomyPolicyBaseline(db as never);
    expect(first.created).toBe(PLATFORM_DEVELOPMENT_ACTIVITY_CLASSES.length);
    const second = await seedAutonomyPolicyBaseline(db as never);
    expect(second).toMatchObject({ created: 0, superseded: 0, unchanged: PLATFORM_DEVELOPMENT_ACTIVITY_CLASSES.length });
    expect(db.rows).toHaveLength(PLATFORM_DEVELOPMENT_ACTIVITY_CLASSES.length);
  });

  it("versions a changed baseline: retires the old row and creates the next version", async () => {
    const [row] = buildWwmdBaselinePolicies();
    const db = fakeDb([{ ...row, policyId: "old", version: 1, maxAutonomyLevel: "supervised" }]);
    const result = await seedAutonomyPolicyBaseline(db as never);
    expect(result.superseded).toBe(1);
    const lineage = db.rows.filter((candidate) => candidate.policyKey === row!.policyKey);
    expect(lineage.find((candidate) => candidate.policyId === "old")).toMatchObject({ status: "retired" });
    expect(lineage.find((candidate) => candidate.version === 2)).toMatchObject({ status: "active", maxAutonomyLevel: "autopilot" });
  });

  it("never touches a lineage an operator has taken over", async () => {
    const [row] = buildWwmdBaselinePolicies();
    const db = fakeDb([{ ...row, policyId: "op", version: 3, sourceKind: "operator", maxAutonomyLevel: "supervised" }]);
    const result = await seedAutonomyPolicyBaseline(db as never);
    expect(result.preserved).toBe(1);
    expect(db.regulatoryAutonomyPolicy.create).not.toHaveBeenCalled();
    expect(db.regulatoryAutonomyPolicy.update).not.toHaveBeenCalled();
  });
});
