import { describe, expect, it, vi } from "vitest";
import { resolveCallConsequence, type ToolCallConsequenceInput } from "../tool-consequence";
import { deterministicNonprodWaitTaskRunId } from "./durable-wait";
import { leaseCleanupConsequenceForCall } from "./lease-cleanup-consequence";
import { resolveEscalation } from "../govern/authority/escalation-gate";

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
    expiresAt: new Date(Date.now() + 10 * 60_000),
  };
  const wait = {
    ...lease, schemaVersion: 1, kind: "nonprod-lease-wait", state: status === "active" ? "admitted" : "waiting",
    queuePosition: null, waitDeadlineAt: "2026-10-13T04:00:00Z", lastTransitionAt: "2026-10-13T04:00:00Z",
    eventId: null, eventConsumed: true,
  };
  const task = { taskRunId, userId: "user-1", progressPayload: { nonprodLeaseWait: wait } };
  const readLease = vi.fn(async () => lease);
  const readWait = vi.fn(async () => task);
  const deps = { db: { nonProductionEnvironmentLease: { findUnique: readLease },
    taskRun: { findUnique: readWait } } };
  const call: ToolCallConsequenceInput = { toolName: "release_nonprod_environment_lease", userId: "user-1",
    params: { leaseId: lease.leaseId, ownerSessionId: lease.ownerSessionId } };
  return { lease, task, wait, deps, call, readLease, readWait };
}
type Fixture = ReturnType<typeof fixture>;

describe("owned lease cleanup consequence", () => {
  it.each(["queued", "active"])(
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
    ["unexpected call property", (f) => { f.call.params.force = true; }],
    ["missing session", (f) => { delete f.call.params.ownerSessionId; }],
    ["missing lease", (f) => { delete f.call.params.leaseId; }],
    ["wrong tool", (f) => { f.call.toolName = "renew_nonprod_environment_lease"; }],
  ];
  // A live reservation: nothing but proven ownership can make its release routine.
  it.each(unsafe)("retains authority for %s", async (_, alter) => {
    const f = fixture("active"); alter(f);
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

  it.each(["lease", "wait"])("fails closed when %s observation is unavailable", async (probe) => {
    const f = fixture("active");
    if (probe === "lease") f.readLease.mockRejectedValue(new Error("unavailable"));
    if (probe === "wait") f.readWait.mockRejectedValue(new Error("unavailable"));
    const result = await resolveCallConsequence({ consequence: "authority",
      consequenceForCall: (call) => leaseCleanupConsequenceForCall(call, f.deps) }, f.call);
    expect(result).toEqual({ consequence: "authority",
      refinement: { declared: "authority", reason: "refinement-unavailable" } });
  });
});

// BI-88D51B8F: on the production install every release, even of a dead
// reservation, minted an owner approval the owner could not read and always
// approved. Freeing what nobody is using is routine; freeing what another
// session still holds stays a person's decision, said in plain words.
describe("routine lease release on any installation", () => {
  const NOW = new Date("2026-11-04T04:00:00Z");
  const foreign = (f: Fixture) => { f.call.userId = "other-user"; f.call.params.ownerSessionId = "other-session"; };

  it("frees the caller's own reservation without an installation-class condition", async () => {
    const f = fixture("active");
    expect(await leaseCleanupConsequenceForCall(f.call, f.deps)).toEqual({
      consequence: null, reason: "owned-development-lease-cleanup",
    });
  });

  it.each(["released", "cancelled", "expired"])("treats a %s reservation as ended, whoever asks", async (status) => {
    const f = fixture(status); foreign(f);
    expect(await leaseCleanupConsequenceForCall({ ...f.call, now: NOW }, f.deps))
      .toEqual({ consequence: null, reason: "ended-reservation" });
  });

  it.each(["active", "queued"])("treats a lapsed %s reservation as routine, as the expiry janitor would", async (status) => {
    const f = fixture(status); foreign(f);
    f.lease.ownerPid = 4242; f.lease.expiresAt = new Date(NOW.getTime() - 1);
    delete f.call.params.ownerSessionId;
    expect(await leaseCleanupConsequenceForCall({ ...f.call, now: NOW }, f.deps))
      .toEqual({ consequence: null, reason: "lapsed-reservation" });
  });

  it("keeps a live reservation another session holds for a person, and says what will happen", async () => {
    const f = fixture("active"); foreign(f);
    f.lease.expiresAt = new Date(NOW.getTime() + 60_000);
    const result = await leaseCleanupConsequenceForCall({ ...f.call, now: NOW }, f.deps);
    expect(result.consequence).toBe("authority");
    expect(result.approverSummary).toMatch(/frees the shared test machine/);
    expect(result.approverSummary).toMatch(/codex on fix\/owned/);
    expect(result.approverSummary).toMatch(/ends by itself when it stops renewing/);
  });

  it("still sends that damaging release to a person even when a recorded delegation steers the coworker", async () => {
    const f = fixture("active"); foreign(f);
    const resolved = await resolveCallConsequence({ consequence: "authority",
      consequenceForCall: (call) => leaseCleanupConsequenceForCall(call, f.deps) }, { ...f.call, now: NOW });
    expect(resolved.refinement?.approverSummary).toMatch(/another session/);
    const decision = resolveEscalation({
      action: { sideEffect: true, executionMode: "immediate", consequence: resolved.consequence },
      dataPolicy: { sensitivity: "internal" }, operatorRequiresApproval: true, steering: "connection-delegation",
    });
    expect(decision).toMatchObject({ verdict: "human", reasonCode: "damaging-consequence", damaging: true });
  });

  it("lets a routine release through the same gate with no person", async () => {
    const f = fixture("expired"); foreign(f);
    const resolved = await resolveCallConsequence({ consequence: "authority",
      consequenceForCall: (call) => leaseCleanupConsequenceForCall(call, f.deps) }, { ...f.call, now: NOW });
    expect(resolved).toEqual({ consequence: null, refinement: { declared: "authority", reason: "ended-reservation" } });
    expect(resolveEscalation({
      action: { sideEffect: true, executionMode: "immediate", consequence: resolved.consequence },
      dataPolicy: { sensitivity: "internal" }, operatorRequiresApproval: true, steering: "connection-delegation",
    }).verdict).toBe("automated");
  });
});
