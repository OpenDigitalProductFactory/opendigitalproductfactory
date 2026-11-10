// Standing dispatched workers must be able to leave the completing evidence
// the drive reads (BI-CAP-AB63E190).
//
// After #5216 the stage brief names `record_workroom_evidence`, and after
// #5238/#5274 a new cycle re-dispatches. Live WC-0A92C30D did re-dispatch on
// 2026-09-14 and still could not write: every standing dispatched agent lacked
// the evidence-write grant, and every standing shape authorized only tool:read
// — a room that narrows, never widens (room-turn-authority.ts).
//
// workroom_evidence_write is the Pseudo-User Contract split of that one tool
// out of work_capsule_write, so a payables run cannot claim the local-CI lease.

import { describe, expect, it } from "vitest";

import { HARDCODED_COWORKER_GRANTS } from "@dpf/db/workforce-seed";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

import { roomAuthorizesTool, roomGrantsFromWorkShape } from "./room-turn-authority";
import { STANDING_OPERATIONS_SHAPE_KEYS } from "./standing-operations-shapes";
import { getWorkShape } from "./work-shapes";

const STAGE_EVIDENCE_TOOL = "record_workroom_evidence";
const STAGE_EVIDENCE_GRANT = "workroom_evidence_write";

function standingShapes() {
  return STANDING_OPERATIONS_SHAPE_KEYS.map((key) => {
    const shape = getWorkShape(key);
    if (!shape) throw new Error(`standing shape ${key} is missing from the registry`);
    return shape;
  });
}

function standingDispatchedAgents(): string[] {
  const names = new Set<string>();
  for (const shape of standingShapes()) {
    for (const stage of shape.stages) {
      const ref = stage.accountablePrincipalRef;
      if (ref.startsWith("agent:")) names.add(ref.slice("agent:".length));
    }
  }
  return [...names].sort();
}

describe("standing stage evidence writeback", () => {
  it("names the dispatched standing agents that exist on this install", () => {
    expect(standingDispatchedAgents()).toEqual([
      "build-specialist",
      "change-reviewer",
      "customer-advisor",
      "finance-controller",
      "platform-engineer",
      "portfolio-advisor",
      "security-engineer",
    ]);
  });

  it("authorizes record_workroom_evidence on every standing shape's room surface", () => {
    for (const shape of standingShapes()) {
      const grants = roomGrantsFromWorkShape(shape.grants);
      expect(grants, shape.key).toContain(STAGE_EVIDENCE_GRANT);
      expect(roomAuthorizesTool(STAGE_EVIDENCE_TOOL, grants), shape.key).toBe(true);
    }
  });

  it("lets every standing dispatched identity call record_workroom_evidence", () => {
    for (const agent of standingDispatchedAgents()) {
      const grants = HARDCODED_COWORKER_GRANTS[agent];
      expect(grants, agent).toBeDefined();
      expect(grants, agent).toContain(STAGE_EVIDENCE_GRANT);
      expect(isToolAllowedByGrants(STAGE_EVIDENCE_TOOL, [...(grants ?? [])]), agent).toBe(true);
    }
  });

  it("does not let the evidence grant claim a nonprod lease or create a room", () => {
    expect(isToolAllowedByGrants("claim_nonprod_environment_lease", [STAGE_EVIDENCE_GRANT])).toBe(false);
    expect(isToolAllowedByGrants("create_workroom", [STAGE_EVIDENCE_GRANT])).toBe(false);
    expect(isToolAllowedByGrants("declare_break_fix", [STAGE_EVIDENCE_GRANT])).toBe(false);
  });

  it("keeps work_capsule_write as a completing-evidence grant via implication", () => {
    expect(isToolAllowedByGrants(STAGE_EVIDENCE_TOOL, ["work_capsule_write"])).toBe(true);
  });
});
