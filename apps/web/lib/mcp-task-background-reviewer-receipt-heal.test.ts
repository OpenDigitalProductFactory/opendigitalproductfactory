// BI-2E479619 AC-4 (self-heal): reviewer TaskRuns already parked input-required
// with noncompliance "prose-without-required-writer", whose governed writer in
// fact succeeded natively (CLI MCP session) and minted a receipt, must be
// reconciled to the recorded outcome by the background reconciler — no hand-run
// DB write. Today automaticReviewerRecoveryWait (mcp-task-background-dispatch.ts:40)
// returns null as soon as any writer row exists, so the reconciler counts the
// row as "raced" and it stays stranded forever (~171 such runs on 2026-10-07).
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; taskRunId: string; toolName: string; result: Record<string, unknown>; success: boolean;
  executionMode: string; createdAt: Date };
const db = vi.hoisted(() => ({
  executions: [] as Row[],
  item: null as unknown,
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  findEnvelope: vi.fn(),
}));
const queue = vi.hoisted(() => ({ send: vi.fn() }));

function findRows(args?: { where?: Record<string, unknown>; orderBy?: unknown }) {
  const where = args?.where ?? {};
  const rows = db.executions.filter((row) => Object.entries(where).every(([key, condition]) => {
    if (condition !== null && typeof condition === "object" && "in" in (condition as object)) {
      return ((condition as { in: unknown[] }).in).includes((row as Record<string, unknown>)[key]);
    }
    return condition === undefined || (row as Record<string, unknown>)[key] === condition;
  })).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return JSON.stringify(args?.orderBy ?? "").includes("desc") ? rows.reverse() : rows;
}

vi.mock("@dpf/db", () => ({
  prisma: {
    toolExecution: {
      findFirst: vi.fn(async (args?: { where?: Record<string, unknown> }) => findRows(args)[0] ?? null),
      findMany: vi.fn(async (args?: { where?: Record<string, unknown> }) => findRows(args)),
    },
    coworkerActionEnvelope: { findFirst: (...args: unknown[]) => db.findEnvelope(...args) },
    asyncInferenceOp: { findFirst: vi.fn(async () => null) },
    backlogItem: { findUnique: vi.fn(async () => db.item) },
    taskRun: {
      update: (...args: unknown[]) => db.update(...args),
      updateMany: (...args: unknown[]) => db.updateMany(...args),
      findMany: (...args: unknown[]) => db.findMany(...args),
      findUnique: (...args: unknown[]) => db.findUnique(...args),
    },
  },
}));
vi.mock("./backlog/initiative-readiness/parent-scope-inheritance", () => ({ loadInheritedInitiativeScope: vi.fn(async () => null) }));
vi.mock("./mcp-task-notification-bus", () => ({ mcpTaskNotificationBus: { publish: vi.fn() } }));
vi.mock("@/lib/queue/mcp-task-run-events", () => ({
  REMOTE_TASK_EXECUTION_EVENT: "mcp/task-run.execute",
  sendMcpTaskRunExecutionEvent: (...args: unknown[]) => queue.send(...args),
}));
vi.mock("@/lib/inference/async-operation-runtime", () => ({
  requestPrismaAuthorizedAsyncOperationCancellation: vi.fn(),
  enqueuePrismaAsyncOperationWake: vi.fn(),
}));
vi.mock("./mcp-task-durable-inference-runtime", () => ({ ensureDurableInferenceTaskRecipes: vi.fn() }));

import { reconcilePersistedRemoteTaskDispatches } from "./mcp-task-background-dispatch";
import { loadTaskInitiativeReviewOutcome } from "./mcp-task-review-outcome";

const TASK_RUN_ID = "TR-MCP-STRANDED-6C272F7C1DAE";
const writerToolName = "record_initiative_design_review";
const RECEIPT_ID = "initiative-628e7bbd-ced2-4f4a-b2fc-0d82d36e42ae";
const artifactRef = {
  kind: "repo-blob-at-commit" as const,
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  commitSha: "95b30aa358dd8346534842e5a9ba667847235ee0",
  path: "docs/superpowers/specs/2026-10-07-approval-convergence-on-envelope-design.md",
  providerBlobId: "7f11b356a9dde0d33170504f5c023557c05d0495",
};
const binding = { writerToolName, itemId: "BI-C8EC05C9", gate: "design-spec" as const, artifactRef };
const receipt = {
  schemaVersion: 1, receiptId: RECEIPT_ID, gate: "design-spec", decision: "pass",
  subject: { kind: "backlog-item", id: "BI-C8EC05C9" }, artifactRef, artifactDigest: "digest",
  reviewerPrincipalId: "reviewer", reviewerAgentId: "AGT-WS-REVIEW", artifactAuthorRef: "author",
  authorityDecisionId: "AUTH-1", authoritySnapshot: {}, findingRefs: [], resolvedFindingRefs: [], reason: "Reviewed.",
};
const PROSE_FAILURE = `The provider did not honor the required writer tool-call contract for ${writerToolName}. The same TaskRun remains resumable. No receipt was created.`;
const wait = { schemaVersion: 1, kind: "missing-terminal-writer", writerToolName, attempt: 1, resumeMode: "same-taskrun",
  observedAt: "2026-10-07T18:21:20.326Z", noncompliance: "prose-without-required-writer", dispatchContract: "receipt-verified" };
// The live row's shape (TaskRun ...6C272F7C1DAE).
const stranded = {
  id: "row-stranded", taskRunId: TASK_RUN_ID, userId: "user-1", status: "input-required",
  updatedAt: new Date(wait.observedAt),
  progressPayload: { summary: PROSE_FAILURE, riskClass: "bounded-write", executedToolCount: 0, terminalWriterWait: wait,
    dispatch: { kind: "external-mcp-task", state: "claimed", attempt: 1, schemaVersion: 1,
      eventId: `mcp-task-run:${TASK_RUN_ID}:execute:1`, requestedAt: "2026-10-07T18:16:53.251Z" } },
  a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding: binding },
};
const NOW = new Date("2026-10-07T19:00:00.000Z");
const nativeWriter = (success: boolean): Row => ({
  id: "te-writer", taskRunId: TASK_RUN_ID, toolName: writerToolName, success, executionMode: "internal-mcp-session",
  createdAt: new Date("2026-10-07T18:18:52.717Z"),
  result: success
    ? { success: true, entityId: RECEIPT_ID, message: "design-spec receipt recorded for BI-C8EC05C9.", data: { receiptId: RECEIPT_ID } }
    : { success: false, error: "CANONICAL_DESIGN_REQUIRED", message: "AC-CHAR has a malformed objective link." },
});
function completedWrites() {
  return [...db.update.mock.calls, ...db.updateMany.mock.calls]
    .map((call) => (call[0] as { where: Record<string, unknown>; data: { status?: string; progressPayload?: Record<string, unknown> } }))
    .filter((args) => args.data?.status === "completed");
}

beforeEach(() => {
  vi.clearAllMocks();
  db.executions = [];
  db.item = {
    id: "item", itemId: "BI-C8EC05C9", type: "product", workType: "feature", scopeKind: "platform", source: "user-request",
    activeBuild: null,
    activities: [{ id: RECEIPT_ID, kind: "initiative_gate_receipt", gateKey: "design_spec", recordedAt: new Date(), payload: receipt }],
  };
  db.update.mockResolvedValue({});
  db.updateMany.mockResolvedValue({ count: 1 });
  db.findMany.mockResolvedValue([stranded]);
  db.findUnique.mockResolvedValue(stranded);
  db.findEnvelope.mockResolvedValue(null);
  queue.send.mockResolvedValue({ ids: ["event-1"] });
});

describe("BI-2E479619 AC-4 stranded reviewer runs heal from their persisted receipt", () => {
  it("fixture sanity: the stranded run's native writer row resolves to the persisted pass", async () => {
    db.executions.push(nativeWriter(true));
    await expect(loadTaskInitiativeReviewOutcome(TASK_RUN_ID, binding)).resolves.toMatchObject({ receiptId: RECEIPT_ID, decision: "pass" });
  });

  it("reconciles a parked run with a successful native writer to completed with its recorded outcome, without re-dispatching", async () => {
    db.executions.push(nativeWriter(true));

    await reconcilePersistedRemoteTaskDispatches({ now: NOW, includeOrdinary: false });

    expect(queue.send).not.toHaveBeenCalled();
    const writes = completedWrites();
    expect(writes, "the stranded TaskRun was never reconciled to completed").toHaveLength(1);
    expect(writes[0]!.where).toMatchObject({ taskRunId: TASK_RUN_ID });
    expect(writes[0]!.data.progressPayload).toMatchObject({ reviewOutcome: { receiptId: RECEIPT_ID, decision: "pass" }, requiresApproval: false });
    expect(writes[0]!.data.progressPayload).not.toHaveProperty("terminalWriterWait");
    expect(JSON.stringify(writes[0]!.data.progressPayload)).not.toContain("No receipt was created");
  });

  it("never completes a parked run whose native writer was refused", async () => {
    db.executions.push(nativeWriter(false));
    db.item = { ...(db.item as Record<string, unknown>), activities: [] };

    await reconcilePersistedRemoteTaskDispatches({ now: NOW, includeOrdinary: false });

    expect(completedWrites()).toHaveLength(0);
  });
});
