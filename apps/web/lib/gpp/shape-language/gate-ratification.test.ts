// The gate ratification table (PR-3a-2, BI-6DA17863). The table maps every
// `decisionScope` string the shape registry uses to a proposed typed gate and a
// status. These tests keep it complete in both directions, keep every proposal
// valid against the shape schema and honest about today's drive behaviour, and
// hold that nothing is ratified at merge: ratification belongs to the founder
// (WWMD), not to the agent that wrote the proposals.

import { describe, expect, it } from "vitest";

import { DECISION_ID_PATTERN } from "@/lib/gpp/binding-enforcement";
import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { listWorkShapes, type WorkShapeDefinition, type WorkShapeStage } from "@/lib/work-management/work-shapes";

import {
  GATE_RATIFICATION,
  gateRatificationRefusals,
  ratifiedGateFor,
  type GateRatificationEntry,
} from "./gate-ratification";
import { gppShapeDocumentSchema } from "./gpp-shape-schema";

type GovernedUse = { shape: string; stage: WorkShapeStage };

/** Every governed-decision stage across the current registry and the frozen prior versions, by scope. */
function governedUsesByScope(): Map<string, GovernedUse[]> {
  const definitions: readonly WorkShapeDefinition[] = [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS];
  const uses = new Map<string, GovernedUse[]>();
  for (const definition of definitions) {
    for (const stage of definition.stages) {
      if (stage.advance.kind !== "governed-decision") continue;
      const scope = stage.advance.decisionScope;
      uses.set(scope, [...(uses.get(scope) ?? []), { shape: `${definition.key}@${definition.version}`, stage }]);
    }
  }
  return uses;
}

/** Validate a gate through the shape schema's own `gate`, carried on a minimal governed stage. */
function gateIssues(gate: unknown) {
  const document = {
    format: "gpp-shape/0.1",
    key: "gate-probe",
    version: "1.0.0",
    title: "Gate probe",
    description: "Carries one gate so the schema's gate definition validates it.",
    triggers: ["cadence"],
    stages: [
      {
        key: "decide",
        title: "Decide",
        accountablePrincipalRef: "role:owner",
        advance: { kind: "governed-decision", condition: "The owner decides.", decisionScope: "probe", gate },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [{ kind: "success", condition: "Decided.", disposition: "proceed" }],
    grants: [],
    measures: [],
    budgets: [],
    reviewPoint: { everyDays: 30, description: "Monthly." },
    collaborationShape: null,
  };
  const result = gppShapeDocumentSchema.safeParse(document);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

const PROPOSED_GATE = {
  authority: "wwwd",
  mode: "enforced",
  blocking: true,
  resolution: "accountable-human",
} as const;

describe("gate ratification table", () => {
  it("has exactly one entry per decisionScope across listWorkShapes() and WORK_SHAPE_PRIOR_VERSIONS (two-way)", () => {
    const registryScopes = [...governedUsesByScope().keys()].sort();
    const tableScopes = Object.keys(GATE_RATIFICATION).sort();

    const missing = registryScopes.filter((scope) => !(scope in GATE_RATIFICATION));
    const stale = tableScopes.filter((scope) => !registryScopes.includes(scope));
    expect(missing, "decision scopes used by a shape with no ratification entry").toEqual([]);
    expect(stale, "ratification entries whose scope no shape uses any more").toEqual([]);
    expect(tableScopes).toEqual(registryScopes);
  });

  it("every proposed value validates against the shape schema's gate", () => {
    const failures = Object.entries(GATE_RATIFICATION).flatMap(([scope, entry]) =>
      gateIssues(entry.proposed).map((issue) => `${scope}: ${issue}`),
    );
    expect(failures).toEqual([]);
  });

  it("the probe rejects an invalid gate, so the validation above is not vacuous", () => {
    expect(gateIssues({ ...PROPOSED_GATE, authority: "nobody" })).not.toEqual([]);
    expect(gateIssues({ ...PROPOSED_GATE, extra: true })).not.toEqual([]);
    expect(gateIssues(PROPOSED_GATE)).toEqual([]);
  });

  it("every proposal describes today's behaviour: a role:/person: stage the drive never executes is enforced and blocking, decided by a person", () => {
    const uses = governedUsesByScope();
    const failures: string[] = [];
    for (const [scope, entry] of Object.entries(GATE_RATIFICATION)) {
      for (const { shape, stage } of uses.get(scope) ?? []) {
        if (!/^(role|person):/.test(stage.accountablePrincipalRef)) {
          failures.push(
            `${scope} (${shape} stage ${stage.key}): principal ${stage.accountablePrincipalRef} is not role:/person:; ` +
              "an agent-principal governed stage can drive its own review (EP-4614F35E), so its proposal needs its own reasoning",
          );
        }
      }
      const { mode, blocking, resolution } = entry.proposed;
      if (mode !== "enforced" || blocking !== true || resolution !== "accountable-human") {
        failures.push(`${scope}: proposed ${mode}/${blocking ? "blocking" : "non-blocking"}/${resolution}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("every entry states the basis for its proposed authority", () => {
    const missing = Object.entries(GATE_RATIFICATION)
      .filter(([, entry]) => entry.basis.trim().length === 0)
      .map(([scope]) => scope);
    expect(missing).toEqual([]);
  });

  it("every ratified entry carries a WWMD decision id and an ISO ratifiedAt", () => {
    expect(gateRatificationRefusals(GATE_RATIFICATION)).toEqual([]);
  });

  it("refuses a ratified entry without a DI-pattern decision id or a valid ISO timestamp", () => {
    expect(DECISION_ID_PATTERN.test("DI-2DE3951FBB28")).toBe(true);
    const ok: GateRatificationEntry = {
      status: "ratified",
      proposed: PROPOSED_GATE,
      basis: "Synthetic.",
      decisionId: "DI-2DE3951FBB28",
      ratifiedAt: "2026-10-02T00:00:00.000Z",
    };
    expect(gateRatificationRefusals({ "synthetic-scope": ok })).toEqual([]);
    expect(gateRatificationRefusals({ "synthetic-scope": { ...ok, decisionId: "DI-123" } })).toEqual([
      "synthetic-scope: decisionId must match DI-[0-9A-F]{12} (a WWMD decision id)",
    ]);
    expect(gateRatificationRefusals({ "synthetic-scope": { ...ok, ratifiedAt: "2026-13-45" } })).toEqual([
      "synthetic-scope: ratifiedAt must be an ISO 8601 date",
    ]);
    expect(gateRatificationRefusals({ "synthetic-scope": { ...ok, ratifiedAt: "yesterday" } })).toHaveLength(1);
    expect(gateRatificationRefusals({ "synthetic-scope": { ...ok, ratifiedAt: "2026-10-02" } })).toEqual([]);
    // A proposed entry is never checked for ratification fields.
    expect(gateRatificationRefusals({ "synthetic-scope": { status: "proposed", proposed: PROPOSED_GATE, basis: "Synthetic." } })).toEqual([]);
  });

  // PR-3b-R, the first ratification PR, deletes this assertion. Until then the
  // table is inert: the decompiler reads only ratified entries.
  it("no entry is ratified at merge", () => {
    const ratified = Object.entries(GATE_RATIFICATION)
      .filter(([, entry]) => entry.status !== "proposed")
      .map(([scope]) => scope);
    expect(ratified).toEqual([]);
  });

  it("ratifiedGateFor returns null for a proposed or unknown scope and the gate for a ratified one", () => {
    for (const scope of Object.keys(GATE_RATIFICATION)) expect(ratifiedGateFor(scope)).toBeNull();
    expect(ratifiedGateFor("no-such-scope")).toBeNull();

    const injected = {
      "outbound-customer-communication": {
        status: "ratified",
        proposed: PROPOSED_GATE,
        basis: "Synthetic.",
        decisionId: "DI-2DE3951FBB28",
        ratifiedAt: "2026-10-02T00:00:00.000Z",
      },
    } satisfies Record<string, GateRatificationEntry>;
    expect(ratifiedGateFor("outbound-customer-communication", injected)).toEqual(PROPOSED_GATE);
    expect(ratifiedGateFor("outbound-reply-approval", injected)).toBeNull();
  });

  it("the table is frozen, so nothing at runtime can ratify an entry", () => {
    expect(Object.isFrozen(GATE_RATIFICATION)).toBe(true);
    for (const entry of Object.values(GATE_RATIFICATION)) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.proposed)).toBe(true);
    }
  });
});
