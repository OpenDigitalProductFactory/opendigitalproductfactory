import { describe, expect, it, vi } from "vitest";
import { resolveCallConsequence, type ToolCallConsequenceInput } from "../tool-consequence";
import { deterministicNonprodWaitTaskRunId } from "./durable-wait";
import { leaseCleanupConsequenceForCall } from "./lease-cleanup-consequence";

function fixture(status = "expired") {
  const taskRunId = deterministicNonprodWaitTaskRunId("user-1", "NPEL-OWNED");
  const lease = {
    leaseId: "NPEL-OWNED", claimKey: "own-gate", environmentKey: "local-integration-ci", status,
    ownerProvider: "codex", ownerSessionId: "session-1", worktreePath: "D:/DPF-worktrees/owned",
    branchName: "fix/owned", taskRunId, slotManifestVersion: 1, slotKey: "slot-1",
    activeKey: status === "active" ? "local-integration-ci:slot-1" : null,
    ownerPid: null as number | null, ownerProcessIdentity: null as string | null,
    cleanupCommand: null, resourceClass: null, expectedMemoryBytes: null, buildId: null,
    url: "http://localhost:3010", ports: [3010],
  };
  const wait = {
    ...lease, schemaVersion: 1, kind: "nonprod-lease-wait", state: status === "active" ? "admitted" : "waiting",
    queuePosition: null, waitDeadlineAt: "2026-10-13T04:00:00Z", lastTransitionAt: "2026-10-13T04:00:00Z",
    eventId: null, eventConsumed: true,
  };
  const task = { taskRunId, userId: "user-1", progressPayload: { nonprodLeaseWait: wait } };
  const readLease = vi.fn(async () => lease);
  const readWait = vi.fn(async () => task);
  const stance = { environmentClass: "development", primaryPurpose: "evolve-dpf" };
  const deps = { db: { nonProductionEnvironmentLease: { findUnique: readLease },
    taskRun: { findUnique: readWait } }, loadStance: async () => stance };
  const call: ToolCallConsequenceInput = { toolName: "release_nonprod_environment_lease", userId: "user-1",
    params: { leaseId: lease.leaseId, ownerSessionId: lease.ownerSessionId } };
  return { lease, task, wait, stance, deps, call, readLease, readWait };
}
type Fixture = ReturnType<typeof fixture>;

describe("owned DEV cleanup consequence", () => {
  it.each(["queued", "active", "released", "cancelled", "expired"])(
    "does not ask again to clean up the authenticated user's bound %s lease", async (status) => {
      const f = fixture(status);
      const before = JSON.stringify({ lease: f.lease, task: f.task });
      expect(await leaseCleanupConsequenceForCall(f.call, f.deps)).toEqual({
        consequence: null, reason: "owned-development-lease-cleanup",
      });
      // Classification cannot release a lease, mint admission or rewrite wait history.
      expect(JSON.stringify({ lease: f.lease, task: f.task })).toBe(before);
    },
  );

  const unsafe: [string, (f: Fixture) => void][] = [
    ["foreign authenticated user", (f) => { f.call.userId = "other-user"; }],
    ["foreign original session", (f) => { f.call.params.ownerSessionId = "other-session"; }],
    ["foreign stored task user", (f) => { f.task.userId = "other-user"; }],
    ["task id copied from another lease", (f) => { f.lease.taskRunId = "TR-NONPROD-OTHER"; }],
    ["returned task id differs", (f) => { f.task.taskRunId = "TR-NONPROD-OTHER"; }],
    ["reader returned another lease", (f) => { f.lease.leaseId = "NPEL-OTHER"; }],
    ["host process reservation", (f) => { f.lease.ownerPid = 1234; }],
    ["process identity without pid", (f) => { f.lease.ownerProcessIdentity = "owned-process"; }],
    ["unsupported resource environment", (f) => { f.lease.environmentKey = "host-heavy-resource"; }],
    ["legacy runner manifest", (f) => { f.lease.slotManifestVersion = 0; }],
    ["unknown lease status", (f) => { f.lease.status = "unknown"; }],
    ["missing original task", (f) => { f.lease.taskRunId = ""; }],
    ["missing branch", (f) => { f.lease.branchName = ""; }],
    ["missing worktree", (f) => { f.lease.worktreePath = ""; }],
    ["missing claim identity", (f) => { f.lease.claimKey = ""; }],
    ["changed durable lease", (f) => { f.wait.leaseId = "NPEL-OTHER"; }],
    ["changed durable claim", (f) => { f.wait.claimKey = "other-claim"; }],
    ["changed durable environment", (f) => { f.wait.environmentKey = "other-environment"; }],
    ["changed durable provider", (f) => { f.wait.ownerProvider = "grok"; }],
    ["changed durable session", (f) => { f.wait.ownerSessionId = "other-session"; }],
    ["changed durable branch", (f) => { f.wait.branchName = "fix/other"; }],
    ["changed durable worktree", (f) => { f.wait.worktreePath = "D:/DPF-worktrees/other"; }],
    ["malformed durable wait", (f) => { f.wait.schemaVersion = 99; }],
    ["production installation", (f) => { f.stance.environmentClass = "production"; }],
    ["test installation", (f) => { f.stance.environmentClass = "test"; }],
    ["unknown installation", (f) => { f.stance.environmentClass = "unknown"; }],
    ["other development purpose", (f) => { f.stance.primaryPurpose = "operate-business"; }],
    ["unexpected call property", (f) => { f.call.params.force = true; }],
    ["missing session", (f) => { delete f.call.params.ownerSessionId; }],
    ["missing lease", (f) => { delete f.call.params.leaseId; }],
    ["wrong tool", (f) => { f.call.toolName = "renew_nonprod_environment_lease"; }],
  ];
  it.each(unsafe)("retains authority for %s", async (_, alter) => {
    const f = fixture(); alter(f);
    expect((await leaseCleanupConsequenceForCall(f.call, f.deps)).consequence).toBe("authority");
  });

  it.each(["wrong-slot", "wrong-active-key", "waiting-instead-of-admitted"])(
    "retains authority for inconsistent active state: %s", async (kind) => {
      const f = fixture("active");
      if (kind === "wrong-slot") f.lease.slotKey = "slot-99";
      if (kind === "wrong-active-key") f.lease.activeKey = "other-environment:slot-1";
      if (kind === "waiting-instead-of-admitted") f.wait.state = "waiting";
      expect((await leaseCleanupConsequenceForCall(f.call, f.deps)).consequence).toBe("authority");
    },
  );

  it("retains authority for a queued lease with admitted wait evidence", async () => {
    const f = fixture("queued"); f.wait.state = "admitted";
    expect((await leaseCleanupConsequenceForCall(f.call, f.deps)).consequence).toBe("authority");
  });

  it.each(["stance", "lease", "wait"])("fails closed when %s observation is unavailable", async (probe) => {
    const f = fixture();
    if (probe === "stance") f.deps.loadStance = async () => { throw new Error("unavailable"); };
    if (probe === "lease") f.readLease.mockRejectedValue(new Error("unavailable"));
    if (probe === "wait") f.readWait.mockRejectedValue(new Error("unavailable"));
    const result = await resolveCallConsequence({ consequence: "authority",
      consequenceForCall: (call) => leaseCleanupConsequenceForCall(call, f.deps) }, f.call);
    expect(result).toEqual({ consequence: "authority",
      refinement: { declared: "authority", reason: "refinement-unavailable" } });
  });
});
