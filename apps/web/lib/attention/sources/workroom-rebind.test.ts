// A room behind its shape's registry version reaches its owner, once
// (BI-CB5C0DCE, OBJ-OWNER: AC-OWNER-1).

import { describe, expect, it, vi } from "vitest";

const KEY = "dependency-advisory-watch";

vi.mock("@/lib/work-management/work-shape-prior-versions", async () => {
  const { STANDING_SHAPES } = await import("@/lib/work-management/standing-operations-shapes");
  const current = Object.values(STANDING_SHAPES).find((shape) => shape.key === "dependency-advisory-watch")!;
  return { WORK_SHAPE_PRIOR_VERSIONS: [{ ...current, version: "0.9.0", grants: [] }] };
});

import { getWorkShape } from "@/lib/work-management/work-shapes";
import { projectRoomRebind } from "./workroom-rebind";

const current = getWorkShape(KEY)!;
const row = (pinned: string, ownerPrincipalId: string | null = "PRN-OWNER") => ({
  id: "row-1",
  capsuleId: "WC-ROOM",
  title: "Dependency advisories",
  scopeClaims: [{ workShape: pinned, recordedAt: "2026-09-01T00:00:00.000Z" }],
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  ownerPrincipalId,
});

describe("projectRoomRebind", () => {
  it("is silent for a room on the current version, or with no pin", () => {
    expect(projectRoomRebind(row(`${KEY}@${current.version}`))).toBeNull();
    expect(projectRoomRebind({ ...row(`${KEY}@0.9.0`), scopeClaims: [] })).toBeNull();
  });

  it("names the widening and routes to the room's owner", () => {
    const item = projectRoomRebind(row(`${KEY}@0.9.0`))!;
    expect(item.source).toBe("workroom-rebind");
    expect(item.triage.residueReason).toBe("awaiting-rebind");
    expect(item.context).toContain(`${KEY}@0.9.0`);
    expect(item.context).toContain("widens");
    expect(item.audience).toEqual({ operator: true, assigneePrincipalId: "PRN-OWNER" });
    expect(item.deepLink).toMatch(/^\/workspace\/cases\//);
  });

  it("is one item per room and target version, however many drive ticks pass", () => {
    const first = projectRoomRebind(row(`${KEY}@0.9.0`))!;
    const later = projectRoomRebind({ ...row(`${KEY}@0.9.0`), updatedAt: new Date("2026-10-02T00:00:00Z") })!;
    expect(later.id).toBe(first.id);
  });

  it("says a pin the registry no longer holds cannot run, and goes to the operator without an owner", () => {
    const item = projectRoomRebind(row(`${KEY}@0.1.0`, null))!;
    expect(item.context).toContain("no longer in the registry");
    expect(item.audience).toEqual({ operator: true });
  });
});
