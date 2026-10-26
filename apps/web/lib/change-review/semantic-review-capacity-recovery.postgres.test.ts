import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../../packages/db/generated/client/client";
import { createReviewPostgresFixture } from "../../test-support/review-postgres-fixture";

const ports = vi.hoisted(() => ({
  db: null as unknown as Record<string, unknown>, pool: null as unknown as Pool,
  capacityAvailable: false, observeCapacity: undefined as undefined | (() => Promise<void>),
  failureEvidence: [] as unknown[],
  leaseReads: vi.fn(), routeAttempts: vi.fn(), completions: vi.fn(), publications: vi.fn(),
  unexpected: vi.fn((name: string): never => { throw new Error(`Unexpected external fixture call: ${name}`); }),
}));

// Only configuration/authority observations and outward ports are controlled.
// No install client is constructed: every actual database operation uses the
// isolated schema, including CAS, checkpoints, EER and Workroom activity writes.
vi.mock("@dpf/db", async () => ({
  ...await import("../../../../packages/db/generated/client/client"),
  prisma: new Proxy({}, { get(_target, key) {
    if (!ports.db) throw new Error("Capacity PostgreSQL fixture is not ready.");
    const value = ports.db[key as string];
    return typeof value === "function" ? value.bind(ports.db) : value;
  } }),
}));
vi.mock("@/lib/jobs", async () => {
  const { createRoutingJobsClient } = await import("@/lib/jobs/routing");
  const { insertEvents } = await import("@/lib/jobs/postgres/store");
  return { jobs: createRoutingJobsClient({ engine: "postgres", functions: null }, {
    createFunction: () => ports.unexpected("Inngest registration"),
    send: async () => ports.unexpected("Inngest send"),
  }, events => insertEvents(ports.pool, events)) };
});
vi.mock("@/lib/nonprod/environment-lease", () => ({
  listCapacityReservingNonprodEnvironmentLeases: async () => {
    ports.leaseReads();
    await ports.observeCapacity?.();
    return ports.capacityAvailable ? [] : [{ environmentKey: "local-integration-ci", status: "active",
      claimKey: "fixture-only-capacity", expiresAt: new Date(Date.now() + 60_000) }];
  },
}));
vi.mock("@/lib/inference/routed-inference", async () => {
  const { assertProviderDispatchCapacity } = await import("@/lib/routing/local-provider-capacity");
  return { routeAndCall: async (_messages: unknown, _system: unknown, _sensitivity: unknown,
    options: { activityContract?: { activityId?: string } }) => {
    const id = options.activityContract?.activityId;
    if (id !== "semantic-review:change-reviewer" && id !== "semantic-review:AGT-903") {
      return ports.unexpected(`provider branch ${String(id)}`);
    }
    ports.routeAttempts(id);
    // The real policy throws the real typed pre-dispatch error. The sibling's
    // controlled remote response does not contend for local fixture capacity.
    await assertProviderDispatchCapacity(id.endsWith("change-reviewer") ? "ollama" : "openai");
    ports.completions(id);
    return { content: JSON.stringify({ decision: "pass", issues: [], summary: "Controlled fixture response.",
      failureAnalysisReview: { adequate: true,
        rationale: "Controlled fixture challenge of immutable evidence and bounded recovery; not a native review." } }),
    truncated: false };
  } };
});
vi.mock("./semantic-review-authority", () => ({ verifySemanticReviewAuthority: async () => true }));
vi.mock("./failure-analysis-evidence", () => ({ resolveFailureAnalysisEvidence: async () => ports.failureEvidence }));
vi.mock("./specialist-craft-context", () => ({
  resolveSpecialistCraftContexts: async () => ({ promptBlocks: new Map(), contexts: [] }),
  describeSpecialistCraftContexts: () => "isolated fixture",
  layerCraftOntoSpecialistPrompt: (prompt: string) => prompt,
}));
vi.mock("@/lib/inference/host-gpu-admission", () => ({
  inspectLocalGpuAdmission: async () => ({ defer: null, unloadIdle: false }),
}));
vi.mock("@/lib/observability/threshold-lookup", () => ({
  resolveThresholdForTaskRun: async () => ({ scope: "fixture", heartbeatTimeoutSeconds: 180, totalPhaseTimeoutSeconds: 1800 }),
}));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ getQuiescenceLevel: async () => "normal" }));
vi.mock("@/lib/operate/scheduled-jobs/core", () => ({ isJobEnabled: async () => true }));
vi.mock("@/lib/mcp-task-background-worker", () => ({
  executePersistedRemoteTask: async () => ports.unexpected("unrelated remote task execution"),
}));
vi.mock("@/lib/mcp-task-background-dispatch", async () => ({
  REMOTE_TASK_EXECUTION_EVENT: (await import("@/lib/queue/mcp-task-run-events")).REMOTE_TASK_EXECUTION_EVENT,
  externalMcpTaskAsyncEnabled: () => false,
  reconcilePersistedRemoteTaskDispatches: async () => ({ scanned: 0, enqueued: 0 }),
}));
vi.mock("@/lib/backlog/initiative-readiness/server-reviewer-dispatch", () => ({
  dispatchOwedIndependentReviews: async () => ({ dispatched: 0 }),
}));
// Re-export the actual narrow writer rather than loading unrelated Workroom
// admission paths. Its transaction and source-binding implementation stay real.
vi.mock("@/lib/work-capsules/work-capsule-store", async () => ({
  recordWorkCapsuleEvidence: (await import("@/lib/work-capsules/work-capsule-activity-store")).recordWorkCapsuleEvidence,
}));
vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: ports.publications }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: () => undefined }));
vi.mock("./failure-readiness-status", () => ({ publishFailureReadinessStatus: async () => undefined }));

import { jobs } from "@/lib/jobs";
import { registeredFunction, resetPostgresRegistry, type RegisteredFunction } from "@/lib/jobs/postgres/registry";
import { tickCrons } from "@/lib/jobs/postgres/store";
import { createJobWorker, maxAttemptsFor, type JobWorker } from "@/lib/jobs/postgres/worker";
import { REMOTE_TASK_EXECUTION_EVENT } from "@/lib/queue/mcp-task-run-events";
import { mcpTaskRunExecute, mcpTaskRunDispatchReconciliation } from "@/lib/queue/functions/mcp-task-run-execute";
import { enqueueSemanticReview, reconcileSemanticReviews } from "./semantic-review-background";
import { createSemanticReviewRequest, type SemanticReviewRequest } from "./semantic-review-request";
import { claimSemanticReviewSingleFlight, createPrismaSemanticReviewSingleFlightStore } from "./semantic-review-single-flight";
import { failureAnalysisFixture } from "./failure-analysis.test-fixtures";

// No DATABASE_URL fallback. A missing governed SQL slot reports all cases skipped.
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL;
const schema = `review_capacity_${randomUUID().replaceAll("-", "")}`;
const tables = ["TaskRun", "TaskArtifact", "TaskNode", "WorkCapsule", "ExternalEvidenceRecord", "WorkCapsuleActivity",
  "JobEvent", "JobRun", "JobStep", "JobWait", "JobConcurrencySlot", "JobCronState"];
const capsuleId = "WC-CAPACITY-COMPOSITION-FIXTURE";
const executionId = "mcp/task-run-execute";
const reconciliationId = "mcp/task-run-dispatch-reconciliation";
const mainBranch = "semantic-review:change-reviewer";
const siblingBranch = "semantic-review:AGT-903";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const reviewState = (value: unknown) => object(object(value).semanticReview);

async function bounded<T>(operation: Promise<T>, label: string, ms = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

describe.skipIf(!url)("semantic capacity continuation through PostgreSQL jobs and checkpoints", () => {
  type Fixture = Awaited<ReturnType<typeof createReviewPostgresFixture>>;
  let fixture: Fixture | undefined, setup: Promise<Fixture> | undefined;
  let pool: Pool, db: PrismaClient, worker: JobWorker | undefined;
  let packet: SemanticReviewRequest, taskRunId: string;
  let functions: RegisteredFunction[];
  let cleanupFailure: unknown;
  const inFlight = new Set<Promise<unknown>>();
  const releases: Array<() => void> = [];

  function track<T>(operation: Promise<T>): Promise<T> {
    inFlight.add(operation);
    void operation.then(() => inFlight.delete(operation), () => inFlight.delete(operation));
    return operation;
  }

  function verifyCase(name: string, run: () => Promise<void>, timeout: number) {
    // Retain the entire case, including any DB read interrupted by its deadline,
    // so teardown cannot race code that outlives Vitest's own timeout.
    it(name, () => bounded(track(run()), name, timeout), timeout + 1_000);
  }

  async function stopWork() {
    for (const release of releases.splice(0)) release();
    ports.observeCapacity = undefined;
    // A deadline rejects the test but does not cancel its underlying promise.
    // Retain and drain those promises before allowing TRUNCATE or DROP.
    await bounded(Promise.allSettled([...inFlight]), "capacity fixture operations drain", 15_000);
    if (worker) await bounded(worker.stop(), "capacity fixture worker stop", 10_000);
    worker = undefined;
  }

  // Registered before setup: a setup timeout must still await its real outcome.
  afterAll(async () => {
    if (cleanupFailure) throw cleanupFailure;
    await stopWork();
    if (setup) fixture = await bounded(setup, "capacity fixture setup cleanup", 15_000);
    await bounded(fixture?.close() ?? Promise.resolve(), "capacity fixture schema cleanup", 15_000);
    ports.db = null as unknown as Record<string, unknown>;
    ports.pool = null as unknown as Pool;
    resetPostgresRegistry();
    vi.unstubAllGlobals();
  }, 45_000);

  beforeAll(async () => {
    setup = createReviewPostgresFixture({ url: url!, schema, tables });
    fixture = await bounded(setup, "capacity fixture setup", 20_000);
    ({ pool, db } = fixture);
    ports.db = db as unknown as Record<string, unknown>;
    ports.pool = pool;
    expect(mcpTaskRunExecute.id()).toBe(executionId);
    expect(mcpTaskRunDispatchReconciliation.id()).toBe(reconciliationId);
    functions = [executionId, reconciliationId].map(id => {
      const fn = registeredFunction(id);
      if (!fn) throw new Error(`Missing actual PostgreSQL function registration: ${id}`);
      return fn;
    });
    vi.stubGlobal("fetch", async () => ports.unexpected("network fetch"));
  }, 25_000);

  beforeEach(async () => {
    if (cleanupFailure) throw cleanupFailure;
    await stopWork();
    await bounded(track(initializeCase()), "capacity fixture case setup", 15_000);
  }, 20_000);

  async function initializeCase() {
    await pool.query(`TRUNCATE ${tables.map(table => `"${table}"`).join(",")}`);
    vi.clearAllMocks();
    ports.capacityAvailable = false;
    const artifact = "diff --git a/fixture.tsx b/fixture.tsx\n+controlled capacity fixture\n";
    packet = createSemanticReviewRequest({ surface: "external", authorSurface: "codex", artifactType: "code-change",
      title: "Controlled capacity continuation", artifact, changedFiles: ["fixture.tsx"],
      verificationEvidence: "Isolated test fixture input; not canonical acceptance.",
      ...failureAnalysisFixture({ capsuleId, headTreeHash: "b".repeat(40), diffDigest: createHash("sha256").update(artifact).digest("hex") }),
      identity: { capsuleId, baseTreeHash: "a".repeat(40), headTreeHash: "b".repeat(40), sourceHeadSha: "c".repeat(40),
        diffDigest: createHash("sha256").update(artifact).digest("hex"), specialistIds: ["AGT-903"] },
    }, { userId: "fixture-user", agentId: null, apiTokenId: "fixture-token", authSource: "pat" });
    ports.failureEvidence = packet.input.resolvedFailureEvidence ?? [];
    await db.workroom.create({ data: { capsuleId, title: "Capacity fixture", objective: "Isolated continuation proof",
      source: "external-adoption", repositoryFullName: packet.repository, headSha: packet.input.identity.sourceHeadSha } });
    const store = createPrismaSemanticReviewSingleFlightStore(db, { packet });
    const claim = await claimSemanticReviewSingleFlight({ gateKey: packet.gateKey, capsuleId,
      userId: packet.actor.userId, title: packet.input.title, objective: packet.input.title }, store,
    async () => ports.unexpected("prior receipt reuse during fresh fixture admission"));
    expect(claim.disposition).toBe("admitted");
    taskRunId = claim.taskRunId;
    worker = createJobWorker({ pool, functions, schedulesEnabled: true, concurrency: 4 });
  }

  afterEach(async () => {
    try { await stopWork(); }
    catch (error) { cleanupFailure = error; throw error; }
    expect(ports.unexpected).not.toHaveBeenCalled();
  }, 30_000);

  function barrier(participants: number) {
    let arrived = 0, signal!: () => void, release!: () => void;
    const arrivals = new Promise<void>(resolve => { signal = resolve; });
    const open = new Promise<void>(resolve => { release = resolve; });
    releases.push(release);
    return { arrivals, release, count: () => arrived, enter: async () => {
      arrived += 1;
      if (arrived === participants) signal();
      await bounded(open, "capacity observation barrier", 8_000);
    } };
  }

  const task = () => db.taskRun.findUniqueOrThrow({ where: { taskRunId } });
  const artifacts = () => db.taskArtifact.findMany({ orderBy: { id: "asc" } });
  const nodes = () => db.taskNode.findMany({ orderBy: { taskNodeId: "asc" } });
  const evidence = () => db.externalEvidenceRecord.findMany({ orderBy: { id: "asc" } });
  const activities = () => db.workroomActivity.findMany({ orderBy: { id: "asc" } });
  const executionEvents = async () => (await pool.query<{ id: string }>(
    'SELECT id FROM "JobEvent" WHERE name=$1 ORDER BY id', [REMOTE_TASK_EXECUTION_EVENT])).rows;
  const decision = (details: unknown) => object(object(details).result).decision;

  async function pump() {
    await bounded(track(worker!.drain()), "capacity PostgreSQL worker drain");
    const runs = await pool.query<{ status: string; error: string | null }>('SELECT status,error FROM "JobRun"');
    expect(runs.rows.length).toBeGreaterThan(0);
    // The worker catches handler/engine failures; drain completion alone is not
    // verification. A future retry or a parked/failed run must fail this suite.
    for (const run of runs.rows) expect(run).toEqual({ status: "completed", error: null });
  }

  async function produceWait() {
    expect(await enqueueSemanticReview(taskRunId)).toBe(true);
    await pump();
    const held = await task();
    expect(held.status).toBe("input-required");
    expect(held.completedAt).toBeNull();
    expect(reviewState(held.progressPayload)).toMatchObject({ reason: "review-capacity-deferred", dispatchAttempt: 1,
      deadlineAt: packet.deadlineAt, capacityRecovery: { schemaVersion: 1, requestDigest: packet.digest, checks: 0 } });
    const recorded = await nodes();
    expect(recorded).toHaveLength(2);
    const deferred = recorded.find(node => node.taskNodeId.endsWith(":change-reviewer"))!;
    const sibling = recorded.find(node => node.taskNodeId.endsWith(":AGT-903"))!;
    expect(deferred.status).toBe("completed");
    expect(deferred.outputSnapshot).toMatchObject({ requestDigest: packet.digest, providerOutcome: "not-dispatched",
      result: { decision: "inconclusive", inconclusiveReason: "review-capacity-deferred" },
      capacityDeferral: { requestDigest: packet.digest, generation: reviewState(held.progressPayload).generation,
        reason: "local-ci-active-capacity-reservation" } });
    expect(sibling.outputSnapshot).toMatchObject({ requestDigest: packet.digest, result: { decision: "pass" } });
    expect(ports.routeAttempts.mock.calls.map(([id]) => id).sort()).toEqual([siblingBranch, mainBranch].sort());
    expect(ports.completions.mock.calls).toEqual([[siblingBranch]]);
    const history = await evidence();
    const activityHistory = await activities();
    const room = await db.workroom.findUniqueOrThrow({ where: { capsuleId } });
    expect(history).toHaveLength(1);
    expect(decision(history[0]!.details)).toBe("inconclusive");
    expect(history[0]).toMatchObject({ taskRunId, workCapsuleId: room.id,
      details: { capsuleId, headTreeHash: packet.input.identity.headTreeHash, diffDigest: packet.input.identity.diffDigest } });
    expect(activityHistory).toHaveLength(1);
    expect(object(activityHistory[0]!.payload).targetId).toBe(history[0]!.id);
    expect(decision(object(activityHistory[0]!.payload).result)).toBe("inconclusive");
    return { held, sibling, deferred, recorded, history, activityHistory, requestArtifacts: await artifacts() };
  }

  async function makeWaitDue() {
    // Alter only fixture observation timing, never its packet/deadline/counters.
    await pool.query(`UPDATE "TaskRun" SET "progressPayload"=jsonb_set("progressPayload",
      '{semanticReview,capacityRecovery,nextCheckAt}',to_jsonb($2::text)),"updatedAt"=clock_timestamp()
      WHERE "taskRunId"=$1`, [taskRunId, new Date(Date.now() - 1_000).toISOString()]);
  }

  async function enqueueCron() {
    const fn = functions.find(candidate => candidate.id === reconciliationId)!;
    const schedules = new Map([[fn.id, { crons: fn.crons, maxAttempts: maxAttemptsFor(fn) }]]);
    await tickCrons(pool, schedules);
    await pool.query('UPDATE "JobCronState" SET "nextFireAt"=now()-interval \'1 second\' WHERE "functionKey"=$1', [fn.id]);
    expect(await tickCrons(pool, schedules)).toBe(1);
  }

  async function assertCronCompleted() {
    const runs = await pool.query<{ id: string; status: string; output: unknown }>(
      'SELECT id,status,output FROM "JobRun" WHERE "functionKey"=$1', [reconciliationId]);
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]!.status).toBe("completed");
    const steps = await pool.query<{ output: unknown }>('SELECT output FROM "JobStep" WHERE "runId"=$1 AND "stepKey"=$2',
      [runs.rows[0]!.id, "reconcile-native-semantic-reviews"]);
    expect(steps.rows).toHaveLength(1);
    expect(object(runs.rows[0]!.output).native).toEqual(steps.rows[0]!.output);
    return object(steps.rows[0]!.output);
  }

  verifyCase("continues one generation through scheduled jobs, preserving the request, sibling and historical evidence", async () => {
    const original = await produceWait();
    await makeWaitDue();
    ports.capacityAvailable = true;
    const rendezvous = barrier(3);
    ports.observeCapacity = rendezvous.enter;
    await enqueueCron();
    // All three observations occur after real candidate reads, before recovery
    // CAS. The registered scheduled handler competes with both direct callers.
    const cron = track(worker!.drain());
    const first = track(reconcileSemanticReviews());
    const second = track(reconcileSemanticReviews());
    await bounded(rendezvous.arrivals, "three real recovery candidates", 6_000);
    expect(rendezvous.count()).toBe(3);
    expect((await task()).status).toBe("input-required");
    rendezvous.release();
    const [, a, b] = await bounded(Promise.all([cron, first, second]), "concurrent recovery CAS");
    await pump();
    const scheduled = await assertCronCompleted();
    expect(Number(scheduled.enqueued) + a.enqueued + b.enqueued).toBe(1);
    expect(await executionEvents()).toHaveLength(2);
    const completed = await task();
    const current = reviewState(completed.progressPayload);
    expect(completed.id).toBe(original.held.id);
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();
    expect(current).toMatchObject({ requestDigest: packet.digest, deadlineAt: packet.deadlineAt,
      dispatchAttempt: 2, recoveryAttempt: 1, capacityRecovery: null, state: "completed" });
    expect(current.generation).not.toBe(reviewState(original.held.progressPayload).generation);
    expect(await artifacts()).toEqual(original.requestArtifacts);
    const checkpoints = await nodes();
    expect(checkpoints).toHaveLength(3);
    expect(checkpoints.find(node => node.id === original.sibling.id)).toEqual(original.sibling);
    expect(checkpoints.some(node => node.taskNodeId.endsWith(":AGT-903:recovery-1"))).toBe(false);
    const successor = checkpoints.find(node => node.taskNodeId.endsWith(":change-reviewer:recovery-1"))!;
    expect(successor.status).toBe("completed");
    expect(successor.outputSnapshot).toMatchObject({ requestDigest: packet.digest, result: { decision: "pass" } });
    expect(checkpoints.find(node => node.id === original.deferred.id)).toMatchObject({ status: "superseded",
      supersededByNodeId: successor.id, outputSnapshot: { requestDigest: packet.digest,
        providerOutcome: "inconclusive", result: { decision: "inconclusive" } } });
    expect(ports.completions.mock.calls).toEqual([[siblingBranch], [mainBranch]]);
    const finalEvidence = await evidence(), finalActivities = await activities();
    expect(finalEvidence).toHaveLength(2);
    expect(finalEvidence.find(row => row.id === original.history[0]!.id)).toEqual(original.history[0]);
    expect(finalActivities.find(row => row.id === original.activityHistory[0]!.id)).toEqual(original.activityHistory[0]);
    expect(object(completed.progressPayload).evidenceRecordId).toBe(current.evidenceRecordId);
    const final = finalEvidence.find(row => row.id === current.evidenceRecordId)!;
    expect(final).toMatchObject({ taskRunId, workCapsuleId: original.history[0]!.workCapsuleId,
      target: capsuleId, operationType: "semantic-change-review.receipt", provider: "dpf-change-review",
      details: { ...packet.input.identity, result: { decision: "pass" } } });
    expect(finalActivities).toHaveLength(2);
    const finalActivity = finalActivities.find(row => object(row.payload).targetId === final.id)!;
    expect(finalActivity).toMatchObject({ workCapsuleId: final.workCapsuleId, kind: "evidence-recorded" });
    expect(object(finalActivity.payload).result).toEqual(final.details);

    expect(typeof current.eventId).toBe("string");
    const lastEventId = String(current.eventId);
    await jobs.send({ id: lastEventId, name: REMOTE_TASK_EXECUTION_EVENT, data: { taskRunId } });
    await pump();
    expect(await executionEvents()).toHaveLength(2); // Sender deduplication.
    await jobs.send({ id: `fixture-duplicate:${randomUUID()}`, name: REMOTE_TASK_EXECUTION_EVENT, data: { taskRunId } });
    await pump(); // A NEW event must reach the real completed-task duplicate guard.
    expect(await executionEvents()).toHaveLength(3);
    expect(await task()).toEqual(completed);
    expect(await nodes()).toEqual(checkpoints);
    expect(await evidence()).toEqual(finalEvidence);
    expect(await activities()).toEqual(finalActivities);
    expect(ports.completions.mock.calls).toEqual([[siblingBranch], [mainBranch]]);
  }, 35_000);

  verifyCase("persists bounded unavailable-capacity backoff without another dispatch or premature observation", async () => {
    const original = await produceWait();
    await makeWaitDue();
    const prior = await task();
    const observations = ports.leaseReads.mock.calls.length;
    const before = Date.now();
    await enqueueCron();
    await pump();
    expect(await assertCronCompleted()).toMatchObject({ scanned: 1, enqueued: 0, waiting: 1 });
    const waiting = await task(), state = reviewState(waiting.progressPayload);
    const marker = object(state.capacityRecovery);
    expect(waiting.status).toBe("input-required");
    expect(waiting.completedAt).toBeNull();
    expect(state).toMatchObject({ reason: "review-capacity-deferred", capacityWaitReason: "local-ci-active-capacity-reservation",
      dispatchAttempt: 1, deadlineAt: packet.deadlineAt,
      capacityRecovery: { schemaVersion: 1, requestDigest: packet.digest, checks: 1 } });
    expect(state.recoveryAttempt).toBe(reviewState(prior.progressPayload).recoveryAttempt);
    expect(state.generation).toBe(reviewState(prior.progressPayload).generation);
    expect(Date.parse(String(marker.nextCheckAt))).toBeGreaterThanOrEqual(before + 60_000);
    expect(Date.parse(String(marker.nextCheckAt))).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(ports.leaseReads).toHaveBeenCalledTimes(observations + 1);
    expect(await reconcileSemanticReviews(new Date(Date.parse(String(marker.nextCheckAt)) - 1)))
      .toEqual({ scanned: 0, enqueued: 0, waiting: 0 });
    expect(ports.leaseReads).toHaveBeenCalledTimes(observations + 1);
    expect(await task()).toEqual(waiting);
    expect(await artifacts()).toEqual(original.requestArtifacts);
    expect(await nodes()).toEqual(original.recorded);
    expect(await evidence()).toEqual(original.history);
    expect(await activities()).toEqual(original.activityHistory);
    expect(await executionEvents()).toHaveLength(1);
    expect(ports.completions.mock.calls).toEqual([[siblingBranch]]);
  }, 25_000);

  verifyCase("loses recovery CAS to committed cancellation after observing a real capacity-wait candidate", async () => {
    const original = await produceWait();
    await makeWaitDue();
    const candidate = await task();
    const rendezvous = barrier(1);
    ports.capacityAvailable = true;
    ports.observeCapacity = rendezvous.enter;
    await enqueueCron();
    const running = track(worker!.drain());
    await bounded(rendezvous.arrivals, "reconciler candidate observation", 6_000);
    expect(rendezvous.count()).toBe(1);
    const canceled = await db.taskRun.update({ where: { taskRunId }, data: { status: "canceled", completedAt: new Date() } });
    expect(canceled.progressPayload).toEqual(candidate.progressPayload);
    rendezvous.release();
    await bounded(running, "cancelled recovery worker drain");
    await pump();
    expect(await assertCronCompleted()).toMatchObject({ scanned: 1, enqueued: 0, waiting: 1 });
    expect(await task()).toEqual(canceled);
    expect(await artifacts()).toEqual(original.requestArtifacts);
    expect(await nodes()).toEqual(original.recorded);
    expect(await executionEvents()).toHaveLength(1);
    expect(await evidence()).toEqual(original.history);
    expect(await activities()).toEqual(original.activityHistory);
    expect(ports.completions.mock.calls).toEqual([[siblingBranch]]);
  }, 25_000);
});
