import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-C64EDA33 (AC-1, AC-3): one runtime command commits its log rows, the
// room's runtime record, the receipt and its outbox effects in one
// transaction, and a retry of the same command id replays the stored reply.
// The fake database stages every write and keeps it only when the
// transaction's function returns, as Postgres does.

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));

import { createProtectedLaunchCommitter, createProtectedLaunchReservation, createRuntimeCommitter } from "./runtime-commit.server";
import { findProtectedExecutionBinding, protectedBindingIdentity, readProtectedExecutionBindings } from "./protected-execution-binding";
import type { RuntimeCommand } from "./runtime-decider";

type Row = Record<string, unknown>;
type State = { activities: Row[]; effects: Row[]; workspaceState: Record<string, unknown> };

const actor = { userId: "user-1", agentId: "agent-1", principalId: "prn-1" };
const supervised = {
  provider: "codex", threadId: "thr-1", tokenId: "tok-1", status: "supervised", openedAt: "x", cwd: "/workspace", actor,
  generation: "gen-1", queuedInputs: [], activeTurnId: null, inFlight: null,
};

function fakeDb(failOnEffectInsert = { value: false }, effectAlreadyExists = false, leaseAvailable = { value: true }) {
  let committed: State = { activities: [], effects: [], workspaceState: { runtimeSession: supervised } };
  let n = 0;
  const db = {
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const staged: State = JSON.parse(JSON.stringify(committed));
      const tx = {
        workroom: { findUnique: async () => ({ id: "row-1", status: "ready", archivedAt: null, workspaceState: staged.workspaceState }) },
        workroomActivity: {
          create: async ({ data }: { data: Row }) => { const row = { id: `act-${++n}`, ...data }; staged.activities.push(row); return row; },
          findFirst: async ({ where }: { where: Row }) =>
            staged.activities.find((a) => a["commandScopeKey"] === where["commandScopeKey"] && a["commandKey"] === where["commandKey"]) ?? null,
        },
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join("?");
          if (!sql.includes(`"WorkroomEffect"`)) return [{ id: "row-1" }]; // the receipt's room lock
          if (sql.includes(`INSERT INTO "WorkroomEffect"`)) {
            if (failOnEffectInsert.value) throw new Error("effect insert failed");
            if (effectAlreadyExists) return [];
            staged.effects.push({ commandId: values[2], ordinal: values[3], kind: values[4], processBound: values[5], sessionGeneration: values[6] });
            return [{ id: values[0] }];
          }
          if (sql.includes(`SELECT "id" FROM "WorkroomEffect"`)) return leaseAvailable.value ? [{ id: values[0] }] : [];
          return [];
        },
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join("?");
          if (sql.includes("jsonb_set")) staged.workspaceState = { ...staged.workspaceState,
            [sql.includes("{protectedExecution}") ? "protectedExecution" : "runtimeSession"]: JSON.parse(String(values[0])) };
          return 1;
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
    expect(state().workspaceState["runtimeSession"]).toMatchObject({ inFlight: { commandId: "cmd-1", prompt: "go" } });
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

describe("commit protected execution launch", () => {
  const now = new Date("2026-11-25T18:00:00Z");
  const host = { registrationRef: "registration-a", installationRef: "install-a", hostRef: "host-a", receiverRef: "receiver-a" };
  const worktree = { worktreeRef: "worktree-a", repositoryFullName: "org/repo", sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40) };
  const target = { installationRef: host.installationRef, roomRef: "WC-1", sessionRef: "session-a", stageAttemptRef: "stage-1", originRef: "origin-a", worktree };
  const routes = [{ kind: "loopback" as const, endpointRef: "loopback-a" }];
  const authority = { localInstallationRef: host.installationRef, target, owners: [{ host, worktree }], candidate: { ...host, routes },
    qualification: { ...host, qualificationRef: "qualification-a", revision: 4, status: "active" as const,
      worktreeRef: worktree.worktreeRef, expiresAt: now.getTime() + 10_000, allowedRoutes: routes } };
  const input = { target, commandId: "launch-1", actor };

  it("commits one pin, one receipt and one pending launch without touching local runtime state", async () => {
    const { db, state } = fakeDb();
    const readAuthority = vi.fn(async () => authority);
    const commit = createProtectedLaunchCommitter({ db, readAuthority, now: () => now });
    const result = await commit(input);
    expect(result).toMatchObject({ outcome: "bound", hostRef: host.hostRef });
    await expect(commit(input)).resolves.toEqual(result);
    await expect(commit({ ...input, commandId: "duplicate-attempt" })).resolves.toMatchObject({ outcome: "already-bound" });
    expect(state().workspaceState["protectedExecution"]).toMatchObject({ version: 1,
      bindings: [{ ...target, ...host, qualificationEpoch: 4 }] });
    expect(state().workspaceState["runtimeSession"]).toEqual(supervised);
    expect(state().effects).toEqual([{ commandId: expect.stringMatching(/^protected-launch:[a-f0-9]{64}$/), ordinal: 0,
      kind: "launch-protected-session", processBound: false, sessionGeneration: null }]);
    expect(state().activities).toHaveLength(2);
    expect(readAuthority).toHaveBeenCalledTimes(2);
  });

  it("rolls back the pin and receipt when creating the pending launch fails", async () => {
    const { db, state } = fakeDb({ value: true });
    const commit = createProtectedLaunchCommitter({ db, readAuthority: async () => authority, now: () => now });
    await expect(commit(input)).rejects.toThrow("effect insert failed");
    expect(state()).toEqual({ effects: [], activities: [], workspaceState: { runtimeSession: supervised } });
  });

  it("does not commit a new pin when an outbox identity already exists without it", async () => {
    const { db, state } = fakeDb({ value: false }, true);
    const commit = createProtectedLaunchCommitter({ db, readAuthority: async () => authority, now: () => now });
    await expect(commit(input)).rejects.toThrow("Protected launch effect already exists");
    expect(state()).toEqual({ effects: [], activities: [], workspaceState: { runtimeSession: supervised } });
  });

  it("requires exact server authority for this origin and attempt before it writes a pin", async () => {
    const { db, state } = fakeDb();
    const commit = createProtectedLaunchCommitter({ db, readAuthority: async () => authority, now: () => now });
    await expect(commit({ ...input, target: { ...target, originRef: "other-origin" } })).resolves.toMatchObject({ outcome: "held", reason: "admission-mismatch" });
    await expect(commit(input)).rejects.toMatchObject({ code: "command_id_conflict" });
    expect(state().workspaceState["protectedExecution"]).toBeUndefined();
    expect(state().effects).toHaveLength(0);
  });

  it("reserves the possible-start boundary once and replays without a second send grant", async () => {
    const { db, state } = fakeDb();
    const commit = createProtectedLaunchCommitter({ db, readAuthority: async () => authority, now: () => now });
    const authorize = vi.fn(async () => true);
    const reserve = createProtectedLaunchReservation({ db, isCurrentAuthority: authorize });
    await commit(input);
    const record = () => readProtectedExecutionBindings(state().workspaceState)!;
    const binding = protectedBindingIdentity(findProtectedExecutionBinding(record(), target)!);
    const reservation = { binding, projectionDigest: "d".repeat(64), effectId: "effect-1", leaseOwner: "worker-a", attempt: 1,
      signal: new AbortController().signal };
    await expect(reserve(reservation)).resolves.toBe("reserved");
    await expect(reserve(reservation)).resolves.toBe("readback-only");
    await expect(reserve({ ...reservation, leaseOwner: "worker-b", attempt: 2 })).resolves.toBe("readback-only");
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(record().bindings[0]?.launch).toEqual({ phase: "possibly-started", projectionDigest: reservation.projectionDigest });
    expect(state().workspaceState["runtimeSession"]).toEqual(supervised);
  });

  it("rechecks current authority under the lease and does not consume a start after a lost lease", async () => {
    const leaseAvailable = { value: false };
    const { db, state } = fakeDb({ value: false }, false, leaseAvailable);
    const commit = createProtectedLaunchCommitter({ db, readAuthority: async () => authority, now: () => now });
    const authorize = vi.fn(async () => false);
    const reserve = createProtectedLaunchReservation({ db, isCurrentAuthority: authorize });
    await commit(input);
    const record = () => readProtectedExecutionBindings(state().workspaceState)!;
    const binding = protectedBindingIdentity(findProtectedExecutionBinding(record(), target)!);
    const reservation = { binding, projectionDigest: "d".repeat(64), effectId: "effect-1", leaseOwner: "worker-a", attempt: 1,
      signal: new AbortController().signal };
    await expect(reserve(reservation)).resolves.toBe("held");
    expect(authorize).not.toHaveBeenCalled();
    leaseAvailable.value = true;
    await expect(reserve({ ...reservation, attempt: 2 })).resolves.toBe("held");
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(record().bindings[0]?.launch).toEqual({ phase: "queued" });
  });
});
