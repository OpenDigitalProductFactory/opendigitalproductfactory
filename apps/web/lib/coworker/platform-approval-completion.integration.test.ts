// BI-0B70FA79: actual loop -> governor -> audit -> platform runner -> governor.
// Only inference, persistence/current authority snapshots and the final effect
// are substituted. No mocked governedExecuteTool or fabricated resume marker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  tool: { name: "fixture_report", description: "Record a fixture report", inputSchema: { type: "object", properties: { summary: { type: "string" } } },
    requiredCapability: null, executionMode: "immediate" as const, sideEffect: true },
  task: vi.fn(), user: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn(async () => null) },
  user: { findUnique: fixture.user }, taskRun: { findUnique: fixture.task, updateMany: vi.fn(async () => ({ count: 1 })) },
  coworkerTurnMetric: { upsert: vi.fn() }, platformIssueReport: { create: vi.fn() },
} }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [fixture.tool], executeTool: vi.fn() }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/work-management/room-stage-mandate", () => ({ loadScheduledRoomMandateLive: vi.fn(async () => []) }));

import { routeAndCall } from "@/lib/routed-inference";
import { runAgenticLoop } from "@/lib/tak/agentic-loop";
import { _setGovernanceForTests } from "@/lib/mcp-governed-execute";
import type { CoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";
import { coworkerAuthorityInputFixture } from "../../test-support/coworker-authority-input-fixture";
import { runApprovedPlatformRequest } from "./approved-request-run";

type Row = Record<string, unknown>;
type Envelope = {
  id: string; status: string; taskRunId: string | null; expiresAt: Date; threadId: string;
  delegatingUserId: string; coworkerAgentId: string; manifestActionId: string;
  argsJson: { approvalBinding: CoworkerApprovalBinding }; resolvedAt: Date | null;
};
let envelope: Envelope | null;
let audits: Row[];
let grantAllowed: boolean;
let currentUserAllowed: boolean;
let authorityAvailable: boolean;
let currentRoomAllowed: boolean;
type Execute = NonNullable<Parameters<typeof _setGovernanceForTests>[0]["executeTool"]>;
let effects: ReturnType<typeof vi.fn<Execute>>;
const PARAMS = { summary: "Fixture observation only" };

function inference() {
  return { content: "The report already completed.", providerId: "fixture", modelId: "fixture", downgraded: false,
    downgradeMessage: null, downgradeReason: null, toolsStripped: false, truncated: false, inputTokens: 10, outputTokens: 5,
    toolCalls: [{ id: "report-call", name: fixture.tool.name, arguments: PARAMS }], routeDecision: {} };
}

function setup() {
  envelope = null; audits = []; grantAllowed = true; currentUserAllowed = true; authorityAvailable = true; currentRoomAllowed = true;
  effects = vi.fn<Execute>(async () => ({ success: true, message: "Fixture report recorded.", entityId: "REPORT-FIXTURE" }));
  fixture.user.mockImplementation(async () => ({ isSuperuser: currentUserAllowed, groups: [] }));
  fixture.task.mockResolvedValue({ a2aMetadata: {}, progressPayload: {}, status: "working", userId: "user-1", currentAgentId: "AGT-100" });
  vi.mocked(routeAndCall).mockResolvedValue(inference() as never);
  _setGovernanceForTests({
    resolveAgentGrants: async () => ["fixture-write"], isAllowedByGrants: () => grantAllowed,
    executeTool: effects,
    toolExecutionCreate: async (data) => { const row = { ...data, id: `audit-${audits.length}` }; audits.push(row); return { id: row.id }; },
    authorizationDecisionCreate: async () => ({}),
    resolveCoworkerAuthorityInput: async ({ execution, tool, agentGrantAllowed }) => {
      if (!authorityAvailable) throw new Error("Current authority snapshot unavailable");
      const input = coworkerAuthorityInputFixture();
      return { ...input,
        authContext: { ...input.authContext, isSuperuser: currentUserAllowed, grantedCapabilities: currentUserAllowed ? ["manage_backlog"] : [] },
        action: { ...input.action, toolName: tool.name, sideEffect: true, requiredCapability: "manage_backlog", agentGrantAllowed,
          roomAuthorityAllowed: currentRoomAllowed, approvalPolicy: "all", routeContext: execution.context?.routeContext ?? null },
        task: execution.context?.taskRunId ? { taskRunId: execution.context.taskRunId } : null,
        rawParams: execution.rawParams,
        ...(envelope?.status === "approved" ? { approval: { envelopeId: envelope.id, status: "approved" as const,
          expiresAt: envelope.expiresAt, binding: envelope.argsJson.approvalBinding } } : {}),
      };
    },
    authorityApprovalEnvelopeCreate: async ({ binding, threadId }) => {
      envelope = { id: "ENV-FIXTURE", status: "proposed", taskRunId: binding.taskRunId, expiresAt: new Date(Date.now() + 60_000),
        threadId: threadId ?? "thread-1", delegatingUserId: binding.actingHumanUserId, coworkerAgentId: binding.actingAgentId,
        manifestActionId: binding.toolName, argsJson: { approvalBinding: binding }, resolvedAt: null };
      return envelope;
    },
    policyAuthorityProjectionAttempt: async () => ({ outcome: "not-authorized" }),
    policyAuthorityEnvelopeReserve: async (_id, reservedAt) => {
      if (!envelope || envelope.status !== "approved" || envelope.resolvedAt !== null) return false;
      envelope.resolvedAt = reservedAt; return true;
    },
    authorityApprovalEnvelopeFinalize: async (_id, success) => { envelope!.status = success ? "executed" : "failed"; },
    authorityApprovalReservationRelease: async () => { envelope!.resolvedAt = null; },
    authorityApprovalTaskResume: async () => undefined,
    authorityExecutedOutcome: async () => {
      if (!envelope || (envelope.status !== "executed" && envelope.status !== "failed")) return null;
      return { envelopeId: envelope.id, status: envelope.status, result: audits.at(-1)?.result };
    },
  });
}

function parkedRow() { return audits.find(row => row.success === false && (row.result as Row)?.error === "approval_required"); }
const messages: Row[] = [];
function complete() {
  return runApprovedPlatformRequest("ENV-FIXTURE", { db: {
    coworkerActionEnvelope: { findUnique: async () => envelope },
    toolExecution: { findFirst: async (args: unknown) => {
      const where = (args as { where: Row }).where;
      return "apiTokenId" in where ? parkedRow() ?? null : audits.at(-1) ?? null;
    } },
    agentMessage: { create: async (data: unknown) => { messages.push(data as Row); return {}; } },
  } as never,
    resolveRoom: async () => ({ roomAuthority: currentRoomAllowed ? { workroomId: "WC-FIXTURE" } as never : null, externalAccessEnabled: false }),
    resolveStandingAccess: async () => false,
  });
}

async function produce(mode: "chat" | "autonomous", extra: Row = {}) {
  return runAgenticLoop({ chatHistory: [{ role: "user", content: "Record the fixture observation" }], systemPrompt: "Fixture coworker",
    sensitivity: "internal", tools: [fixture.tool],
    toolsForProvider: [{ type: "function", function: { name: fixture.tool.name, description: "Fixture", parameters: fixture.tool.inputSchema } }],
    userId: "user-1", agentId: "AGT-100", threadId: "thread-1", routeContext: "/platform/ai", interactionMode: mode,
    ...(mode === "autonomous" ? { taskRunId: "TR-FIXTURE" } : {}), ...extra,
  });
}

beforeEach(() => { vi.clearAllMocks(); messages.length = 0; setup(); });
afterEach(() => _setGovernanceForTests({ resolveAgentGrants: null, isAllowedByGrants: null, executeTool: null,
  toolExecutionCreate: null, authorizationDecisionCreate: null, resolveCoworkerAuthorityInput: null,
  authorityApprovalEnvelopeCreate: null, policyAuthorityProjectionAttempt: null, policyAuthorityEnvelopeReserve: null,
  authorityApprovalEnvelopeFinalize: null, authorityApprovalReservationRelease: null,
  authorityApprovalTaskResume: null, authorityExecutedOutcome: null }));

describe("ordinary platform approval completion bridge", () => {
  it.each(["chat", "autonomous"] as const)("%s produces its real marker and records one governed effect plus terminal settlement", async mode => {
    const result = await produce(mode);
    expect(result.pendingApproval).toEqual({ envelopeIds: ["ENV-FIXTURE"] });
    expect(result.content).not.toContain("already completed");
    expect(effects).not.toHaveBeenCalled();
    expect(parkedRow()).toMatchObject({ envelopeId: "ENV-FIXTURE", apiTokenId: null,
      parameters: { ...PARAMS, _approvalResume: { v: 1, source: "agentic-loop", proposeBoundary: false } } });
    expect(envelope!.status).toBe("proposed");
    envelope!.status = "approved"; // Exact owner decision boundary, no payload mutation.
    expect(await complete()).toMatchObject({ status: "executed", entityId: "REPORT-FIXTURE" });
    expect(effects).toHaveBeenCalledOnce();
    expect(effects).toHaveBeenCalledWith(fixture.tool.name, PARAMS, "user-1", expect.objectContaining({ agentId: "AGT-100", approvedAuthorityEnvelopeId: "ENV-FIXTURE" }));
    expect(envelope!.status).toBe("executed");
    expect(audits.at(-1)).toMatchObject({ envelopeId: "ENV-FIXTURE", success: true, result: { entityId: "REPORT-FIXTURE" } });
    expect(await complete()).toMatchObject({ status: "settled", outcome: "executed", entityId: "REPORT-FIXTURE" });
    expect(effects).toHaveBeenCalledOnce();
    expect(messages).toHaveLength(1);
  });
  it.each(["revoked-grant", "revoked-user", "revoked-room", "authority-unavailable", "expired", "tampered"] as const)("%s cannot turn approval into a new effect", async reason => {
    await produce("autonomous"); envelope!.status = "approved";
    if (reason === "revoked-grant") grantAllowed = false;
    if (reason === "revoked-user") currentUserAllowed = false;
    if (reason === "revoked-room") currentRoomAllowed = false;
    if (reason === "authority-unavailable") authorityAvailable = false;
    if (reason === "expired") envelope!.expiresAt = new Date(Date.now() - 1);
    if (reason === "tampered") (parkedRow()!.parameters as Row).summary = "Different request";
    const outcome = await complete();
    expect(outcome?.status).toMatch(/failed|not-run/);
    expect(effects).not.toHaveBeenCalled();
  });
  it.each(["missing", "stale", "current"] as const)("a bound review checks its %s captured generation fence", async state => {
    const requestDigest = "9".repeat(64);
    const taskExecutionFence = { schemaVersion: 1, reservation: null, dispatchClaim: null, authorityDigest: null, requestDigest };
    await produce("autonomous", { taskExecutionFence }); envelope!.status = "approved";
    expect((parkedRow()!.parameters as Row)._taskExecutionFence).toEqual(taskExecutionFence);
    fixture.task.mockResolvedValue({ userId: "user-1", currentAgentId: "AGT-100", status: "working",
      a2aMetadata: { requestDigest, initiativeReviewBinding: { itemId: "BI-FIXTURE", gate: "research", writerToolName: "record_initiative_evidence",
        artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) } } },
      progressPayload: state === "stale" ? { resumeReservedAt: "later-generation" } : {},
    });
    if (state === "missing") delete (parkedRow()!.parameters as Row)._taskExecutionFence;
    if (state === "current") {
      expect(await complete()).toMatchObject({ status: "executed" });
      expect(effects).toHaveBeenCalledOnce();
      expect(effects.mock.calls[0]?.[3]).toMatchObject({ taskExecutionFence });
      return;
    }
    expect(await complete()).toMatchObject({ status: "failed" });
    expect(effects).not.toHaveBeenCalled();
    expect(audits.at(-1)?.result).toMatchObject({ error: "review_execution_authority_refused" });
    expect(envelope!.status).toBe("failed");
  });
  it("records a failed final effect and returns it on a second observation without executing again", async () => {
    await produce("chat"); envelope!.status = "approved";
    effects.mockResolvedValue({ success: false, message: "Fixture target refused.", error: "fixture_refusal" });
    expect(await complete()).toMatchObject({ status: "failed" });
    expect(envelope!.status).toBe("failed");
    expect(audits.at(-1)?.result).toMatchObject({ success: false, error: "fixture_refusal" });
    expect(await complete()).toMatchObject({ status: "settled", outcome: "failed" });
    expect(effects).toHaveBeenCalledOnce();
  });
  it("leaves an old unmarked row inert", async () => {
    await produce("chat"); envelope!.status = "approved";
    delete (parkedRow()!.parameters as Row)._approvalResume;
    expect(await complete()).toBeNull();
    expect(effects).not.toHaveBeenCalled();
  });
  it("settles a racing second completion through the existing atomic reservation", async () => {
    await produce("chat"); envelope!.status = "approved";
    await Promise.all([complete(), complete()]);
    expect(effects).toHaveBeenCalledOnce();
    expect(envelope!.status).toBe("executed");
  });
});
