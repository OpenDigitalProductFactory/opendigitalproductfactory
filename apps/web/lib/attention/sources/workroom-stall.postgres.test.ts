import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRoomStallRows } from "./workroom-stall";

// Explicit opt-in to a governed PostgreSQL target. Every statement is read-only;
// fixture CTEs shadow the physical tables without creating or modifying records.
const url = process.env.DPF_SQL_TEST_DATABASE_URL;
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

  function fixture(histories: Array<{ id: string; actions: Array<string | null>; status?: string; archived?: boolean }>) {
    const rooms = histories.map(h => ({
      id: h.id, capsuleId: h.id, title: h.id, portfolioRole: null,
      updatedAt: "2026-01-01T00:00:00Z", archivedAt: h.archived ? "2026-01-01T00:00:00Z" : null,
      status: h.status ?? "ready", scopeClaims: {}, workspaceState: { workroomDrive: { action: h.actions.at(-1) } },
    }));
    const activities = histories.flatMap(h => h.actions.map((action, i) => ({
      id: `${h.id}-${String(i).padStart(6, "0")}`, workCapsuleId: h.id,
      recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      kind: "workroom-drive", payload: { action },
    })));
    return {
      text: `WITH "WorkCapsule" AS (
        SELECT * FROM jsonb_to_recordset($3::jsonb) AS w(id text, "capsuleId" text, title text, "portfolioRole" text,
          "updatedAt" timestamptz, "archivedAt" timestamptz, status text, "scopeClaims" jsonb, "workspaceState" jsonb)
      ), "WorkCapsuleActivity" AS (
        SELECT * FROM jsonb_to_recordset($4::jsonb) AS a(id text, "workCapsuleId" text, "recordedAt" timestamptz, kind text, payload jsonb)
      ), ${sql.replace(/^\s*WITH\s+/i, "")}`,
      values: [...parameters, JSON.stringify(rooms), JSON.stringify(activities)],
    };
  }

  it("does not rescan the history through a correlated subplan for each tick", async () => {
    const query = fixture([{ id: "room", actions: Array(100).fill("pause") }]);
    const plan = await client.query({ ...query, text: `EXPLAIN (FORMAT JSON) ${query.text}` });
    expect(JSON.stringify(plan.rows)).not.toContain("SubPlan");
  });

  it("keeps mixed refusal streaks, resets, null actions, threshold and terminal exclusions", async () => {
    const p = Array(4).fill("pause");
    const query = fixture([
      { id: "mixed", actions: ["dispatch", "pause", "escalate", "pause", "escalate", "pause"] },
      { id: "reset", actions: [...p, "dispatch", ...p] },
      { id: "null-reset", actions: [...p, null, "pause"] },
      { id: "short", actions: p.slice(1) },
      { id: "advancing", actions: [...p, "dispatch"] },
      { id: "complete", actions: p, status: "complete" },
      { id: "abandoned", actions: p, status: "abandoned" },
      { id: "archived", actions: p, archived: true },
      { id: "empty", actions: [] },
    ]);
    const result = await client.query(query);
    expect(result.rows.map(r => [r.capsuleId, Number(r.consecutivePauses)])).toEqual([["mixed", 5], ["reset", 4]]);
  });

  it("handles 40000 refusal ticks within the database statement budget", async () => {
    const result = await client.query(fixture(Array.from({ length: 20 }, (_, i) => ({
      id: `room-${i}`, actions: Array(2000).fill("pause"),
    }))));
    expect(result.rows).toHaveLength(20);
    expect(result.rows.every(r => Number(r.consecutivePauses) === 2000)).toBe(true);
  });
});
