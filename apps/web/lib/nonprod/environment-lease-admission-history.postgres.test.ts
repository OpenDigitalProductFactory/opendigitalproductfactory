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

  it.each(["immediate", "queued"] as const)("publishes only for the current completed preview admission (%s)", async mode => {
    const { attestOwnedPreviewDatabase } = await import("./environment-lease-provenance");
    const { previewLogicalRuntimeId, PREVIEW_DATABASE_PROOF_KEY, readLeaseOwningSystemIdentifier } = await import("./preview-db-attestation");
    const sourceSha = "a".repeat(40), worktreePath = "/fixtures/preview", branchName = "codex/preview";
    const owner = { authenticatedUserId: "fixture-user", authenticatedAgentId: "fixture-agent" };
    const now = new Date(), expiresAt = new Date(now.getTime() + 120_000);
    const input = { ...owner, db: f.db, environmentKey: "active-candidate" as const, ownerProvider: "codex" as const,
      ownerSessionId: "actual-preview-owner", claimKey: `dev-portal:${randomUUID()}`,
      purpose: `Contributor preview (:3001) bound to ${worktreePath} @ ${branchName} (${sourceSha})`,
      url: "http://localhost:3001", ports: [3001], worktreePath, branchName, expiresAt,
      waitDeadlineAt: new Date(now.getTime() + 600_000), now };
    const blocker = mode === "queued" ? await claimNonprodEnvironmentLease({
      ...input, claimKey: `dev-portal:${randomUUID()}`, ownerSessionId: "fixture-blocker",
    }) : null;
    const claim = await claimNonprodEnvironmentLease(input);
    expect(claim.status).toBe(mode === "queued" ? "queued" : "admitted");
    if (blocker) await releaseNonprodEnvironmentLease({
      ...owner, db: f.db, leaseId: blocker.lease.leaseId, ownerSessionId: "fixture-blocker",
    });
    const live = await f.db.nonProductionEnvironmentLease.findUniqueOrThrow({ where: { leaseId: claim.lease.leaseId } });
    expect(live).toMatchObject({ status: "active", cleanupCommand: null, slotManifestVersion: null });
    const onDisk = () => f.db.taskRun.findUniqueOrThrow({ where: { taskRunId: live.taskRunId! } });
    expect(await onDisk()).toMatchObject({ status: "completed", progressPayload: { nonprodLeaseWait: { state: "admitted" } } });
    const ownerCluster = (await f.pool.query<{ system_identifier: string }>(
      "SELECT system_identifier::text FROM pg_catalog.pg_control_system()")).rows[0]!.system_identifier;
    const database = { systemIdentifier: ownerCluster === "7391584902012345678" ? "7391584902012345679" : "7391584902012345678",
      databaseOid: "16384", databaseName: "dpf", postmasterStartEpoch: "1795679812.123456" };
    const rawWitness = await f.db.$transaction(async tx => {
      const raw = await tx.$queryRawUnsafe<Array<{ systemIdentifier: string }>>(
        'SELECT system_identifier::text AS "systemIdentifier" FROM pg_catalog.pg_control_system()');
      return { raw, observed: await readLeaseOwningSystemIdentifier(tx.$queryRaw.bind(tx)) };
    });
    expect(rawWitness).toEqual({ raw: [{ systemIdentifier: ownerCluster }], observed: ownerCluster });
    const observation = { schemaVersion: 1, leaseId: live.leaseId, runtimeId: previewLogicalRuntimeId(live),
      sourceSha, containerId: "b".repeat(64), volumeName: "fixture_dev_pgdata", database };
    const request = { db: f.db, ...owner, observation };
    expect(await attestOwnedPreviewDatabase({ ...request, authenticatedUserId: "other-user" }))
      .toBe("preview_database_owner_unverified");
    const waitChangedDb = { $transaction: (run: (tx: object) => Promise<string>) =>
      f.db.$transaction(async tx => {
        let reads = 0;
        const taskRun = new Proxy(tx.taskRun, { get(target, prop, receiver) {
          if (prop !== "findUnique") return Reflect.get(target, prop, receiver);
          return async (args: Parameters<typeof target.findUnique>[0]) => {
            if (++reads === 2) await target.update({
              where: { taskRunId: live.taskRunId! }, data: { status: "submitted" },
            });
            return target.findUnique(args);
          };
        } });
        return run(new Proxy(tx, { get(target, prop, receiver) {
          return prop === "taskRun" ? taskRun : Reflect.get(target, prop, receiver);
        } }));
      }),
    } as unknown as typeof f.db;
    expect(await attestOwnedPreviewDatabase({ ...request, db: waitChangedDb }))
      .toBe("preview_database_wait_not_admitted");
    expect(await onDisk()).toMatchObject({ status: "completed" });
    expect((await onDisk()).progressPayload).not.toHaveProperty(PREVIEW_DATABASE_PROOF_KEY);
    const fixtureUrl = new URL(url!);
    if (mode === "immediate" && process.env.DPF_PREVIEW_ATTESTATION_TEST_DATABASE_URL === url
      && ["localhost", "127.0.0.1"].includes(fixtureUrl.hostname) && fixtureUrl.port
      && /^\/dpf_preview_attestation_[a-f0-9]{12,32}$/.test(fixtureUrl.pathname)) {
      const { renewNonprodEnvironmentLease } = await import("./environment-lease");
      const renewed = await renewNonprodEnvironmentLease({ db: f.db, leaseId: live.leaseId,
        ownerSessionId: input.ownerSessionId, ttlMs: 120_000 });
      expect(renewed.status).toBe("renewed");
      const role = "attestation_no_control_fixture";
      await f.pool.query(`CREATE ROLE ${role} NOLOGIN`);
      try {
        await f.pool.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${role}`);
        await f.pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${role}`);
        await f.pool.query("REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC");
        const access = await f.pool.query<{ allowed: boolean }>(
          "SELECT has_function_privilege($1, 'pg_catalog.pg_control_system()', 'EXECUTE') AS allowed", [role]);
        expect(access.rows[0]?.allowed).toBe(false);
        const restrictedDb = { $transaction: (run: (tx: Omit<typeof f.db, "$transaction" | "$connect" | "$disconnect" | "$on" | "$use" | "$extends">) => Promise<string>) =>
          f.db.$transaction(async tx => {
            await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
            return run(tx);
          }),
        } as unknown as typeof f.db;
        expect(await attestOwnedPreviewDatabase({ ...request, db: restrictedDb }))
          .toBe("preview_database_owner_cluster_unavailable");
        const stillRenewed = await f.db.nonProductionEnvironmentLease.findUniqueOrThrow({ where: { id: live.id } });
        if (renewed.status === "renewed") expect(stillRenewed.expiresAt).toEqual(renewed.lease.expiresAt);
        expect((await onDisk()).progressPayload).not.toHaveProperty(PREVIEW_DATABASE_PROOF_KEY);
      } finally {
        await f.pool.query("GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO PUBLIC");
        await f.pool.query(`DROP OWNED BY ${role}`);
        await f.pool.query(`DROP ROLE ${role}`);
      }
    }
    expect(await attestOwnedPreviewDatabase({ ...request, observation: { ...observation,
      database: { ...database, systemIdentifier: ownerCluster } } })).toBe("preview_database_production_cluster");
    expect((await onDisk()).progressPayload).not.toHaveProperty(PREVIEW_DATABASE_PROOF_KEY);
    expect(await attestOwnedPreviewDatabase(request)).toBe("preview_database_published");
    expect(await attestOwnedPreviewDatabase(request)).toBe("preview_database_unchanged");
    const newer = { ...observation, database: { ...database, postmasterStartEpoch: "1795679812.123457" } };
    expect(await attestOwnedPreviewDatabase({ ...request, observation: newer })).toBe("preview_database_published");
    expect(await attestOwnedPreviewDatabase(request)).toBe("preview_database_observation_stale");
    expect((await onDisk()).progressPayload).toMatchObject({ [PREVIEW_DATABASE_PROOF_KEY]: { database: newer.database } });
    await f.db.platformConfig.create({ data: { key: "portal.quiescence", value: { level: "draining" } } });
    expect(await attestOwnedPreviewDatabase(request)).toBe("preview_database_portal_quiescing");
    await f.db.platformConfig.delete({ where: { key: "portal.quiescence" } });
    await f.db.nonProductionEnvironmentLease.update({ where: { id: live.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await attestOwnedPreviewDatabase(request)).toBe("preview_database_lease_not_current");
    expect((await onDisk()).progressPayload).toMatchObject({ [PREVIEW_DATABASE_PROOF_KEY]: { database: newer.database } });
    expect(await releaseNonprodEnvironmentLease({ ...owner, db: f.db, leaseId: live.leaseId, ownerSessionId: input.ownerSessionId }))
      .toMatchObject({ status: "released" });
    expect(await attestOwnedPreviewDatabase(request)).toBe("preview_database_lease_not_current");

    // Non-gate active-candidate rows cannot re-enter the queue under the same
    // lease ID. A newly requested attempt owns a fresh, proofless TaskRun.
    const replay = await claimNonprodEnvironmentLease({ ...input, resumeLeaseId: live.leaseId });
    expect(replay).toMatchObject({ status: "terminal", lease: { leaseId: live.leaseId, status: "released" } });
    const holder = await claimNonprodEnvironmentLease({
      ...input, claimKey: `dev-portal:${randomUUID()}`, ownerSessionId: "fresh-attempt-holder",
    });
    expect(holder.status).toBe("admitted");
    const replacement = await claimNonprodEnvironmentLease({ ...input, claimKey: `dev-portal:${randomUUID()}` });
    expect(replacement).toMatchObject({ status: "queued" });
    expect(replacement.lease.leaseId).not.toBe(live.leaseId);
    expect(replacement.lease.taskRunId).not.toBe(live.taskRunId);
    const replacementTask = await f.db.taskRun.findUniqueOrThrow({ where: { taskRunId: replacement.lease.taskRunId! } });
    expect(replacementTask.progressPayload).not.toHaveProperty(PREVIEW_DATABASE_PROOF_KEY);
    expect(await attestOwnedPreviewDatabase(request)).toBe("preview_database_lease_not_current");
  });

  it("same-mode keys re-enter a live preview but S5 and ordinary keys reserve distinct rows", async () => {
    const now = new Date(), sha = "a".repeat(40), baseKey = "dev-portal:fixture:mixed-mode";
    const input = { db: f.db, environmentKey: "active-candidate" as const, ownerProvider: "codex" as const,
      ownerSessionId: "mixed-mode-owner", authenticatedUserId: "mixed-user", authenticatedAgentId: "mixed-agent",
      claimKey: baseKey, worktreePath: "/fixtures/mixed", branchName: "codex/mixed", now,
      purpose: `Contributor preview (:3001) bound to /fixtures/mixed @ codex/mixed (${sha})`,
      url: "http://localhost:3001", ports: [3001], expiresAt: new Date(now.getTime() + 120_000) };
    const ordinary = await claimNonprodEnvironmentLease(input);
    expect(ordinary.status).toBe("admitted");
    // Before the launcher discriminates mode, identical lane/key/session is
    // the same live attempt at the broker; a different lane does not alias it.
    const same = await claimNonprodEnvironmentLease(input);
    expect(same).toMatchObject({ status: "admitted", lease: { leaseId: ordinary.lease.leaseId } });
    await expect(claimNonprodEnvironmentLease({ ...input, environmentKey: "local-integration-ci" }))
      .rejects.toThrow("nonprod_claim_key_environment_mismatch");

    const s5Input = { ...input, claimKey: "dev-portal:s5-rehearsal:fixture:mixed-mode" };
    const s5 = await claimNonprodEnvironmentLease(s5Input);
    expect(s5.status).toBe("queued");
    expect(s5.lease.leaseId).not.toBe(ordinary.lease.leaseId);
    expect(s5.lease.taskRunId).not.toBe(ordinary.lease.taskRunId);
    const resumed = await claimNonprodEnvironmentLease({ ...s5Input, resumeLeaseId: s5.lease.leaseId });
    expect(resumed).toMatchObject({ status: "queued", lease: { leaseId: s5.lease.leaseId } });
  });

  it("rolls back release when PostgreSQL refuses every non-expiry wait settlement", async () => {
    const claim = await realClaim(f, true);
    expect(claim.status).toBe("queued");
    const db = { ...domainDb(f), taskRun: f.db.taskRun };
    const now = new Date();
    const wait = await checkpointNonprodLeaseWait({
      db, userId: "rollback-fixture-user", lease: claim.lease, queuePosition: 1,
      now, waitDeadlineAt: new Date(now.getTime() + 60_000),
    });
    const getLease = () => f.db.nonProductionEnvironmentLease.findUniqueOrThrow({
      where: { leaseId: claim.lease.leaseId },
    });
    const before = await getLease();
    const beforeTask = await f.db.taskRun.findUniqueOrThrow({ where: { taskRunId: wait.taskRunId } });
    const release = () => releaseNonprodEnvironmentLease({
      db, leaseId: claim.lease.leaseId, ownerSessionId: "this-session", now,
    });

    // A real zero-row CAS without poisoning the PostgreSQL transaction.
    await f.pool.query(`CREATE FUNCTION hold_release_wait_fixture() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.status::text = 'completed' THEN RETURN NULL; END IF;
        RETURN NEW;
      END $$`);
    try {
      await f.pool.query(`CREATE TRIGGER hold_release_wait_fixture BEFORE UPDATE ON "TaskRun"
        FOR EACH ROW EXECUTE FUNCTION hold_release_wait_fixture()`);
      await expect(release()).rejects.toThrow("nonprod_release_wait_settlement_contended");
      const after = await getLease();
      expect(after).toMatchObject({ status: before.status, phase: before.phase,
        releasedAt: before.releasedAt, cancelledAt: before.cancelledAt, activeKey: before.activeKey });
      expect(await f.db.taskRun.findUniqueOrThrow({ where: { taskRunId: wait.taskRunId } })).toEqual(beforeTask);
    } finally {
      await f.pool.query('DROP TRIGGER IF EXISTS hold_release_wait_fixture ON "TaskRun"');
      await f.pool.query("DROP FUNCTION hold_release_wait_fixture()");
    }

    expect(await release()).toMatchObject({ status: "cancelled" });
    expect(await release()).toMatchObject({ status: "cancelled" });
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
