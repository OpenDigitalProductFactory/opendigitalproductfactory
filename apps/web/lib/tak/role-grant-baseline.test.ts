import { describe, it, expect } from "vitest";
import {
  deriveRoleBaselineGrants,
  computeGrantDelta,
  resolveEffectiveGrants,
  describeAgentGrants,
  normalizeValueStream,
  VALUE_STREAM_READ_BASELINE,
} from "./role-grant-baseline";
import { COWORKER_READ_BASELINE_GRANTS } from "./agent-grants";

describe("deriveRoleBaselineGrants", () => {
  it("is the universal read baseline for an unknown/absent value stream", () => {
    expect(deriveRoleBaselineGrants({ valueStream: null })).toEqual(
      [...COWORKER_READ_BASELINE_GRANTS].sort(),
    );
    expect(deriveRoleBaselineGrants({ valueStream: "not-a-stream" })).toEqual(
      [...COWORKER_READ_BASELINE_GRANTS].sort(),
    );
  });

  it("adds the value stream's read grants on top of the universal baseline", () => {
    const integrate = deriveRoleBaselineGrants({ valueStream: "integrate" });
    for (const g of COWORKER_READ_BASELINE_GRANTS) expect(integrate).toContain(g);
    expect(integrate).toContain("backlog_read");
    expect(integrate).toContain("architecture_read");
  });

  it("normalizes case/whitespace in the value stream", () => {
    expect(deriveRoleBaselineGrants({ valueStream: " Operate " })).toEqual(
      deriveRoleBaselineGrants({ valueStream: "operate" }),
    );
  });

  it("BASELINE IS READ-ONLY — no write/act grant is ever in any role baseline (INV-A1)", () => {
    for (const [vs, grants] of Object.entries(VALUE_STREAM_READ_BASELINE)) {
      for (const g of grants) {
        expect(g.endsWith("_read"), `${vs} baseline grant ${g} is not read-only`).toBe(true);
      }
    }
    for (const vs of ["evaluate", "integrate", "operate", "consume", "cross-cutting"]) {
      for (const g of deriveRoleBaselineGrants({ valueStream: vs })) {
        expect(g.endsWith("_read"), `${vs} derived baseline ${g} is not read-only`).toBe(true);
      }
    }
  });
});

describe("computeGrantDelta / resolveEffectiveGrants round-trip", () => {
  it("splits effective grants into escalations (added) and withheld (removed)", () => {
    const baseline = deriveRoleBaselineGrants({ valueStream: "integrate" });
    const effective = [...baseline.filter((g) => g !== "backlog_read"), "backlog_write", "sandbox_execute"];
    const delta = computeGrantDelta(baseline, effective);
    expect(delta.added).toEqual(["backlog_write", "sandbox_execute"]);
    expect(delta.removed).toEqual(["backlog_read"]);
  });

  it("resolveEffectiveGrants(baseline, delta) reconstructs the effective set", () => {
    const baseline = deriveRoleBaselineGrants({ valueStream: "operate" });
    const effective = [...baseline, "incident_respond", "admin_write"].sort();
    const delta = computeGrantDelta(baseline, effective);
    expect(resolveEffectiveGrants(baseline, delta)).toEqual(effective);
  });
});

describe("describeAgentGrants (the operator surface)", () => {
  it("surfaces write escalations as the least-privilege attention set", () => {
    const desc = describeAgentGrants(
      { valueStream: "integrate" },
      [
        ...deriveRoleBaselineGrants({ valueStream: "integrate" }),
        "backlog_write",
        "sandbox_execute",
        "telemetry_read",
      ],
    );
    expect(desc.escalations).toContain("backlog_write");
    expect(desc.escalations).toContain("telemetry_read");
    expect(desc.writeEscalations.sort()).toEqual(["backlog_write", "sandbox_execute"]);
    expect(desc.writeEscalations).not.toContain("telemetry_read");
  });

  it("a coworker with only its baseline has zero escalations (the conservative default)", () => {
    const desc = describeAgentGrants(
      { valueStream: "evaluate" },
      deriveRoleBaselineGrants({ valueStream: "evaluate" }),
    );
    expect(desc.escalations).toEqual([]);
    expect(desc.writeEscalations).toEqual([]);
    expect(desc.withheld).toEqual([]);
  });
});

describe("normalizeValueStream", () => {
  it("maps known streams and rejects unknown", () => {
    expect(normalizeValueStream("Integrate")).toBe("integrate");
    expect(normalizeValueStream("cross-cutting")).toBe("cross-cutting");
    expect(normalizeValueStream("marketing")).toBeNull();
    expect(normalizeValueStream(null)).toBeNull();
  });
});
