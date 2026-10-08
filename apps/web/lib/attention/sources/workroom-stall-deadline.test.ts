// A graph room with a stage past its deadline reaches the attention inbox once
// (GPP Phase 3c PR-3c-4, BI-8875C9DF). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §8 ("The workroom-stall attention source lists rooms with an un-notified or
// open overdue deadline"); plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-4, lib/attention/sources/workroom-stall.ts).
//
// DEADLINE_FIXTURE is not registered (plan constraint 7), so the shape-claim
// resolver is overridden for its key only.

import { describe, expect, it, vi } from "vitest";

import { DEADLINE_FIXTURE } from "@/lib/work-management/__fixtures__/graph-shape-fixtures";
import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import { STALL_TICK_THRESHOLD, loadRoomStallRows, projectRoomStall, type RoomStallRow } from "./workroom-stall";

vi.mock("@/lib/work-management/workroom-shape-claim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/work-management/workroom-shape-claim")>();
  const { DEADLINE_FIXTURE: fixture } = await import("@/lib/work-management/__fixtures__/graph-shape-fixtures");
  return {
    ...actual,
    resolveWorkShapeClaim: (scopeClaims: unknown) => {
      const ref = actual.readWorkShapeClaim(scopeClaims);
      return ref?.key === fixture.key && ref.version === fixture.version ? fixture : actual.resolveWorkShapeClaim(scopeClaims);
    },
  };
});

const CYCLE = `${DEADLINE_FIXTURE.key}@${DEADLINE_FIXTURE.version}:2026-03-02`;
const RAISED = "2026-03-04T09:00:00.000Z";

function graphDrive(over: { action?: string; reason?: string; tokens?: unknown[]; iterations?: Record<string, number>; deadlines?: Record<string, unknown> } = {}) {
  return {
    kind: "workroom-drive",
    action: over.action ?? "dispatch_agent",
    reason: over.reason ?? "agent_stage",
    conformance: { deviations: [], processOverseerPrincipalRef: "PRN-OWNER" },
    marking: {
      format: "drive-marking/1",
      cycleKey: CYCLE,
      tokens: over.tokens ?? [{ node: "stage:b", enteredAt: "2026-03-02T09:00:00.000Z" }],
      iterations: over.iterations ?? {},
      reworkTaken: {},
      deadlines: over.deadlines ?? { [`${CYCLE}#b#0`]: { raisedAt: RAISED, notifiedAt: null } },
      children: {},
    },
  };
}

function scanRow(id: string, drive: unknown, consecutivePauses = 0) {
  return {
    id: `row-${id}`, capsuleId: id, title: `Room ${id}`, portfolioRole: null, updatedAt: new Date("2026-03-04T10:00:00.000Z"),
    drive, scopeClaims: [buildWorkShapeClaim({ key: DEADLINE_FIXTURE.key, version: DEADLINE_FIXTURE.version })], consecutivePauses, stuckSince: null,
  };
}

async function load(rows: ReturnType<typeof scanRow>[]): Promise<{ rows: RoomStallRow[]; sql: string }> {
  let sql = "";
  const db = {
    $queryRaw: async (parts: TemplateStringsArray) => {
      const text = parts.join("?");
      if (text.includes('"WorkCapsuleActivity"')) return [];
      sql = text;
      return rows;
    },
  } as unknown as Parameters<typeof loadRoomStallRows>[0];
  return { rows: await loadRoomStallRows(db), sql };
}

describe("a stage past its deadline is listed once, with the deadline reason (PR-3c-4)", () => {
  it("the scan also selects rooms whose drive marking holds a raised deadline", async () => {
    const { sql } = await load([]);
    expect(sql).toContain("'{workroomDrive,marking,deadlines}'");
    expect(sql).toContain("'pause', 'escalate'");
  });

  it("a moving room with an open deadline appears once, saying which stage is past its deadline", async () => {
    const { rows } = await load([scanRow("WC-DL", graphDrive())]);
    expect(rows[0]?.overdueStages).toEqual([{ stageKey: "b", stageTitle: "Stage b", description: "Two days.", raisedAt: RAISED }]);
    const items = rows.map(projectRoomStall).filter((item) => item !== null);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "workroom-stall:WC-DL",
      source: "workroom-stall",
      title: "Room WC-DL — past its deadline",
      createdAtIso: RAISED,
      audience: { operator: true, assigneePrincipalId: "PRN-OWNER" },
    });
    expect(items[0]?.context).toContain("Stage Stage b is past its deadline (Two days.)");
    expect(items[0]?.context).toContain("has not been moved");
  });

  it("a deadline whose token has left the stage, or was raised for an earlier iteration, lists nothing", async () => {
    const { rows } = await load([
      scanRow("WC-LEFT", graphDrive({ tokens: [] })),
      scanRow("WC-REWORKED", graphDrive({ iterations: { b: 1 } })),
    ]);
    expect(rows.map((row) => row.overdueStages)).toEqual([[], []]);
    expect(rows.map(projectRoomStall)).toEqual([null, null]);
  });

  it("a room that is stalled AND overdue is still one item: the stall, naming the overdue stage too", async () => {
    const { rows } = await load([scanRow("WC-BOTH", graphDrive({ action: "pause", reason: "executor_writeback_unavailable" }), STALL_TICK_THRESHOLD)]);
    const items = rows.map(projectRoomStall).filter((item) => item !== null);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Room WC-BOTH — stalled");
    expect(items[0]?.context).toContain("Stage Stage b is past its deadline (Two days.)");
  });

  it("a room with no marking, or a shape that cannot be resolved, reads no deadline", async () => {
    const { rows } = await load([
      { ...scanRow("WC-SEQ", { kind: "workroom-drive", action: "dispatch_agent", reason: "agent_stage" }) },
      { ...scanRow("WC-NOSHAPE", graphDrive()), scopeClaims: [] },
    ]);
    expect(rows.map((row) => row.overdueStages)).toEqual([[], []]);
  });
});
