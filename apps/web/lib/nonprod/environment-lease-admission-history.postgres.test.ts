import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createReviewPostgresFixture } from "../../test-support/review-postgres-fixture";
import { claimNonprodEnvironmentLease, releaseNonprodEnvironmentLease, reapExpiredNonprodEnvironmentLeases } from "./environment-lease";
import { settleTerminalGateLease } from "./environment-lease-terminal-evidence";
import { derivedLocalCiPoolConfig, LOCAL_CI_POOL_CONFIG_KEY } from "./local-ci-pool-policy";
import { settleObsoleteLeaseReleaseEnvelopes, type ObsoleteReleaseDb } from "../coworker/obsolete-lease-envelope";
import { checkpointNonprodLeaseWait, settleNonprodLeaseWait } from "./durable-wait";
import { fenceEndedPreviewRuntimes } from "./preview-runtime-fence";
import { obsoleteEnvelope } from "../coworker/obsolete-lease-envelope.test-fixtures";

// The real domain producer runs against private fixture rows. Its ancillary
// telemetry must never write through the application's default connection.
vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition: vi.fn(async () => {}) }));
const configured = process.env.DATABASE_URL;
const leased = (() => { try { return process.env.DPF_NONPROD_LEASE_ID && configured
  && /^\/dpf_local_ci_\d+$/.test(new URL(configured).pathname) ? configured : undefined; } catch { return undefined; } })();
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL ?? leased;
// Workroom is the Prisma model; its canonical physical table remains WorkCapsule.
const tables = ["NonProductionEnvironmentLease", "CoworkerActionEnvelope", "ToolExecution", "TaskRun", "PlatformConfig", "WorkCapsule"];
const schema = `review_admission_${randomUUID().replaceAll("-", "")}`;
type Fixture = Awaited<ReturnType<typeof createReviewPostgresFixture>>;
const attach = (f: Fixture) => f.pool.query(`CREATE TRIGGER "NonProductionEnvironmentLease_admission_history"
  BEFORE INSERT OR UPDATE ON "NonProductionEnvironmentLease"
  FOR EACH ROW EXECUTE FUNCTION public.nonprod_lease_preserve_admission_history()`);

function domainDb(f: Fixture) {
  // The private canonical configuration makes pressure-based queuing real;
  // the compatibility singleton intentionally ignores pressure without it.
  return { nonProductionEnvironmentLease: f.db.nonProductionEnvironmentLease, platformConfig: f.db.platformConfig,
    $transaction: f.db.$transaction.bind(f.db) };
}
async function realClaim(f: Fixture, queued: boolean) {
  const now = new Date();
  // Keep this fixture's host telemetry internally coherent so the queued case
  // exercises actual pressure rather than the fail-closed missing-total path.
  const pressure = { observedAt: now.toISOString(), totalMemoryBytes: 256 * 1024 ** 3,
    availableMemoryBytes: queued ? 0 : 128 * 1024 ** 3,
    dockerAvailableMemoryBytes: queued ? 0 : 128 * 1024 ** 3, builderMemoryUsageBytes: [0, 0],
    sustainedCpuPercent: 1, diskFreeBytes: 512 * 1024 ** 3, dockerHealthy: true,
    convergenceActive: false, fencesHealthy: true, evidenceIsolationHealthy: true };
  return claimNonprodEnvironmentLease({ db: domainDb(f), environmentKey: "local-integration-ci",
    ownerProvider: "codex", ownerSessionId: "this-session", claimKey: `gate:${randomUUID().replaceAll("-", "").repeat(2)}`,
    purpose: "Isolated admission-history producer test", url: "http://fixture.invalid", ports: [],
    expiresAt: new Date(now.getTime() + 120_000), requestedTtlMs: 120_000,
    waitDeadlineAt: new Date(now.getTime() + 120_000),
    slotManifestVersion: 1, hostPressure: pressure, capacityBroker: async () => pressure, now });
}
async function parked(f: Fixture, leaseId: string) {
  const { toolExecutions, argsJson, ...row } = obsoleteEnvelope("approval", leaseId);
  await f.db.coworkerActionEnvelope.create({ data: { ...row, argsJson: argsJson as any,
    threadId: "synthetic-thread", rationale: "Release an unused reservation", expiresAt: new Date(Date.now() + 60_000) } });
  const call = toolExecutions[0];
  await f.db.toolExecution.create({ data: { ...call, parameters: call.parameters as any,
    result: call.result as any, threadId: "", executionMode: "external-jsonrpc" } });
}

describe.skipIf(!url)("forward-only reservation admission history — isolated PostgreSQL", () => {
  let f: Fixture;
  beforeAll(async () => { f = await createReviewPostgresFixture({ url: url!, schema, tables }); await attach(f); });
  beforeEach(async () => {
    await f.pool.query(`TRUNCATE "ToolExecution", "CoworkerActionEnvelope", "NonProductionEnvironmentLease", "TaskRun", "PlatformConfig", "WorkCapsule"`);
    await f.db.platformConfig.create({ data: { key: LOCAL_CI_POOL_CONFIG_KEY, value: derivedLocalCiPoolConfig(1) } });
  });
  afterAll(async () => { await f?.close(); });

  it.each([
    { name: "database witness follows application admission", applicationOffset: -60_000, releaseDelta: 2_000, expiry: false },
    { name: "application terminal is ahead of the observer", applicationOffset: 60_000, releaseDelta: 2_000, expiry: false },
    { name: "application clock rolls back before terminal write", applicationOffset: 60_000, releaseDelta: -120_000, expiry: false },
    { name: "actual expiry couples its deadline and terminal write despite observer clock offset", applicationOffset: -60_000, releaseDelta: 120_001, expiry: true },
  ])("fences a real queued-to-active preview when $name", async ({ applicationOffset, releaseDelta, expiry }) => {
    const db = { ...domainDb(f), taskRun: f.db.taskRun };
    const databaseNow = (await f.pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
    const applicationNow = new Date(databaseNow.getTime() + applicationOffset);
    const sha = "7".repeat(40), worktreePath = "/fixtures/clock-preview", branchName = "codex/clock-preview";
    const pressure = (now: Date, queued: boolean) => ({ observedAt: now.toISOString(), totalMemoryBytes: 256 * 1024 ** 3,
      availableMemoryBytes: queued ? 0 : 128 * 1024 ** 3, dockerAvailableMemoryBytes: queued ? 0 : 128 * 1024 ** 3,
      builderMemoryUsageBytes: [0, 0], sustainedCpuPercent: 1, diskFreeBytes: 512 * 1024 ** 3, dockerHealthy: true,
      convergenceActive: false, fencesHealthy: true, evidenceIsolationHealthy: true });
    const claimInput = { db, environmentKey: "local-integration-ci" as const, ownerProvider: "codex" as const,
      ownerSessionId: "clock-owner", authenticatedUserId: "clock-user", authenticatedAgentId: "codex",
      claimKey: `preview-clock:${randomUUID()}`, purpose: `Contributor preview (:3001) bound to ${worktreePath} @ ${branchName} (${sha})`,
      url: "http://localhost:3001", ports: [3001], worktreePath, branchName, requestedTtlMs: 120_000,
      expiresAt: new Date(applicationNow.getTime() + 600_000), waitDeadlineAt: new Date(applicationNow.getTime() + 600_000) };
    const queuedPressure = pressure(applicationNow, true);
    const queued = await claimNonprodEnvironmentLease({ ...claimInput, hostPressure: queuedPressure,
      capacityBroker: async () => queuedPressure, now: applicationNow });
    expect(queued.status).toBe("queued");
    expect(queued.lease).toMatchObject({ admissionHistoryVersion: 1, firstAdmittedAt: null, admittedAt: null });
    // The same canonical checkpoint/settlement functions used by the MCP adapter
    // retain actual private Task rows. No manually invented Task proof or stamp.
    const wait = await checkpointNonprodLeaseWait({ db, userId: "clock-user", lease: queued.lease,
      queuePosition: 1, waitDeadlineAt: claimInput.waitDeadlineAt, now: applicationNow });
    const admissionNow = new Date(applicationNow.getTime() + 1_000), readyPressure = pressure(admissionNow, false);
    const admitted = await claimNonprodEnvironmentLease({ ...claimInput, resumeLeaseId: queued.lease.leaseId,
      hostPressure: readyPressure, capacityBroker: async () => readyPressure, now: admissionNow });
    expect(admitted.status).toBe("admitted");
    expect(admitted.lease.firstAdmittedAt).toBeInstanceOf(Date);
    expect(admitted.lease.firstAdmittedAt!.getTime() > admitted.lease.admittedAt!.getTime()).toBe(applicationOffset < 0);
    await settleNonprodLeaseWait({ db, taskRunId: wait.taskRunId, leaseId: admitted.lease.leaseId,
      state: "admitted", now: admissionNow });
    await f.db.workroom.create({ data: { capsuleId: "WC-CLOCK-FIXTURE", title: "Private clock fixture", objective: "Native fence integration",
      source: "external-adoption", repositoryFullName: "fixture/repo", headSha: sha, headBranch: branchName, worktreePath } });
    const terminalNow = new Date(admissionNow.getTime() + releaseDelta);
    if (expiry) {
      expect(await reapExpiredNonprodEnvironmentLeases({ db, now: terminalNow })).toEqual({ reaped: 1 });
    } else {
      await releaseNonprodEnvironmentLease({ db, leaseId: admitted.lease.leaseId, ownerSessionId: "clock-owner",
        authenticatedUserId: "clock-user", authenticatedAgentId: "codex", now: terminalNow });
    }
    const released = await f.db.nonProductionEnvironmentLease.findUniqueOrThrow({ where: { leaseId: admitted.lease.leaseId } });
    expect(released.status).toBe(expiry ? "expired" : "released");
    if (expiry) {
      expect(released.expiresAt.getTime()).toBeLessThanOrEqual(released.releasedAt!.getTime());
      expect(released.releasedAt).toEqual(terminalNow);
    }
    expect(released.firstAdmittedAt).toEqual(admitted.lease.firstAdmittedAt);
    const id = "c".repeat(64), container = { Id: id, Name: "/fixture-dev-portal", State: { Running: true },
      Config: { Labels: { "com.docker.compose.project": "fixture", "com.docker.compose.service": "dev-portal",
        "dpf.preview.lease": released.leaseId, "dpf.preview.sha": sha },
        Env: ["DPF_ENVIRONMENT_CLASS=development", `DPF_PREVIEW_SOURCE_SHA=${sha}`, `DPF_PREVIEW_LEASE_ID=${released.leaseId}`] },
      Mounts: [{ Type: "bind", Source: worktreePath, Destination: "/workspace" }],
      NetworkSettings: { Ports: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "3001" }] } } };
    const stop = vi.fn(async () => { container.State.Running = false; });
    const result = await fenceEndedPreviewRuntimes({ selfHostname: "fixture-self", now: new Date(),
      get: async path => {
        if (path === "/containers/fixture-self/json") return { Config: { Labels: { "com.docker.compose.project": "fixture" } } };
        if (path === "/info") return { OperatingSystem: "Docker Desktop" };
        if (path.startsWith("/containers/json?")) return [{ Id: id }];
        if (path === `/containers/${id}/json`) return structuredClone(container);
        throw new Error("Unexpected private Docker request");
      }, stop, readLease: leaseId => f.db.nonProductionEnvironmentLease.findUnique({ where: { leaseId } }),
      readTask: taskRunId => f.db.taskRun.findUnique({ where: { taskRunId },
        select: { taskRunId: true, userId: true, initiatingAgentId: true, progressPayload: true, status: true } }),
      readSource: (lease, sourceSha) => f.db.workroom.findFirst({ where: { worktreePath: lease.worktreePath,
        headBranch: lease.branchName, headSha: sourceSha }, select: { headSha: true, repositoryFullName: true } }) });
    expect(result).toMatchObject({ stopped: 1, held: 0, pending: 0 });
    expect(stop).toHaveBeenCalledExactlyOnceWith(id);
  });

  it("the real queued claim and cancellation producer creates a genuinely eligible request", async () => {
    const claim = await realClaim(f, true);
    expect(claim.status).toBe("queued");
    expect(claim.lease).toMatchObject({ admissionHistoryVersion: 1, firstAdmittedAt: null, admittedAt: null });
    await releaseNonprodEnvironmentLease({ db: domainDb(f), leaseId: claim.lease.leaseId, ownerSessionId: "this-session" });
    await parked(f, claim.lease.leaseId);
    const audit = await f.db.toolExecution.findMany();
    expect(await settleObsoleteLeaseReleaseEnvelopes(f.db as unknown as ObsoleteReleaseDb, new Date()))
      .toMatchObject({ cancelled: 1, inconclusive: 0 });
    expect(await f.db.toolExecution.findMany()).toEqual(audit);
  });

  it("real admission survives the actual terminal reviver and a later unused cancellation", async () => {
    const claim = await realClaim(f, false);
    expect(claim.status).toBe("admitted");
    expect(claim.lease.admissionHistoryVersion).toBe(1);
    expect(claim.lease.firstAdmittedAt).toBeInstanceOf(Date);
    const first = claim.lease.firstAdmittedAt;
    await parked(f, claim.lease.leaseId);
    await releaseNonprodEnvironmentLease({ db: domainDb(f), leaseId: claim.lease.leaseId, ownerSessionId: "this-session" });
    const terminal = await f.db.nonProductionEnvironmentLease.findUniqueOrThrow({ where: { leaseId: claim.lease.leaseId } });
    await f.db.$transaction(async tx => {
      const { lockNonprodEnvironment } = await import("./environment-lease-lock");
      await lockNonprodEnvironment(tx, "local-integration-ci");
      expect(await settleTerminalGateLease({ tx, lease: terminal, claimKey: terminal.claimKey!, now: new Date(), ttlMs: 120_000 }))
        .toMatchObject({ kind: "revived" });
    });
    const revived = await f.db.nonProductionEnvironmentLease.findUniqueOrThrow({ where: { leaseId: claim.lease.leaseId } });
    expect(revived).toMatchObject({ status: "queued", admittedAt: null, admissionHistoryVersion: 1, firstAdmittedAt: first });
    await releaseNonprodEnvironmentLease({ db: domainDb(f), leaseId: claim.lease.leaseId, ownerSessionId: "this-session" });
    const audit = await f.db.toolExecution.findMany();
    expect((await settleObsoleteLeaseReleaseEnvelopes(f.db as unknown as ObsoleteReleaseDb, new Date())).cancelled).toBe(0);
    expect((await f.db.coworkerActionEnvelope.findFirstOrThrow()).status).toBe("proposed");
    expect(await f.db.toolExecution.findMany()).toEqual(audit);
  });

  it("older writer shapes cannot clear a first admission or invent a legacy version", async () => {
    const claim = await realClaim(f, false), first = claim.lease.firstAdmittedAt;
    await f.pool.query(`UPDATE "NonProductionEnvironmentLease" SET status='queued', "admittedAt"=NULL,
      "activeKey"=NULL, "slotKey"=NULL, "admissionHistoryVersion"=NULL, "firstAdmittedAt"=NULL WHERE "leaseId"=$1`, [claim.lease.leaseId]);
    expect(await f.db.nonProductionEnvironmentLease.findUniqueOrThrow({ where: { leaseId: claim.lease.leaseId } }))
      .toMatchObject({ admissionHistoryVersion: 1, firstAdmittedAt: first, admittedAt: null });
  });

  it("an older writer's first active update is stamped even with explicit NULL/default fields", async () => {
    const claim = await realClaim(f, true);
    await f.pool.query(`UPDATE "NonProductionEnvironmentLease" SET status='active', "admittedAt"=CURRENT_TIMESTAMP,
      "slotKey"='slot-0', "activeKey"='local-integration-ci:slot-0',
      "admissionHistoryVersion"=NULL, "firstAdmittedAt"=NULL WHERE "leaseId"=$1`, [claim.lease.leaseId]);
    const active = await f.db.nonProductionEnvironmentLease.findUniqueOrThrow({ where: { leaseId: claim.lease.leaseId } });
    expect(active.admissionHistoryVersion).toBe(1); expect(active.firstAdmittedAt).toBeInstanceOf(Date);
  });

  it("rejects supplied history on insert instead of trusting a caller's version", async () => {
    await expect(f.pool.query(`INSERT INTO "NonProductionEnvironmentLease"
      (id,"leaseId","environmentKey","ownerProvider","ownerSessionId",purpose,url,"expiresAt","updatedAt","admissionHistoryVersion")
      VALUES ('forged','NPEL-forged','local-integration-ci','codex','this-session','fixture','http://fixture.invalid',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1)`))
      .rejects.toMatchObject({ code: "23514", message: "Reservation admission history is database-owned" });
    expect(await f.db.nonProductionEnvironmentLease.count()).toBe(0);
  });

  it("backdated and terminal insertions remain unknown, including after manifest backfill", async () => {
    for (const [id, status, createdAt] of [["historical", "queued", new Date(0)], ["terminal", "cancelled", new Date()]] as const) {
      const row = await f.db.nonProductionEnvironmentLease.create({ data: { leaseId: `NPEL-${id}`, ownerProvider: "codex",
        ownerSessionId: "this-session", environmentKey: "local-integration-ci", purpose: "historical fixture",
        url: "http://fixture.invalid", status, expiresAt: new Date(), createdAt } });
      expect(row).toMatchObject({ admissionHistoryVersion: null, firstAdmittedAt: null });
      const unchanged = await f.db.nonProductionEnvironmentLease.update({ where: { id: row.id }, data: {
        admissionHistoryVersion: 1, firstAdmittedAt: null, slotManifestVersion: 1 } });
      expect(unchanged).toMatchObject({ admissionHistoryVersion: null, firstAdmittedAt: null });
    }
  });

  it("a structural LIKE copy has no birth trigger and cannot mint eligibility", async () => {
    await f.pool.query(`CREATE TABLE "CopiedReservation" (LIKE "NonProductionEnvironmentLease" INCLUDING ALL)`);
    try {
      await f.pool.query(`INSERT INTO "CopiedReservation"
        (id,"leaseId","environmentKey","ownerProvider","ownerSessionId",purpose,url,"expiresAt","updatedAt")
        VALUES ('copy','NPEL-copy','local-integration-ci','codex','this-session','fixture','http://fixture.invalid',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
      expect((await f.pool.query(`SELECT "admissionHistoryVersion", "firstAdmittedAt" FROM "CopiedReservation"`)).rows)
        .toEqual([{ admissionHistoryVersion: null, firstAdmittedAt: null }]);
    } finally { await f.pool.query(`DROP TABLE "CopiedReservation"`); }
  });

  it("the actual migration retains a pre-existing row as unknown without retrofitting its history", async () => {
    const legacySchema = `review_legacy_${randomUUID().replaceAll("-", "")}`;
    const legacy = await createReviewPostgresFixture({ url: url!, schema: legacySchema, tables });
    try {
      await legacy.pool.query(`ALTER TABLE "NonProductionEnvironmentLease" DROP COLUMN "admissionHistoryVersion", DROP COLUMN "firstAdmittedAt"`);
      await legacy.pool.query(`INSERT INTO "NonProductionEnvironmentLease"
        (id,"leaseId","environmentKey","ownerProvider","ownerSessionId",purpose,url,"expiresAt","updatedAt")
        VALUES ('legacy','NPEL-legacy','local-integration-ci','codex','this-session','fixture','http://fixture.invalid',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
      const source = await readFile(new URL("../../../../packages/db/prisma/migrations/20261101060000_nonprod_lease_admission_history/migration.sql", import.meta.url), "utf8");
      const isolated = source.replace('ALTER TABLE "NonProductionEnvironmentLease"', `ALTER TABLE "${legacySchema}"."NonProductionEnvironmentLease"`)
        .replace('CREATE FUNCTION nonprod_lease_preserve_admission_history()', `CREATE FUNCTION "${legacySchema}".nonprod_lease_preserve_admission_history()`)
        .replace('ON "NonProductionEnvironmentLease"', `ON "${legacySchema}"."NonProductionEnvironmentLease"`)
        .replace('EXECUTE FUNCTION nonprod_lease_preserve_admission_history()', `EXECUTE FUNCTION "${legacySchema}".nonprod_lease_preserve_admission_history()`);
      await legacy.pool.query(isolated);
      expect(await legacy.db.nonProductionEnvironmentLease.findFirstOrThrow()).toMatchObject({ admissionHistoryVersion: null, firstAdmittedAt: null });
      await legacy.pool.query(`UPDATE "NonProductionEnvironmentLease" SET "slotManifestVersion"=1, "admissionHistoryVersion"=1, "firstAdmittedAt"=NULL`);
      expect(await legacy.db.nonProductionEnvironmentLease.findFirstOrThrow()).toMatchObject({ admissionHistoryVersion: null, firstAdmittedAt: null });
    } finally { await legacy.close(); }
  });
});
