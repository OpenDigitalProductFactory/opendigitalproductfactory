import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nextDriveHold, type WorkroomDriveHold } from "@/lib/work-management/workroom-drive-hold";

import { loadRoomStallRows } from "./workroom-stall";

// Explicit opt-in to a governed PostgreSQL target. Every statement is read-only;
// fixture CTEs shadow the physical tables without creating or modifying records.
const url = process.env.DPF_SQL_TEST_DATABASE_URL
  ?? (process.env.CI === "true" ? process.env.DATABASE_URL : undefined);
const databaseSuite = url ? describe : describe.skip;

databaseSuite("Workroom stall SQL on PostgreSQL", () => {
  let client: Client;
  let sql: string;
  let parameters: unknown[];
  beforeAll(async () => {
    client = new Client({ connectionString: url, options: "-c default_transaction_read_only=on -c statement_timeout=5000" });
    await client.connect();
    await loadRoomStallRows({
      $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
        sql = parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, "");
        parameters = values;
        return [];
      },
    } as unknown as Parameters<typeof loadRoomStallRows>[0]);
  });
  afterAll(async () => { await client?.end(); });

  /** The drive's own hold after replaying these tick actions (BI-E8C78E80). */
  function holdAfter(actions: Array<string | null>): WorkroomDriveHold | null {
    let hold: WorkroomDriveHold | null = null;
    actions.forEach((action, i) => {
      hold = nextDriveHold(hold, { action: action ?? "unknown", reason: "r", stageKey: "s", conformance: null },
        new Date(Date.UTC(2026, 0, 1, 0, 15 * i)));
    });
    return hold;
  }

  function fixture(histories: Array<{ id: string; actions: Array<string | null>; status?: string; archived?: boolean }>) {
    const rooms = histories.map(h => ({
      id: h.id, capsuleId: h.id, title: h.id, portfolioRole: null,
      updatedAt: "2026-01-01T00:00:00Z", archivedAt: h.archived ? "2026-01-01T00:00:00Z" : null,
      status: h.status ?? "ready", scopeClaims: {},
      workspaceState: { workroomDrive: { action: h.actions.at(-1) ?? null, hold: holdAfter(h.actions) } },
    }));
    return {
      text: `WITH "WorkCapsule" AS (
        SELECT * FROM jsonb_to_recordset($3::jsonb) AS w(id text, "capsuleId" text, title text, "portfolioRole" text,
          "updatedAt" timestamptz, "archivedAt" timestamptz, status text, "scopeClaims" jsonb, "workspaceState" jsonb)
      ) ${sql}`,
      values: [...parameters, JSON.stringify(rooms)],
    };
  }

  it("reads the drive's hold from the room row, with no scan of the activity history", async () => {
    const query = fixture([{ id: "room", actions: Array(100).fill("pause") }]);
    const plan = await client.query({ ...query, text: `EXPLAIN (FORMAT JSON) ${query.text}` });
    expect(JSON.stringify(plan.rows)).not.toContain("WorkCapsuleActivity");
    expect(JSON.stringify(plan.rows)).not.toContain("SubPlan");
  });

  it("keeps mixed refusal streaks, resets, null actions, threshold and terminal exclusions", async () => {
    const p = Array(4).fill("pause");
    const query = fixture([
      { id: "mixed", actions: ["dispatch_agent", "pause", "escalate", "pause", "escalate", "pause"] },
      { id: "reset", actions: [...p, "dispatch_agent", ...p] },
      { id: "null-reset", actions: [...p, null, "pause"] },
      { id: "short", actions: p.slice(1) },
      { id: "advancing", actions: [...p, "dispatch_agent"] },
      { id: "complete", actions: p, status: "complete" },
      { id: "abandoned", actions: p, status: "abandoned" },
      { id: "archived", actions: p, archived: true },
      { id: "empty", actions: [] },
    ]);
    const result = await client.query(query);
    expect(result.rows.map(r => [r.capsuleId, Number(r.consecutivePauses)])).toEqual([["mixed", 5], ["reset", 4]]);
    expect(result.rows.find(r => r.capsuleId === "mixed")?.stuckSince).toBe("2026-01-01T00:15:00.000Z");
  });
});
