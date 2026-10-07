// BI-2E479619: the executor's completion boundary must recognise a governed
// writer the Claude CLI ran natively through its MCP session. Today
// mcp-task-execution derives writerResult only from the loop's executedTools
// (:243), so terminalWriterSucceeded is false (:291), terminalWriterMissing is
// true (:293) and the run is parked with noncompliance
// "prose-without-required-writer" (:470) although the receipt exists.
//
// The agentic loop is stubbed to return exactly what it returns on the live
// install for a CLI reviewer turn. The ToolExecution and BacklogItem tables are
// in-memory fakes; the receipt lookup (mcp-task-review-outcome) runs for real.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string; taskRunId: string; toolName: string; result: Record<string, unknown>;
  success: boolean; executionMode: string; createdAt: Date;
};
const db = vi.hoisted(() => ({
  executions: [] as Row[],
  item: null as unknown,
  findModelConfig: vi.fn(),
  findTaskRun: vi.fn(),
  updateTaskRun: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({ execute: vi.fn(), resolveAgent: vi.fn(), resolveTools: vi.fn() }));

function matches(value: unknown, condition: unknown): boolean {
  if (condition === undefined) return true;
  if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
    const c = condition as Record<string, unknown>;
    if ("in" in c) return (c["in"] as unknown[]).includes(value);
    if ("not" in c) return value !== c["not"];
    const t = value instanceof Date ? value.getTime() : Number.NaN;
    const at = (k: string) => (c[k] instanceof Date ? (c[k] as Date).getTime() : Date.parse(String(c[k])));
    if ("gte" in c && !(t >= at("gte"))) return false;
    if ("gt" in c && !(t > at("gt"))) return false;
    if ("lte" in c && !(t <= at("lte"))) return false;
    if ("lt" in c && !(t < at("lt"))) return false;
    return true;
  }
  return value === condition;
}
function findRows(args?: { where?: Record<string, unknown>; orderBy?: unknown }) {
  const where = args?.where ?? {};
  const rows = db.executions
    .filter((row) => Object.entries(where).every(([key, condition]) => matches((row as Record<string, unknown>)[key], condition)))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const order = JSON.stringify(args?.orderBy ?? "");
  return order.includes("desc") ? rows.reverse() : rows;
}

vi.mock("@dpf/db", () => ({
  prisma: {
    agentModelConfig: { findUnique: (...args: unknown[]) => db.findModelConfig(...args) },
    taskRun: {
      findUnique: (...args: unknown[]) => db.findTaskRun(...args),
      update: (...args: unknown[]) => db.updateTaskRun(...args),
      updateMany: (...args: unknown[]) => db.updateTaskRun(...args),
    },
    toolExecution: {
      findMany: vi.fn(async (args?: { where?: Record<string, unknown> }) => findRows(args)),
      findFirst: vi.fn(async (args?: { where?: Record<string, unknown> }) => findRows(args)[0] ?? null),
      count: vi.fn(async (args?: { where?: Record<string, unknown> }) => findRows(args).length),
    },
    backlogItem: { findUnique: vi.fn(async () => db.item) },
  },
}));
vi.mock("./backlog/initiative-readiness/parent-scope-inheritance", () => ({ loadInheritedInitiativeScope: vi.fn(async () => null) }));
vi.mock("./mcp-task-review-outcome", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mcp-task-review-outcome")>();
  return { ...actual, loadTaskInitiativeReviewOutcome: vi.fn(actual.loadTaskInitiativeReviewOutcome) };
});
vi.mock("./mcp-task-review-sensitivity", () => ({ remoteReviewSensitivity: vi.fn(async (_p: unknown, _t: unknown, fallback: string) => fallback) }));
vi.mock("./pir-evidence-context", () => ({ loadPirEvidenceContext: vi.fn(async () => "") }));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("./mcp/external-approval-location-lookup", () => ({ withTaskRunApprovalLocation: vi.fn(async (value: unknown) => value) }));

import { executeRemoteTaskAttempt } from "./mcp-task-execution";
import { loadTaskInitiativeReviewOutcome } from "./mcp-task-review-outcome";
import { createTaskMessage } from "@/lib/tak/task-records";

const TASK_RUN_ID = "TR-MCP-NATIVE-6C272F7C1DAE";
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
const parsed = {
  agentId: "AGT-WS-REVIEW",
  routeContext: "/platform/build",
  title: "Independent design-spec review",
  objective: "Review the immutable artifact.",
  prompt: "Read the source and record the governed design review.",
  idempotencyKey: "initiative-readiness:BI-C8EC05C9:design-spec:95b30aa",
  riskClass: "bounded-write" as const,
  authorityScope: ["backlog-item:BI-C8EC05C9", "tool:read_source_at_version", `tool:${writerToolName}`],
  collaborationKind: "handoff" as const,
  initiativeReviewBinding: binding,
};
const receipt = {
  schemaVersion: 1, receiptId: RECEIPT_ID, gate: "design-spec", decision: "pass",
  subject: { kind: "backlog-item", id: "BI-C8EC05C9" }, artifactRef, artifactDigest: "digest",
  reviewerPrincipalId: "reviewer", reviewerAgentId: "AGT-WS-REVIEW", artifactAuthorRef: "author",
  authorityDecisionId: "AUTH-1", authoritySnapshot: {}, findingRefs: [], resolvedFindingRefs: [], reason: "Reviewed.",
};
const PROSE_FAILURE = `The provider did not honor the required writer tool-call contract for ${writerToolName}. The same TaskRun remains resumable. No receipt was created.`;
// Exactly what executeAutonomousAgenticLoop returns today for a CLI reviewer
// turn whose tools all ran natively.
const liveCliLoopResult = () => ({
  content: PROSE_FAILURE, providerId: "anthropic-sub", modelId: "claude-opus-4-6",
  downgraded: false, downgradeMessage: null, totalInputTokens: 2000, totalOutputTokens: 400,
  executedTools: [], proposal: null,
  failure: { kind: "terminal-writer-missing", message: PROSE_FAILURE },
});

let seq = 0;
const row = (toolName: string, result: Record<string, unknown>, success: boolean): Row => ({
  id: `te-${++seq}`, taskRunId: TASK_RUN_ID, toolName, result, success,
  executionMode: "internal-mcp-session", createdAt: new Date(Date.now() + seq),
});
const nativeRead = () => row("read_source_at_version", {}, true);
const nativeWriterSuccess = () => row(writerToolName, {
  success: true, entityId: RECEIPT_ID, message: "design-spec receipt recorded for BI-C8EC05C9.", data: { receiptId: RECEIPT_ID },
}, true);
const nativeWriterRefused = () => row(writerToolName, {
  success: false, error: "CANONICAL_DESIGN_REQUIRED", message: "AC-CHAR has a malformed objective link.",
}, false);

function run() {
  return executeRemoteTaskAttempt({
    run: { id: "run-internal", taskRunId: TASK_RUN_ID, contextId: "thread-1" },
    threadId: "thread-1",
    token: { tokenId: "PAT", userId: "user-1", capability: "write", source: "pat" },
    userContext: { platformRole: "developer", isSuperuser: false } as never,
    parsed, idempotentReplay: false, capacityAttempt: 1,
  });
}
function settledData() {
  const call = db.updateTaskRun.mock.calls.at(-1);
  return (call?.[0] as { data: { status: string; progressPayload: Record<string, unknown> } } | undefined)?.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  db.executions = [];
  db.item = {
    id: "item", itemId: "BI-C8EC05C9", type: "product", workType: "feature", scopeKind: "platform", source: "user-request",
    activeBuild: null,
    activities: [{ id: RECEIPT_ID, kind: "initiative_gate_receipt", gateKey: "design_spec", recordedAt: new Date(), payload: receipt }],
  };
  db.findModelConfig.mockResolvedValue(null);
  db.findTaskRun.mockResolvedValue({ status: "working", progressPayload: {}, updatedAt: new Date() });
  db.updateTaskRun.mockResolvedValue({ count: 1 });
  autonomous.resolveAgent.mockResolvedValue({ agentId: "AGT-WS-REVIEW", displayName: "Change Reviewer",
    systemPrompt: "Review independently.", sensitivity: "internal" });
  autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
});

describe("BI-2E479619 executor recognises a natively executed terminal writer", () => {
  it("fixture sanity: the receipt lookup already resolves this TaskRun's native writer row to the persisted pass", async () => {
    db.executions.push(nativeRead(), nativeWriterSuccess());
    await expect(loadTaskInitiativeReviewOutcome(TASK_RUN_ID, binding)).resolves.toMatchObject({ receiptId: RECEIPT_ID, decision: "pass" });
  });

  it("AC-2: a native writer that persisted a passing receipt completes the run; executedToolCount counts the native calls", async () => {
    db.executions.push(nativeRead(), nativeRead(), nativeRead(), nativeWriterSuccess());
    autonomous.execute.mockResolvedValue(liveCliLoopResult());

    const outcome = await run();

    expect(outcome).toMatchObject({ kind: "result", result: { status: "completed", executedToolCount: 4 } });
    const data = settledData();
    expect(data?.status).toBe("completed");
    expect(data?.progressPayload).not.toHaveProperty("terminalWriterWait");
    expect(data?.progressPayload).toMatchObject({ executedToolCount: 4, reviewOutcome: { receiptId: RECEIPT_ID, decision: "pass" } });
    expect(vi.mocked(createTaskMessage)).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ executedToolCount: 4 }),
    }));
  });

  it("AC-3: consults loadTaskInitiativeReviewOutcome(taskRunId, binding) before classifying missing-terminal-writer; a persisted receipt wins", async () => {
    // The receipt was minted by an EARLIER attempt on this TaskRun, so this
    // attempt's records (and its native fold) cannot see the writer; only the
    // persisted-receipt guard can.
    db.executions.push({ ...nativeWriterSuccess(), createdAt: new Date(Date.now() - 10 * 60 * 1000) });
    autonomous.execute.mockResolvedValue(liveCliLoopResult());

    const outcome = await run();

    expect(loadTaskInitiativeReviewOutcome).toHaveBeenCalledWith(TASK_RUN_ID, binding);
    const text = JSON.stringify(outcome);
    expect(text).not.toContain("No receipt was created");
    expect(text).not.toContain("prose-without-required-writer");
    expect(outcome).toMatchObject({ result: { status: "completed", structuredContent: { receiptId: RECEIPT_ID } } });
    expect(JSON.stringify(settledData()?.progressPayload ?? {})).not.toContain("No receipt was created");
  });

  it("keeps a refused native writer not-complete (the ...9B1B37904AC1 shape)", async () => {
    db.executions.push(nativeRead(), nativeWriterRefused());
    db.item = { ...(db.item as Record<string, unknown>), activities: [] };
    autonomous.execute.mockResolvedValue(liveCliLoopResult());

    const outcome = await run();

    expect(outcome).toMatchObject({ result: { status: "input-required" } });
    expect(settledData()?.status).toBe("input-required");
    expect(settledData()?.progressPayload).not.toHaveProperty("reviewOutcome");
  });

  it("labels a refused native writer as a writer refusal, not prose noncompliance, and carries its error to the summary", async () => {
    db.executions.push(nativeRead(), nativeWriterRefused());
    db.item = { ...(db.item as Record<string, unknown>), activities: [] };
    autonomous.execute.mockResolvedValue(liveCliLoopResult());

    await run();

    const progress = settledData()!.progressPayload as { summary: string; executedToolCount: number;
      terminalWriterWait: Record<string, unknown> };
    expect(progress.terminalWriterWait).not.toHaveProperty("noncompliance");
    expect(progress.terminalWriterWait).toMatchObject({ writerRejection: { error: "CANONICAL_DESIGN_REQUIRED" } });
    expect(progress.summary).toContain("AC-CHAR has a malformed objective link.");
    expect(progress.summary).not.toContain("did not honor the required writer tool-call contract");
    expect(progress.executedToolCount).toBe(2);
  });
});
