// BI-8E1486FA — what the overseer could not resolve reaches the room's overseer, once.

import { describe, expect, it, vi } from "vitest";

import { EMPTY_OVERSEER_STATE, planOverseerDuty, type OverseerRoom } from "@/lib/work-management/workroom-overseer-duty";

import { attentionSourceLoaders } from "../aggregate";
import { loadWorkroomOverseerItems, projectOverseerAttention } from "./workroom-overseer";

const NOW = new Date("2026-10-27T12:00:00.000Z");

function raisedState(assigneePrincipalRef: string | null) {
  const room: OverseerRoom = {
    id: "row-1", capsuleId: "WC-ROOM1", status: "ready", idempotencyKey: null, shapeKey: "delivery-medium", itemKey: "BI-ITEM1",
    itemStatus: "in-progress", itemEffortSize: "medium", leaseExpiresAt: new Date(NOW.getTime() - 6 * 86_400_000), merged: false,
    openPullRequest: false, pullRequestNumber: null, authoredHead: true, hold: null, driveAction: null, driveReason: null,
    assigneePrincipalRef, overseer: EMPTY_OVERSEER_STATE, inScan: true,
  };
  const [action] = planOverseerDuty([room], NOW);
  if (action?.kind !== "route") throw new Error("expected a route");
  return { workroomOverseer: action.next };
}

describe("projectOverseerAttention", () => {
  it("lists one item per room, deep-linked to the room and addressed to its overseer", () => {
    const item = projectOverseerAttention({ capsuleId: "WC-ROOM1", title: "Work on BI-ITEM1", updatedAt: NOW, workspaceState: raisedState("PRN-PO") });
    expect(item).toMatchObject({
      id: "workroom-overseer:WC-ROOM1",
      source: "workroom-stall",
      audience: { operator: true, assigneePrincipalId: "PRN-PO" },
      createdAtIso: NOW.toISOString(),
    });
    expect(item?.deepLink).toMatch(/^\/workspace\/cases\//);
    expect(item?.actions[0]).toMatchObject({ kind: "open-in-context", href: item?.deepLink });
    expect(item?.context).toContain("resume grace");
  });

  it("routes to the operator alone when the room has no overseer", () => {
    const item = projectOverseerAttention({ capsuleId: "WC-ROOM1", title: "t", updatedAt: NOW, workspaceState: raisedState(null) });
    expect(item?.audience).toEqual({ operator: true });
  });

  it("lists nothing for a room with no raised record", () => {
    expect(projectOverseerAttention({ capsuleId: "WC-ROOM1", title: "t", updatedAt: NOW, workspaceState: {} })).toBeNull();
  });

  it("reads rows through one bounded query and drops rows with nothing raised", async () => {
    const $queryRaw = vi.fn(async () => [
      { capsuleId: "WC-A", title: "a", updatedAt: NOW, workspaceState: raisedState("PRN-PO") },
      { capsuleId: "WC-B", title: "b", updatedAt: NOW, workspaceState: { workroomOverseer: { attention: null } } },
    ]);
    const items = await loadWorkroomOverseerItems({ $queryRaw } as never);
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(items.map((item) => item.id)).toEqual(["workroom-overseer:WC-A"]);
  });

  it("is wired into the attention aggregate", () => {
    const loaders = attentionSourceLoaders({} as never);
    expect(loaders.filter((loader) => loader.source === "workroom-stall")).toHaveLength(2);
  });
});

// BI-3A515481: on 2026-10-28 the overseer raised 38 cards and every one read
// "judgment", so "Needs you" went from 7 to 44 with session resumes and
// agent-capacity waits the owner cannot act on.
describe("which overseer items ask the owner for judgment", () => {
  function heldState(holdKey: string, outcome: "needs-owner" | "derived-size" = "needs-owner") {
    return {
      workroomOverseer: {
        version: 1,
        attention: { key: `R4:${holdKey}`, rule: "R4", title: "held", context: "held past budget", raisedAt: NOW.toISOString(), assigneePrincipalRef: "PRN-PO" },
        needsResume: null,
        holdConclusion: { holdKey, outcome, derivedSize: outcome === "derived-size" ? "medium" : null, ticks: 60, concludedAt: NOW.toISOString() },
      },
    };
  }
  const effort = (workspaceState: unknown) =>
    projectOverseerAttention({ capsuleId: "WC-ROOM1", title: "t", updatedAt: NOW, workspaceState })?.triage.decideEffort;

  it("a session to resume or hand over is recovery work, not a business choice", () => {
    expect(effort(raisedState("PRN-PO"))).toBe("review");
  });

  it("a hold on an agent-side wait is recovery work", () => {
    for (const key of [
      "pause|executor_writeback_unavailable|design-note",
      "pause|awaiting_agent_capacity|implement",
      "pause|missing_task_owner|reproduce",
      "dispatch_agent|provider_held|repair",
    ]) expect(effort(heldState(key)), key).toBe("review");
  });

  it("a hold the drive already derived the fix for (a size) is recovery work", () => {
    expect(effort(heldState("attention|governed_decision|spec-approval", "derived-size"))).toBe("review");
  });

  it("a hold on a person, role or governed decision still asks the owner", () => {
    for (const key of ["attention|governed_decision|spec-approval", "attention|role_stage|accept", "attention|person_stage|review", "escalate|conformance_escalate|merge"]) {
      expect(effort(heldState(key)), key).toBe("judgment");
    }
  });

  it("routes recovery items to the custodian and decisions to Needs you", async () => {
    const { classifyOwnerAttentionLane } = await import("../owner-routing");
    const resume = projectOverseerAttention({ capsuleId: "WC-ROOM1", title: "t", updatedAt: NOW, workspaceState: raisedState("PRN-PO") })!;
    const decision = projectOverseerAttention({ capsuleId: "WC-ROOM1", title: "t", updatedAt: NOW, workspaceState: heldState("attention|governed_decision|spec-approval") })!;
    expect(classifyOwnerAttentionLane(resume).lane).toBe("custodian");
    expect(classifyOwnerAttentionLane(decision).lane).toBe("needs-you-now");
  });
});
