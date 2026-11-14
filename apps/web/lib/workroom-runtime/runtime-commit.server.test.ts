import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-C64EDA33 (AC-1, AC-3): one runtime command commits its log rows, the
// room's runtime record, the receipt and its outbox effects in one
// transaction, and a retry of the same command id replays the stored reply.
// The fake database stages every write and keeps it only when the
// transaction's function returns, as Postgres does.

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));

import { createRuntimeCommitter } from "./runtime-commit.server";
import type { RuntimeCommand } from "./runtime-decider";

type Row = Record<string, unknown>;
type State = { activities: Row[]; effects: Row[]; workspaceState: Record<string, unknown> };

const actor = { userId: "user-1", agentId: "agent-1", principalId: "prn-1" };
const supervised = {
  provider: "codex", threadId: "thr-1", tokenId: "tok-1", status: "supervised", openedAt: "x", cwd: "/workspace", actor,
  generation: "gen-1", queuedInputs: [], activeTurnId: null, turnPending: false,
};

function fakeDb(failOnEffectInsert = { value: false }) {
  let committed: State = { activities: [], effects: [], workspaceState: { runtimeSession: supervised } };
  let n = 0;
  const db = {
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const staged: State = JSON.parse(JSON.stringify(committed));
      const tx = {
        workroom: { findUnique: async () => ({ id: "row-1", workspaceState: staged.workspaceState }) },
        workroomActivity: {
          create: async ({ data }: { data: Row }) => { const row = { id: `act-${++n}`, ...data }; staged.activities.push(row); return row; },
          findFirst: async ({ where }: { where: Row }) =>
            staged.activities.find((a) => a["commandScopeKey"] === where["commandScopeKey"] && a["commandKey"] === where["commandKey"]) ?? null,
        },
        $queryRaw: async () => [{ id: "row-1" }],
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (strings.join("?").includes("jsonb_set")) staged.workspaceState = { ...staged.workspaceState, runtimeSession: JSON.parse(String(values[0])) };
          return 1;
        },
        $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
          if (sql.includes(`INSERT INTO "WorkroomEffect"`)) {
            if (failOnEffectInsert.value) throw new Error("effect insert failed");
            staged.effects.push({ commandId: params[2], ordinal: params[3], kind: params[4], processBound: params[5], sessionGeneration: params[6] });
          }
          return [];
        },
      };
      const result = await fn(tx);
      committed = staged; // reached only when fn returned: a throw discards every staged write
      return result;
    },
  };
  return { db, state: () => committed };
}

const request: RuntimeCommand = { type: "turn.request", prompt: "go", steer: false, supportsSteer: true };

describe("commitRuntimeCommand", () => {
  let fail: { value: boolean };
  beforeEach(() => { fail = { value: false }; });

  it("commits the record, the receipt and the outbox effect together", async () => {
    const { db, state } = fakeDb(fail);
    const commit = createRuntimeCommitter({ db, now: () => new Date("2026-11-14T05:00:00Z") });
    await expect(commit({ capsuleId: "WC-1", commandId: "cmd-1", command: request, actor })).resolves.toEqual({ outcome: "started" });
    expect(state().workspaceState["runtimeSession"]).toMatchObject({ turnPending: true });
    expect(state().effects).toEqual([{ commandId: "cmd-1", ordinal: 0, kind: "start-turn", processBound: true, sessionGeneration: "gen-1" }]);
    expect(state().activities).toEqual([expect.objectContaining({ kind: "command-accepted", commandScopeKey: "workroom-runtime:WC-1", commandKey: "cmd-1" })]);
  });

  it("a failure after the log rows are written leaves nothing: no log row, no record change, no effect, no receipt", async () => {
    const { db, state } = fakeDb(fail);
    const commit = createRuntimeCommitter({ db });
    const event: RuntimeCommand = { type: "runtime.event", generation: "gen-1", at: "x",
      event: { type: "turn-completed", turnId: "t1", status: "failed", error: "boom" } };
    fail.value = true;
    await expect(commit({ capsuleId: "WC-1", commandId: "ev-1", command: event, actor })).rejects.toThrow("effect insert failed");
    expect(state()).toEqual({ activities: [], effects: [], workspaceState: { runtimeSession: supervised } });
    // The retry, with the same deterministic id, lands once.
    fail.value = false;
    await commit({ capsuleId: "WC-1", commandId: "ev-1", command: event, actor });
    expect(state().activities.map((a) => a["kind"])).toEqual(["error", "command-accepted"]);
    expect(state().effects).toEqual([expect.objectContaining({ kind: "record-plan-limit", processBound: false, sessionGeneration: null })]);
  });

  it("a repeated command id replays its stored reply and decides nothing again", async () => {
    const { db, state } = fakeDb(fail);
    const commit = createRuntimeCommitter({ db });
    const first = await commit({ capsuleId: "WC-1", commandId: "cmd-1", command: request, actor });
    const again = await commit({ capsuleId: "WC-1", commandId: "cmd-1", command: request, actor });
    expect(again).toEqual(first);
    expect(state().effects).toHaveLength(1);
    expect(state().activities.filter((a) => a["kind"] === "command-accepted")).toHaveLength(1);
  });
});
