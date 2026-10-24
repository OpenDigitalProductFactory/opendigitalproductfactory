// BI-E8C78E80 — the operations surface lists rooms the drive is holding, with
// the reason and how long, from the drive's own snapshot.
import { describe, expect, it, vi } from "vitest";

import { loadHeldWorkrooms } from "./held-workrooms";

const room = (capsuleId: string, drive: Record<string, unknown>) => ({ capsuleId, title: capsuleId, workspaceState: { workroomDrive: drive } });

describe("loadHeldWorkrooms", () => {
  it("returns paused and escalated rooms, longest held first, with why and since", async () => {
    const findMany = vi.fn(async () => [
      room("WC-NEW", { action: "escalate", reason: "conformance_escalate", stageKey: "build",
        conformance: { deviations: [{ code: "coordinator_ineligible" }] },
        hold: { key: "k1", since: "2026-09-24T10:00:00.000Z", ticks: 2, stuckSince: "2026-09-24T09:30:00.000Z", stuckTicks: 3, notifiedAt: null } }),
      room("WC-OLD", { action: "pause", reason: "conformance_pause", stageKey: "spec", lastRunAt: "2026-09-24T11:00:00.000Z",
        conformance: { deviations: [{ code: "missing_explicit_coordinator" }] },
        hold: { key: "k2", since: "2026-09-22T00:00:00.000Z", ticks: 200, stuckSince: "2026-09-22T00:00:00.000Z", stuckTicks: 200, notifiedAt: "2026-09-22T01:00:00.000Z" } }),
      room("WC-LEGACY", { action: "pause", reason: "unknown_principal", lastRunAt: "2026-09-24T11:45:00.000Z" }),
      room("WC-MOVING", { action: "dispatch_agent", reason: "agent_stage" }),
    ]);
    const rows = await loadHeldWorkrooms({ workroom: { findMany } } as never);
    expect(rows.map((r) => r.capsuleId)).toEqual(["WC-OLD", "WC-NEW", "WC-LEGACY"]);
    expect(rows[0]).toMatchObject({ action: "pause", deviationCodes: ["missing_explicit_coordinator"], since: "2026-09-22T00:00:00.000Z", stuckTicks: 200, notifiedAt: "2026-09-22T01:00:00.000Z" });
    // A room held before the drive recorded holds falls back to its last tick, and says it cannot count.
    expect(rows[2]).toMatchObject({ reason: "unknown_principal", since: "2026-09-24T11:45:00.000Z", stuckTicks: null });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ archivedAt: null, status: { notIn: ["abandoned", "archived", "complete"] } }),
    }));
  });
});
