import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  items: [
    { id: "subject-row", itemId: "BI-285EF102", organizationId: "fixture-org" },
    { id: "other-row", itemId: "BI-OTHER", organizationId: "fixture-org" },
  ],
  locks: [] as string[], create: vi.fn(), transaction: vi.fn(), query: vi.fn(), findMany: vi.fn(),
  execute: vi.fn(), enqueue: vi.fn(), resolveOAuth: vi.fn(), currentOAuth: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  $transaction: h.transaction, $queryRaw: h.query,
  backlogItem: {
    findUnique: async (query: { where: Record<string, unknown> }) => h.items.find(row => matches(row, query.where)) ?? null,
    findMany: async (query: { where: Record<string, unknown> }) => h.items.filter(row => matches(row, query.where)),
  },
  taskRun: {
    findFirst: async (query: { where: Record<string, unknown> }) => h.rows.find(row => matches(row, query.where)) ?? null,
    findUnique: async (query: { where: Record<string, unknown> }) => h.rows.find(row => matches(row, query.where)) ?? null,
    findMany: h.findMany, create: h.create,
  },
  workroom: { findMany: async (query: { where: Record<string, unknown>; orderBy: unknown; take: number }) => {
    if (!same(query.orderBy, { id: "asc" }) || query.take !== 101
      || !h.items.some(item => same(query.where, { backlogItemId: { in: [item.id, item.itemId] } }))) {
      throw new Error(`Unsupported Workroom query: ${JSON.stringify(query)}`);
    }
    return [];
  } },
  mcpApiToken: { findUnique: async () => ({ userId: "requesting-human", authorityBindingId: "current-binding", oauthFamilyKey: "current-family" }) },
  agentThread: { upsert: async () => ({ id: "fixture-thread" }) },
} }));
vi.mock("@/lib/auth/oauth-tokens", () => ({
  resolveOAuthAccessToken: h.resolveOAuth, isCurrentOAuthExecutionAuthority: h.currentOAuth, OAUTH_EXECUTION_AUTHORITY_SELECT: {},
}));
vi.mock("@/lib/auth/mcp-api-token", () => ({ resolveMcpApiToken: vi.fn() }));
vi.mock("@/lib/mcp/session-token", () => ({ verifyMcpSessionToken: vi.fn() }));
vi.mock("@/lib/auth/workroom-session-token", () => ({ resolveWorkroomSessionToken: vi.fn(), workroomBindingRefusal: vi.fn() }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [], resolveAnnotations: vi.fn() }));
vi.mock("@/lib/mcp/toolchain-floor", () => ({ refuseBelowToolchainFloor: async () => null }));
vi.mock("@/lib/agent-toolchain/connection-observation", () => ({ observeConnection: vi.fn() }));
vi.mock("@/lib/govern/current-user-context", () => ({
  currentUserContext: async () => ({ userId: "requesting-human", isSuperuser: true, platformRole: null }),
}));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));
vi.mock("@/lib/golden-triangle/coworker-review", () => ({ resolveCoworkerReviewPattern: vi.fn() }));
vi.mock("@/lib/tak/coworker-inline-review", () => ({ reviewCoworkerDraft: vi.fn() }));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("@/lib/mcp-task-execution", () => ({ executeRemoteTaskAttempt: h.execute }));
vi.mock("@/lib/mcp-task-background-dispatch", () => ({
  externalMcpTaskAsyncEnabled: () => false, enqueuePersistedRemoteTaskSubmission: h.enqueue, initialRemoteTaskDispatchProjection: vi.fn(),
}));
vi.mock("@/lib/mcp-task-objective-mapping-admission", () => ({
  prepareRemoteObjectiveMappingAdmission: async () => ({ ok: true, data: { admission: null } }),
  remoteObjectiveMappingAdmissionErrorResult: () => null, revalidateRemoteObjectiveMappingReplay: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { POST } from "./route";
import { parseRemoteTaskSubmitParams } from "@/lib/mcp-task-submit-params";
import { remoteTaskRequestDigest } from "@/lib/mcp-task-capacity-contract";
import type { InitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import type { PresentReassessmentRelation } from "@/lib/mcp-task-reassessment-policy";

// Keep the POST -> real submit -> real create -> real subject guard path intact.
// Only credential resolution, stored records and execution/effect seams are fake.
const binding = {
  itemId: "BI-285EF102", gate: "design-spec", writerToolName: "record_initiative_design_review", expectedCurrentBaselineId: null,
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "fixture/repo", path: "docs/design.md",
    commitSha: "a".repeat(40), providerBlobId: "b".repeat(40) },
  workroomRef: { kind: "workroom-head", workroomId: "WC-FIXTURE", repositoryFullName: "fixture/repo",
    branchName: "codex/fixture", headSha: "a".repeat(40) },
} satisfies InitiativeReviewBinding;
const relation: PresentReassessmentRelation = {
  schemaVersion: 1, authorizationItemId: "BI-7906C73E", baselineId: "baseline-fixture", policyDigest: "c".repeat(64),
  originalTaskRunId: "TR-original", originalRequestDigest: "d".repeat(64), predecessorTaskRunIds: ["TR-original"], authorityArtifact: binding.artifactRef,
};
function packet(review: InitiativeReviewBinding = binding, key = "fresh-arbitrary-key") {
  const parsed = parseRemoteTaskSubmitParams({ agentId: "AGT-WS-REVIEW", routeContext: "/build", title: "Review fixture",
    objective: "Review the complete immutable artifact", prompt: "Review the complete immutable artifact", idempotencyKey: key,
    riskClass: "bounded-write", authorityScope: [`backlog-item:${review.itemId}`, `tool:${review.writerToolName}`, "tool:read_source_at_version"],
    initiativeReviewBinding: review });
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
}
function accepted(review: InitiativeReviewBinding = binding, progressPayload: unknown = {}, status = "working") {
  const parsed = packet(review, "historical-accepted-key"), requestDigest = remoteTaskRequestDigest(parsed);
  return {
    id: "historical-row", taskRunId: "TR-historical", parentTaskRunId: null, userId: "different-human", currentAgentId: parsed.agentId,
    status, routeContext: parsed.routeContext, title: parsed.title, objective: parsed.objective, authorityScope: parsed.authorityScope,
    progressPayload, updatedAt: new Date("2026-10-20T12:00:00Z"),
    a2aMetadata: { trigger: "external-mcp", requestDigestVersion: 2, requestDigest, requestedAgentId: parsed.agentId,
      idempotencyKey: parsed.idempotencyKey, requestObjective: parsed.objective, riskClass: parsed.riskClass,
      requestedThreadId: null, initiativeReviewBinding: parsed.initiativeReviewBinding, taskAuthorityKey: "oauth-family:old-family" },
    messages: [{ parts: [{ type: "message", text: parsed.prompt }] }],
  };
}
function same(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, filter]) => {
    if (key === "OR") return (filter as Record<string, unknown>[]).some(clause => matches(row, clause));
    if (key === "AND") return (Array.isArray(filter) ? filter : [filter]).every(clause => matches(row, clause as Record<string, unknown>));
    if (key === "workrooms") {
      if (!same(filter, { some: { backlogItemId: { in: ["subject-row", "BI-285EF102"] } } })
        && !same(filter, { some: { backlogItemId: { in: ["other-row", "BI-OTHER"] } } })) {
        throw new Error(`Unsupported workrooms predicate: ${JSON.stringify(filter)}`);
      }
      return false;
    }
    if (filter !== null && typeof filter === "object" && !Array.isArray(filter)) {
      const rule = filter as Record<string, unknown>;
      if (Array.isArray(rule.path)) {
        const value = rule.path.reduce<unknown>((current, field) => current !== null && typeof current === "object"
          ? (current as Record<string, unknown>)[String(field)] : undefined, row[key]);
        const names = Object.keys(rule).sort();
        if (same(names, ["equals", "path"])) return same(value, rule.equals);
        if (same(names, ["array_contains", "path"]) && Array.isArray(rule.array_contains)) {
          return Array.isArray(value) && rule.array_contains.every(entry => value.includes(entry));
        }
      }
      if (Object.keys(rule).length === 1 && Array.isArray(rule.in)) return rule.in.includes(row[key]);
      if (Object.keys(rule).length === 1 && Array.isArray(rule.array_contains)) {
        return Array.isArray(row[key]) && rule.array_contains.every(entry => (row[key] as unknown[]).includes(entry));
      }
      throw new Error(`Unsupported stored predicate: ${key} ${JSON.stringify(filter)}`);
    }
    return same(row[key], filter);
  });
}
async function submit(params: Record<string, unknown> = packet()) {
  const response = await POST(new Request("http://localhost:3000/api/mcp/v1", {
    method: "POST", headers: { Authorization: "Bearer fixture-current-oauth", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 71, method: "tasks/submit", params }),
  }));
  return { response, body: await response.json() };
}
function noStart(before: number) {
  expect(h.rows).toHaveLength(before); expect(h.create).not.toHaveBeenCalled();
  expect(h.execute).not.toHaveBeenCalled(); expect(h.enqueue).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks(); h.rows.length = 0; h.locks.length = 0;
  h.resolveOAuth.mockResolvedValue({ resolved: { tokenId: "current-token", userId: "requesting-human", agentId: "AGT-AUTHOR",
    scopes: ["backlog_read", "initiative_evidence_write"], capability: "write", scope: "write" }, publicScopes: ["dpf:write"], identitySetupRequired: false });
  h.currentOAuth.mockResolvedValue(true);
  h.query.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join("?");
    if (/^SELECT "id" FROM "BacklogItem" WHERE "itemId" = \? FOR UPDATE$/.test(sql)) {
      const row = h.items.find(item => item.itemId === values[0]); h.locks.push(`item:${row?.id}`); return row ? [{ id: row.id }] : [];
    }
    if (/^SELECT "id" FROM "BacklogItem" WHERE "id" = \? FOR UPDATE$/.test(sql)) {
      const row = h.items.find(item => item.id === values[0]); h.locks.push(`item:${row?.id}`); return row ? [{ id: row.id }] : [];
    }
    if (/^SELECT "id" FROM "TaskRun" WHERE "id" = \? FOR UPDATE$/.test(sql)) {
      const row = h.rows.find(task => task.id === values[0]); h.locks.push(`task:${row?.id}`); return row ? [{ id: row.id }] : [];
    }
    throw new Error(`Unsupported SQL in route fixture: ${sql}`);
  });
  h.findMany.mockImplementation(async (query: { where: Record<string, unknown>; orderBy: unknown; take: number; cursor?: { id: string }; skip?: number }) => {
    if (!same(query.orderBy, { id: "asc" }) || !Number.isSafeInteger(query.take)) throw new Error("Unsupported lineage pagination");
    const rows = h.rows.filter(row => matches(row, query.where)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const start = query.cursor ? rows.findIndex(row => row.id === query.cursor!.id) + (query.skip ?? 0) : 0;
    return rows.slice(start, start + query.take);
  });
  h.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: "new-row", ...data }; h.rows.push(row);
    return { id: row.id, taskRunId: data.taskRunId, contextId: data.contextId };
  });
  h.transaction.mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => {
    const before = [...h.rows];
    try { return await callback(prisma); }
    catch (error) { h.rows.splice(0, h.rows.length, ...before); throw error; }
  });
  h.execute.mockImplementation(async ({ run }: { run: { taskRunId: string } }) => ({ kind: "result", result: {
    taskRunId: run.taskRunId, status: "completed", isError: false, content: [{ type: "text", text: "Synthetic execution seam" }],
  } }));
});

describe("POST tasks/submit exact review creation containment", () => {
  it.each(["working", "submitted", "input-required", "auth-required", "failed", "canceled", "completed", "rejected", "archived"])(
    "refuses a fresh ordinary key after a cross-user present allocation in %s", async status => {
      h.rows.push(accepted({ ...binding, presentReassessment: relation }, {}, status));
      const { body } = await submit(); noStart(1);
      expect(JSON.stringify(body)).toMatch(/reassessment-/);
      expect(h.currentOAuth).toHaveBeenCalled();
      expect(h.resolveOAuth).toHaveBeenCalledWith("fixture-current-oauth", expect.any(String));
    },
  );
  it.each([null, {}, { kind: "present-reassessment-quarantine", replayAllowed: false }])(
    "refuses every exact-subject quarantine marker, including %j", async marker => {
      h.rows.push(accepted(binding, { reassessmentQuarantine: marker }, "completed"));
      const { body } = await submit(); noStart(1);
      expect(JSON.stringify(body)).toMatch(/reassessment-/);
    },
  );
  it.each([
    { executionUncertainty: { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown" } },
    { executionUncertainty: { settlement: "unknown" } },
    { terminalWriterWait: { writerToolName: "record_initiative_design_review", attempt: 1 } },
  ])("refuses UNKNOWN history before any present allocation: %j", async progress => {
    h.rows.push(accepted(binding, progress, "completed"));
    const { body } = await submit(); noStart(1);
    expect(JSON.stringify(body)).toMatch(/reassessment-/);
  });
  it.each(["submitted", "working", "input-required", "auth-required"])(
    "preserves the original recovery owner for an ordinary matching %s task", async status => {
      const progress = { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer", resumeMode: "same-taskrun",
        writerToolName: binding.writerToolName, attempt: 1, observedAt: "2026-10-20T11:59:00Z", dispatchContract: "required-tool-call" } };
      h.rows.push(accepted(binding, progress, status));
      const { body } = await submit(); noStart(1);
      expect(JSON.stringify(body)).toMatch(/reassessment-/);
    },
  );
  it("refuses linked review history whose accepted request cannot be reconstructed", async () => {
    const row = accepted(binding, { reassessmentQuarantine: {} }, "completed"); row.messages = [];
    h.rows.push(row); const { body } = await submit(); noStart(1);
    expect(JSON.stringify(body)).toMatch(/reassessment-lineage-unproven/);
  });
  it.each([
    { ...binding, gate: "spec-approval" },
    { ...binding, artifactRef: { ...binding.artifactRef, commitSha: "e".repeat(40) } },
    { ...binding, artifactRef: { ...binding.artifactRef, providerBlobId: "e".repeat(40) } },
    { ...binding, artifactRef: { ...binding.artifactRef, path: "docs/another.md" } },
    { ...binding, artifactRef: { ...binding.artifactRef, repositoryFullName: "fixture/another" },
      workroomRef: { ...binding.workroomRef!, repositoryFullName: "fixture/another" } },
    { ...binding, itemId: "BI-OTHER" },
    { ...binding, gate: "plan-review", writerToolName: "record_initiative_plan_review" },
  ])("permits an unrelated bound review: %j", async unrelated => {
    h.rows.push(accepted({ ...binding, presentReassessment: relation }));
    const { body } = await submit(packet(unrelated));
    expect(body.result?.isError).toBe(false);
    expect(h.create).toHaveBeenCalledOnce(); expect(h.execute).toHaveBeenCalledOnce();
  });
  it("permits a matching terminal ordinary review with no hold or uncertainty", async () => {
    h.rows.push(accepted(binding, {}, "completed"));
    const { body } = await submit();
    expect(body.result?.isError).toBe(false);
    expect(h.create).toHaveBeenCalledOnce(); expect(h.execute).toHaveBeenCalledOnce();
    expect(h.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "ReadCommitted" });
  });
  it("refuses an unbound initiative review writer scope before allocation", async () => {
    const { initiativeReviewBinding: _binding, ...unboundReview } = packet();
    const { body } = await submit(unboundReview); noStart(0);
    expect(JSON.stringify(body)).toMatch(/initiativeReviewBinding|immutable.*binding|review.*binding/i);
  });
  it.each([{ authorityScope: undefined }, { authorityScope: ["tool:read_source_at_version"] }, { authorityScope: ["tool:list_backlog_items"] }])(
    "permits ordinary unbound work with default, read or nonreview scope: %j", async ({ authorityScope }) => {
      const { initiativeReviewBinding: _binding, ...ordinary } = packet(); ordinary.authorityScope = authorityScope;
      const { body } = await submit(ordinary);
      expect(body.result?.isError).toBe(false);
      expect(h.create).toHaveBeenCalledOnce(); expect(h.execute).toHaveBeenCalledOnce();
      expect(h.create.mock.calls[0]?.[0].data.authorityScope).toEqual(authorityScope ?? []);
      expect(h.findMany).not.toHaveBeenCalled();
    },
  );
  it("permits ordinary unbound work without looking up review membership", async () => {
    const { initiativeReviewBinding: _binding, ...ordinary } = packet(); ordinary.authorityScope = [];
    const { body } = await submit(ordinary);
    expect(body.result?.isError).toBe(false);
    expect(h.create).toHaveBeenCalledOnce(); expect(h.execute).toHaveBeenCalledOnce();
    expect(h.findMany).not.toHaveBeenCalled();
  });
});
