// BI-79141B50 — a resumed semantic review must stay alive while its branch runs.
//
// Live loss, 2026-11-05 (TR-GATE-1802F3700F7DFCF2CB415B1F): a review submitted
// at 19:52:46 was resumed at 20:36 (capacity-restored) and at 20:43 (operator
// retry). Each time the stall watchdog marked the TaskRun "stalled" for
// total_timeout within a minute (StallEvent 20:36:49, 20:43:34), because the
// new generation inherited the original submission's startedAt and was
// already past the 30-minute wall-clock cap. heartbeat() then skipped the
// non-live row, the branch lost its fence ("generation-no-longer-owned"), and
// reconcileSemanticReviews parked it as executor-loss three minutes later.
//
// This drives the real reservation, heartbeat ticker, governed-inference
// fence, watchdog stall decision and reconciler over one in-memory TaskRun.
// Only storage, provider dispatch and authority are synthetic.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const { m, db } = vi.hoisted(() => {
const m = {
  run: {} as Record<string, any>,
  nodes: new Map<string, Record<string, any>>(),
  release: null as null | (() => void),
};
type Row = Record<string, any>;

function matchesStatus(actual: string, where: unknown): boolean {
  if (where === undefined) return true;
  if (typeof where === "string") return actual === where;
  const filter = where as { in?: string[]; equals?: string; notIn?: string[] };
  if (filter.in) return filter.in.includes(actual);
  if (filter.notIn) return !filter.notIn.includes(actual);
  return filter.equals === undefined || actual === filter.equals;
}
function matchesRun(where: Row): boolean {
  if (where.taskRunId && where.taskRunId !== m.run.taskRunId) return false;
  if (!matchesStatus(m.run.status, where.status)) return false;
  if (where.updatedAt && (where.updatedAt as Date).getTime() !== (m.run.updatedAt as Date).getTime()) return false;
  if (where.progressPayload && m.run.progressPayload?.semanticReview?.generation !== where.progressPayload.equals) return false;
  return true;
}
const db: Row = {
  taskRun: {
    findUnique: vi.fn(async () => ({ ...m.run })),
    // Over-select on purpose: the reconciler's own in-code liveness gates
    // must keep a live resumed review, not the coarse SQL prefilter.
    findMany: vi.fn(async () => ["submitted", "working", "stalled"].includes(m.run.status) ? [{ ...m.run }] : []),
    updateMany: vi.fn(async ({ where, data }: Row) => {
      if (!matchesRun(where)) return { count: 0 };
      Object.assign(m.run, data, { updatedAt: new Date() }); // Prisma @updatedAt
      return { count: 1 };
    }),
    update: vi.fn(async ({ data }: Row) => Object.assign(m.run, data, { updatedAt: new Date() })),
  },
  taskNode: {
    findUnique: vi.fn(async ({ where }: Row) => m.nodes.get(where.taskNodeId) ?? null),
    findMany: vi.fn(async () => [...m.nodes.values()]),
    findFirst: vi.fn(async ({ where }: Row) => [...m.nodes.values()].find(node => matchesStatus(node.status, where.status)) ?? null),
    create: vi.fn(async ({ data }: Row) => { const node = { id: `node-${m.nodes.size}`, ...data }; m.nodes.set(data.taskNodeId, node); return node; }),
    update: vi.fn(async ({ where, data }: Row) => Object.assign(m.nodes.get(where.taskNodeId)!, data)),
  },
  taskArtifact: { findUnique: vi.fn() },
  runtimeVerification: { findUnique: vi.fn(async () => null) },
  workroom: { findUnique: vi.fn() },
  featureBuild: { findUnique: vi.fn(async () => null) },
  buildStudioStallThreshold: { findUnique: vi.fn(async () => ({ heartbeatTimeoutSeconds: 120, totalPhaseTimeoutSeconds: 1800 })) },
  $transaction: vi.fn(async (fn: (tx: Row) => unknown) => fn(db)),
};
return { m, db };
});

vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/observability/external-evidence-store", () => ({ recordExternalEvidenceInStore: vi.fn(async () => ({ id: "evidence-1" })) }));
vi.mock("@/lib/queue/mcp-task-run-events", () => ({ sendMcpTaskRunExecutionEvent: vi.fn() }));
vi.mock("@/lib/work-capsules/work-capsule-store", () => ({ recordWorkCapsuleEvidence: vi.fn(async () => ({ id: "activity-1" })) }));
vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));
vi.mock("./semantic-review-authority", () => ({ verifySemanticReviewAuthority: vi.fn(async () => true) }));
vi.mock("./routed-semantic-review", () => ({
  dispatchRoutedSemanticReview: vi.fn(async (_prompt: unknown, _context: unknown, branch: (id: string, run: () => Promise<unknown>) => Promise<unknown>) =>
    branch("AGT-181", () => new Promise(resolve => { m.release = () => resolve(result); }))),
}));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ getQuiescenceLevel: vi.fn(async () => "normal") }));
vi.mock("./failure-analysis-evidence", () => ({ resolveFailureAnalysisEvidence: vi.fn(async () => packet.input.resolvedFailureEvidence) }));
vi.mock("./failure-readiness-status", () => ({ publishFailureReadinessStatus: vi.fn() }));

import { createSemanticReviewRequest, SEMANTIC_REVIEW_HEARTBEAT_STALE_MS } from "./semantic-review-request";
import { failureAnalysisFixture } from "./failure-analysis.test-fixtures";
import { executePersistedSemanticReview, reconcileSemanticReviews } from "./semantic-review-background";
import { decideStall } from "@/lib/observability/watchdog-detect";
import { TASK_LIVE_STATES } from "@/lib/tak/task-states";

const result = { decision: "pass", failureAnalysisReview: { adequate: true, rationale: "Challenged the resumed liveness path against the executed test." },
  issues: [], summary: "Exact diff reviewed." };
const SUBMITTED_AT = new Date("2026-11-05T19:52:46.658Z");
const RESUMED_AT = new Date("2026-11-05T20:36:00.950Z"); // 43 minutes later
const HEAD = "c".repeat(40);
let packet: ReturnType<typeof createSemanticReviewRequest>;

/** One tick of the stall watchdog (taskrun-watchdog.ts): live rows, default threshold, real decision. */
function watchdogTick() {
  if (!(TASK_LIVE_STATES as readonly string[]).includes(m.run.status)) return null;
  const decision = decideStall({ taskRunId: m.run.taskRunId, buildId: null, phase: null, source: m.run.source,
    startedAt: m.run.startedAt, lastHeartbeatAt: m.run.lastHeartbeatAt },
  { scope: "default", heartbeatTimeoutSeconds: 120, totalPhaseTimeoutSeconds: 1800 }, new Date());
  if (decision) Object.assign(m.run, { status: "stalled", completedAt: new Date(), updatedAt: new Date() });
  return decision?.reason ?? null;
}

describe("resumed semantic review liveness (BI-79141B50)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: SUBMITTED_AT, toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const diffDigest = createHash("sha256").update("diff").digest("hex");
    packet = createSemanticReviewRequest({ surface: "external", authorSurface: "claude", artifactType: "code-change",
      title: "Review", artifact: "diff", changedFiles: ["a.ts"], verificationEvidence: "Tests passed",
      ...failureAnalysisFixture({ capsuleId: "WC-1", headTreeHash: "b".repeat(40), diffDigest }),
      identity: { capsuleId: "WC-1", baseTreeHash: "a".repeat(40), headTreeHash: "b".repeat(40), diffDigest,
        specialistIds: [], sourceHeadSha: HEAD },
    }, { userId: "user-1", agentId: null, apiTokenId: "token-1", authSource: "pat" });
    db.taskArtifact.findUnique.mockResolvedValue({ taskRunId: "run-row-1", parts: [{ kind: "data", data: packet }] });
    db.workroom.findUnique.mockResolvedValue({ id: "room-1", headSha: HEAD, repositoryFullName: packet.repository });
    m.nodes.clear();
    m.release = null;
    vi.setSystemTime(RESUMED_AT);
  });
  afterEach(() => { vi.useRealTimers(); });

  it.each([
    ["capacity-restored", 1],
    ["operator-authorized-inference-replacement", 2],
  ])("keeps a %s generation heartbeating and unparked while its branch outlives the stale window", async (recoveryReason, recoveryAttempt) => {
    // The resumed TaskRun keeps the original submission's identity and clock.
    m.run = { id: "run-row-1", taskRunId: "TR-1", userId: "user-1", source: "mcp", status: "submitted",
      startedAt: SUBMITTED_AT, lastHeartbeatAt: new Date("2026-11-05T20:02:03.000Z"), completedAt: null, updatedAt: new Date(),
      a2aMetadata: { gateKind: "semantic-review", gateKey: packet.gateKey, capsuleId: "WC-1" },
      progressPayload: { semanticReview: { schemaVersion: 1, requestDigest: packet.digest, deadlineAt: packet.deadlineAt,
        state: "pending", generation: null, dispatchAttempt: 1, recoveryReason, recoveryAttempt,
        // As on the live run: the packet window lapsed during the capacity wait, which is credited back.
        capacityWaitCreditMs: 34 * 60_000 } } };

    const execution = executePersistedSemanticReview("TR-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(m.run.status).toBe("working");
    expect(m.release).not.toBeNull(); // the branch is mid provider call

    const stalls: Array<string | null> = [];
    const windowMs = SEMANTIC_REVIEW_HEARTBEAT_STALE_MS + 60_000;
    for (let elapsed = 60_000; elapsed <= windowMs; elapsed += 60_000) {
      await vi.advanceTimersByTimeAsync(60_000);
      stalls.push(watchdogTick());
      if (elapsed % 120_000 === 0) await reconcileSemanticReviews(new Date());
    }

    expect(stalls.filter(Boolean)).toEqual([]);
    expect(m.run.status).toBe("working");
    expect(Date.now() - (m.run.lastHeartbeatAt as Date).getTime()).toBeLessThan(SEMANTIC_REVIEW_HEARTBEAT_STALE_MS);
    expect(m.run.progressPayload.semanticReview.reason).not.toBe("provider-outcome-uncertain-after-restart");
    const branch = m.nodes.get(`semantic-review:TR-1:AGT-181:recovery-${recoveryAttempt}`);
    expect(branch?.status).toBe("running");

    m.release!();
    await vi.advanceTimersByTimeAsync(0);
    await expect(execution).resolves.toMatchObject({ status: "completed" });
    expect(m.nodes.get(`semantic-review:TR-1:AGT-181:recovery-${recoveryAttempt}`)?.status).toBe("completed");
  });
});
