// Conformance for the standing business-operations shapes (BI-7E7B93DF).
//
// The §8.11 MUSTs are already asserted over the whole registry in
// work-shapes.test.ts. These are the properties specific to standing business
// work — the ones that, if they ever stopped holding, would mean an unattended
// activity had quietly acquired the authority to act on the business.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDrivePlan } from "./drive-resolution";
import { WORKROOM_SHAPE_KEYS } from "./room-shapes";
import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";
import { STANDING_OPERATIONS_SHAPE_KEYS } from "./standing-operations-shapes";
import {
  getWorkShape,
  readWorkShapeDefinitionContract,
  validateWorkShape,
  type WorkShapeDefinition,
  type WorkShapeStage,
} from "./work-shapes";

const STANDING_SHAPES: WorkShapeDefinition[] = STANDING_OPERATIONS_SHAPE_KEYS.map((key) => {
  const shape = getWorkShape(key);
  if (!shape) throw new Error(`declared standing shape ${key} is not in the registry`);
  return shape;
});

function agentRefs(shape: WorkShapeDefinition): string[] {
  return shape.stages
    .map((stage) => stage.accountablePrincipalRef)
    .filter((ref) => ref.startsWith("agent:"))
    .map((ref) => ref.slice("agent:".length));
}

/** Canonical coworker slugs, read from the seed registry rather than restated here. */
function registryAgentNames(): Set<string> {
  const file = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "packages",
    "db",
    "data",
    "agent_registry.json",
  );
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const rows: unknown[] = Array.isArray(parsed)
    ? parsed
    : Object.values((parsed ?? {}) as Record<string, unknown>).flatMap((value) =>
      Array.isArray(value) ? value : [value]
    );
  const names = new Set<string>();
  for (const row of rows) {
    const name = (row as Record<string, unknown> | null)?.agent_name;
    if (typeof name === "string") names.add(name);
  }
  return names;
}

describe("the platform layer never depends on the archetype layer", () => {
  // Demarcation test 3. The drive substrate must stay archetype-agnostic: if a
  // work-management module could import an archetype, one business's shape
  // could leak into the runtime that serves every business.
  it("has no work-management module importing an archetype definition", () => {
    const dir = __dirname;
    const offenders: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
      const body = readFileSync(path.join(dir, entry), "utf8");
      if (/from\s+["'][^"']*storefront-templates\/(src\/)?archetypes/.test(body)) {
        offenders.push(entry);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("standing business-operations shapes", () => {
  it("declares every key it exports, and each passes the §8.11 rules", () => {
    expect(STANDING_SHAPES).toHaveLength(STANDING_OPERATIONS_SHAPE_KEYS.length);
    for (const shape of STANDING_SHAPES) {
      expect(validateWorkShape(shape), shape.key).toEqual([]);
    }
  });

  it("names only coworkers that exist in the seeded registry", () => {
    // A shape that names an agent nobody hired is a fabrication that would fail
    // at dispatch time, in an unattended run, with nobody watching.
    const known = registryAgentNames();
    expect(known.size).toBeGreaterThan(0);
    for (const shape of STANDING_SHAPES) {
      for (const agent of agentRefs(shape)) {
        expect(known, `${shape.key} names agent:${agent}`).toContain(agent);
      }
    }
  });

  it("binds each shape to a real collaboration shape", () => {
    for (const shape of STANDING_SHAPES) {
      expect(WORKROOM_SHAPE_KEYS, shape.key).toContain(shape.collaborationShape);
    }
  });

  it("keeps every consequential act on a human stage behind a governed decision", () => {
    // Sending outward, moving money, rotating a credential, merging a change,
    // admitting work or a contributor, and changing authority. Each is named in
    // the design as never-unattended. This asserts the property structurally
    // rather than trusting the prose.
    const consequential = new Set([
      "send",
      "pay",
      "rotate",
      "merge",
      "cut",
      "admit",
      "grant",
      "decide",
      "approve",
      "act",
    ]);
    let checked = 0;
    for (const shape of STANDING_SHAPES) {
      for (const stage of shape.stages) {
        if (!consequential.has(stage.key)) continue;
        checked += 1;
        expect(
          stage.accountablePrincipalRef.startsWith("role:"),
          `${shape.key}/${stage.key} must be owned by a role, not an agent`,
        ).toBe(true);
        expect(stage.advance.kind, `${shape.key}/${stage.key}`).toBe("governed-decision");
      }
    }
    // Every standing shape ends in exactly one such stage.
    expect(checked).toBe(STANDING_SHAPES.length);
  });

  it("gives every shape a bounded budget and a named failure exit", () => {
    for (const shape of STANDING_SHAPES) {
      expect(shape.budgets.length, shape.key).toBeGreaterThan(0);
      for (const budget of shape.budgets) {
        expect(budget.limit, `${shape.key} budget`).toBeGreaterThan(0);
      }
      const failure = shape.stopConditions.find((stop) => stop.kind === "failure");
      expect(failure, shape.key).toBeDefined();
      // The failure exit must say what it REFUSES to do, so a failed or empty
      // read can never surface as a clean result.
      expect(failure?.condition.toLowerCase(), shape.key).toMatch(
        /never|does not|rather than/,
      );
    }
  });
});

function participant(
  principalRef: string,
  roles: WorkroomParticipantRole[],
  extras: Partial<WorkroomParticipantView> = {},
): WorkroomParticipantView {
  return {
    principalRef,
    displayName: principalRef,
    kind: extras.kind ?? "person",
    roles,
    workState: "unknown",
    presence: "unknown",
    currentWorkSummary: null,
    enteredReason: null,
    sponsorPrincipalRef: null,
    authoritySummary: "",
    sourceRefs: [],
    assignmentSource: extras.assignmentSource ?? "explicit",
    coordinatorSource: extras.coordinatorSource ?? (roles.includes("coordinator") ? "explicit" : "none"),
    ...extras,
  };
}

const roster: WorkroomParticipantView[] = [
  participant("PRN-COORD", ["coordinator"], { kind: "agent", coordinatorSource: "explicit" }),
  participant("PRN-OWNER", ["accountable"]),
  participant("PRN-REVIEWER", ["reviewer"]),
];

function planFor(shape: WorkShapeDefinition, stage: WorkShapeStage) {
  return resolveDrivePlan({
    roomId: `WC-${shape.key}`,
    definition: readWorkShapeDefinitionContract(shape),
    collaborationShape: shape.collaborationShape,
    postureLevel: "assertive",
    participants: roster,
    currentStageKey: null,
    receipts: [],
    budgetUsage: [],
    stopConditionHits: [],
    reviewDue: false,
    substrateReachable: true,
    substrateEmpty: false,
    coordinatorHasProcessCoordinationAuthority: true,
    now: new Date("2026-09-01T00:00:00.000Z"),
    proposedStageKey: stage.key,
  });
}

describe("the runner refuses the human stages of every standing shape", () => {
  it("never dispatches an agent for a role-owned or governed stage, even at assertive", () => {
    for (const shape of STANDING_SHAPES) {
      for (const stage of shape.stages) {
        const isHuman = stage.accountablePrincipalRef.startsWith("role:")
          || stage.accountablePrincipalRef.startsWith("person:");
        const isGoverned = stage.advance.kind === "governed-decision";
        if (!isHuman && !isGoverned) continue;
        const plan = planFor(shape, stage);
        expect(plan.action, `${shape.key}/${stage.key}`).not.toBe("dispatch_agent");
        expect(plan.agentId, `${shape.key}/${stage.key}`).toBeNull();
      }
    }
  });

  it("stops rather than reporting a clean result when the substrate cannot be read", () => {
    for (const shape of STANDING_SHAPES) {
      const plan = resolveDrivePlan({
        roomId: `WC-${shape.key}`,
        definition: readWorkShapeDefinitionContract(shape),
        collaborationShape: shape.collaborationShape,
        postureLevel: "assertive",
        participants: roster,
        currentStageKey: null,
        receipts: [],
        budgetUsage: [],
        stopConditionHits: [],
        reviewDue: false,
        substrateReachable: false,
        substrateEmpty: false,
        now: new Date("2026-09-01T00:00:00.000Z"),
      });
      expect(plan.action, shape.key).toBe("stop");
      expect(plan.agentId, shape.key).toBeNull();
    }
  });

  it("does not wake any standing shape when the room's posture is quiet", () => {
    for (const shape of STANDING_SHAPES) {
      const plan = resolveDrivePlan({
        roomId: `WC-${shape.key}`,
        definition: readWorkShapeDefinitionContract(shape),
        collaborationShape: shape.collaborationShape,
        postureLevel: "quiet",
        participants: roster,
        currentStageKey: null,
        receipts: [],
        budgetUsage: [],
        stopConditionHits: [],
        reviewDue: false,
        substrateReachable: true,
        substrateEmpty: false,
        now: new Date("2026-09-01T00:00:00.000Z"),
      });
      expect(plan.action, shape.key).toBe("do_not_wake");
    }
  });
});
