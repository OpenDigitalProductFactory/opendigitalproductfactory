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
