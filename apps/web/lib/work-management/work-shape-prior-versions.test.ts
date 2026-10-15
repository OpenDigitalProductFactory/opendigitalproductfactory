// Prior work-shape versions stay resolvable for the rooms that pin them, and
// never for new rooms (BI-CB5C0DCE, spec OBJ-PIN: AC-PIN-1, AC-PIN-2, AC-GATE-3).

import { describe, expect, it, vi } from "vitest";

import { resolveDrivePlan } from "./drive-resolution";
import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";
import { WORK_SHAPE_PRIOR_VERSIONS } from "./work-shape-prior-versions";
import { getWorkShape, listWorkShapes, validateWorkShape, type WorkShapeDefinitionContract } from "./work-shapes";

const PINNED_KEY = "dependency-advisory-watch";

function person(principalRef: string, roles: WorkroomParticipantRole[], kind: "person" | "agent" = "person"): WorkroomParticipantView {
  return {
    principalRef, displayName: principalRef, kind, roles, workState: "unknown", presence: "unknown",
    currentWorkSummary: null, enteredReason: null, sponsorPrincipalRef: null, authoritySummary: "", sourceRefs: [],
    assignmentSource: "explicit", coordinatorSource: roles.includes("coordinator") ? "explicit" : "none",
  };
}

const ROSTER = [
  person("PRN-COORD", ["coordinator"], "agent"),
  person("PRN-OWNER", ["accountable"]),
  person("PRN-REVIEWER", ["reviewer"]),
];

vi.mock("./work-shape-prior-versions", async () => {
  const { STANDING_SHAPES } = await import("./standing-operations-shapes");
  const current = Object.values(STANDING_SHAPES).find((shape) => shape.key === "dependency-advisory-watch");
  return { WORK_SHAPE_PRIOR_VERSIONS: current ? [{ ...current, version: "0.9.0" }] : [] };
});

function semverParts(version: string): number[] {
  return version.split(".").map(Number);
}

function lower(a: string, b: string): boolean {
  const [x, y] = [semverParts(a), semverParts(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i]! < y[i]!;
  return false;
}

describe("prior work-shape versions", () => {
  it("every prior version names a current shape, sits below it, and is itself valid", () => {
    const seen = new Set<string>();
    for (const prior of WORK_SHAPE_PRIOR_VERSIONS) {
      const current = getWorkShape(prior.key);
      expect(current, `${prior.key}@${prior.version} has no current shape`).not.toBeNull();
      expect(lower(prior.version, current!.version), `${prior.key}@${prior.version} is not below ${current!.version}`).toBe(true);
      expect(validateWorkShape(prior)).toEqual([]);
      const ref = `${prior.key}@${prior.version}`;
      expect(seen.has(ref), `${ref} is listed twice`).toBe(false);
      seen.add(ref);
    }
  });

  it("a room pinned to a prior version still resolves; the current version still resolves", async () => {
    const { resolveWorkShapeClaim } = await import("./workroom-shape-claim");
    const current = getWorkShape(PINNED_KEY)!;
    expect(resolveWorkShapeClaim([{ workShape: `${PINNED_KEY}@0.9.0` }])?.version).toBe("0.9.0");
    expect(resolveWorkShapeClaim([{ workShape: `${PINNED_KEY}@${current.version}` }])?.version).toBe(current.version);
    expect(resolveWorkShapeClaim([{ workShape: `${PINNED_KEY}@0.1.0` }])).toBeNull();
  });

  it("creating a room or adopting a claim refuses a superseded version", async () => {
    const { resolveCurrentWorkShapeClaim } = await import("./workroom-shape-claim");
    const { normalizePersistedScope } = await import("@/lib/work-capsules/scope-input");
    const current = getWorkShape(PINNED_KEY)!;
    expect(resolveCurrentWorkShapeClaim([{ workShape: `${PINNED_KEY}@0.9.0` }])).toBeNull();
    expect(() => normalizePersistedScope({ workShape: `${PINNED_KEY}@0.9.0` })).toThrow(/not an available execution definition version/);
    expect(normalizePersistedScope({ workShape: `${PINNED_KEY}@${current.version}` }).workShape).toBe(`${PINNED_KEY}@${current.version}`);
  });

  it("the registry listing is unchanged by prior versions", () => {
    expect(listWorkShapes().filter((shape) => shape.key === PINNED_KEY)).toHaveLength(1);
  });
});

describe("a version change does not re-run a stage whose binding is unchanged", () => {
  const stage = (key: string, tools: string[]) => ({
    key,
    title: key,
    accountablePrincipalRef: "agent:watcher",
    advance: { kind: "status-change" as const, condition: `${key} done` },
    evidence: ["assurance-finding" as const],
    tools,
  });
  const v1: WorkShapeDefinitionContract = {
    key: "obligation-assurance-watch",
    version: "1.0.0",
    title: "Test shape",
    description: "A shape used in tests.",
    triggers: ["cadence"],
    stages: [stage("scan", ["read_a"]), stage("raise", ["read_b"])],
    stopConditions: [
      { kind: "success", condition: "done", disposition: "proceed" },
      { kind: "failure", condition: "failed", disposition: "inconclusive" },
      { kind: "budget", condition: "exhausted", disposition: "awaiting-person" },
    ],
    grants: ["tool:read"],
    measures: [{ key: "findings-raised", description: "Findings raised" }],
    budgets: [{ kind: "findings-per-run", limit: 200, unit: "findings" }],
    reviewPoint: { everyDays: 7, description: "Weekly review" },
  };
  // The widening touches only the second stage.
  const v2: WorkShapeDefinitionContract = {
    ...v1,
    version: "1.1.0",
    stages: [stage("scan", ["read_a"]), stage("raise", ["read_b", "list_pull_requests"])],
  };

  it("receipts are keyed by stage, so the next version resumes after the completed stage", () => {
    const planFor = (definition: WorkShapeDefinitionContract) => resolveDrivePlan({
      roomId: "WC-REBIND",
      definition,
      collaborationShape: "approval-sign-off",
      postureLevel: "balanced",
      participants: ROSTER,
      currentStageKey: "scan",
      receipts: [{ stageKey: "scan", kind: "findings" }],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      substrateReachable: true,
      substrateEmpty: false,
      coordinatorHasProcessCoordinationAuthority: true,
      coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
      now: new Date("2026-10-02T00:00:00Z"),
    });
    const before = planFor(v1);
    const after = planFor(v2);
    expect(before.action).toBe("dispatch_agent");
    expect(before.stageKey).toBe("raise");
    expect(after.action).toBe("dispatch_agent");
    expect(after.stageKey).toBe("raise");
  });
});
