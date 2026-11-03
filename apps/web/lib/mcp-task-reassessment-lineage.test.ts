import { describe, expect, it, vi } from "vitest";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { collectReassessmentLineage, lockReassessmentLineage, revalidateReassessmentLineage } from "./mcp-task-reassessment-lineage";
import type { Prisma } from "@dpf/db";
import { parseInitiativeReviewBinding, type InitiativeReviewBinding } from "./mcp-task-review-contract";

const binding: InitiativeReviewBinding = { itemId: "BI-285EF102", gate: "design-spec", writerToolName: "record_initiative_design_review",
  expectedCurrentBaselineId: null, artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", path: "design.md",
    commitSha: "a".repeat(40), providerBlobId: "b".repeat(40) } };
function request(taskRunId: string, userId = "owner", gate = "design-spec", artifactRef = binding.artifactRef) {
  const accepted = { agentId: `reviewer-${taskRunId}`, routeContext: "/build", title: "Review", objective: "Exact review", prompt: "Exact review",
    idempotencyKey: taskRunId, riskClass: "bounded-write" as const, authorityScope: [`backlog-item:${binding.itemId}`, "tool:record_initiative_design_review", "tool:read_source_at_version"],
    initiativeReviewBinding: parseInitiativeReviewBinding({ ...binding, gate, artifactRef })! };
  return { id: `row-${taskRunId}`, taskRunId, userId, currentAgentId: accepted.agentId, parentTaskRunId: null, status: "completed",
    title: accepted.title, objective: accepted.objective, routeContext: accepted.routeContext, authorityScope: accepted.authorityScope,
    a2aMetadata: { trigger: "external-mcp", requestedAgentId: accepted.agentId, idempotencyKey: accepted.idempotencyKey,
      riskClass: accepted.riskClass, requestObjective: accepted.objective, requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest(accepted),
      initiativeReviewBinding: accepted.initiativeReviewBinding }, progressPayload: {}, updatedAt: new Date(),
    messages: [{ parts: [{ type: "message", text: accepted.prompt }] }] };
}
function fixture() {
  const original = request("TR-original"), other = request("TR-other", "another-human"); other.status = "canceled";
  const rows = [original, other]; const locks: string[] = [];
  const tx = { backlogItem: { findUnique: vi.fn(async () => ({ id: "subject-row", itemId: binding.itemId, organizationId: "org" })),
    findMany: vi.fn(async () => [{ id: "subject-row", itemId: binding.itemId, organizationId: "org" }, { id: "auth-row", itemId: "BI-7906C73E", organizationId: "org" }]) },
  workroom: { findMany: vi.fn(async () => []) }, taskRun: { findMany: vi.fn(async (query: { where: Record<string, unknown>; cursor?: { id: string }; skip?: number; take: number }) => {
    const selected = rows.filter(row => matches(row as unknown as Record<string, unknown>, query.where)).sort((a, b) => a.id < b.id ? -1 : 1);
    const start = query.cursor ? selected.findIndex(row => row.id === query.cursor!.id) + (query.skip ?? 0) : 0;
    return selected.slice(start, start + query.take);
  }) },
  $queryRaw: vi.fn(async (parts: TemplateStringsArray, id: string) => { locks.push(`${parts.join("?")}:${id}`); return [{ id }]; }) };
  const input = { binding, organizationId: "org", originals: [{ taskRunId: original.taskRunId, requestDigest: original.a2aMetadata.requestDigest }] };
  return { tx: tx as unknown as Prisma.TransactionClient, mocks: tx, rows, input, locks };
}
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Record<string, unknown>[]).some(clause => matches(row, clause));
    const filter = value as Record<string, unknown>;
    if (key === "workrooms") return false;
    if (filter.path) {
      const current = (filter.path as string[]).reduce<unknown>((current, field) => current && typeof current === "object" ? (current as Record<string, unknown>)[field] : undefined, row[key]);
      if (Object.hasOwn(filter, "equals")) return JSON.stringify(current) === JSON.stringify(filter.equals);
      if (Array.isArray(filter.array_contains)) return Array.isArray(current) && filter.array_contains.every(entry => current.includes(entry));
      throw new Error("Unsupported JSON predicate");
    }
    if (Array.isArray(filter.in) && Object.keys(filter).length === 1) return filter.in.includes(row[key]);
    if (Array.isArray(filter.array_contains) && Object.keys(filter).length === 1) return Array.isArray(row[key]) && filter.array_contains.every(entry => (row[key] as unknown[]).includes(entry));
    throw new Error(`Unsupported fixture predicate: ${key}`);
  });
}
describe("authoritative bounded reassessment lineage", () => {
  it("includes accepted history across humans, reviewers and terminal states", async () => {
    const f = fixture(); const snapshot = await collectReassessmentLineage(f.tx, f.input);
    expect(snapshot.rows.map(row => row.taskRunId)).toEqual(["TR-original", "TR-other"]);
    expect(snapshot.rows.map(row => row.status)).toEqual(["completed", "canceled"]);
    for (const [query] of f.mocks.taskRun.findMany.mock.calls) {
      expect(query.where).not.toHaveProperty("userId"); expect(query.where).not.toHaveProperty("status");
      expect(query.where).not.toHaveProperty("a2aMetadata.taskAuthorityKey");
    }
  });
  it("locks every existing task before sorted subject and authorization items", async () => {
    const f = fixture(); const snapshot = await collectReassessmentLineage(f.tx, f.input);
    await lockReassessmentLineage(f.tx, snapshot, [binding.itemId, "BI-7906C73E"]);
    expect(f.locks).toHaveLength(4);
    expect(f.locks.slice(0, 2).every(value => value.includes('"TaskRun"'))).toBe(true);
    expect(f.locks.slice(2).every(value => value.includes('"BacklogItem"'))).toBe(true);
  });
  it("aborts changed membership without acquiring another existing task lock", async () => {
    const f = fixture(); const snapshot = await collectReassessmentLineage(f.tx, f.input);
    const locked = await lockReassessmentLineage(f.tx, snapshot, [binding.itemId, "BI-7906C73E"]);
    f.rows.push(request("TR-new")); const before = f.locks.length;
    await expect(revalidateReassessmentLineage(f.tx, locked)).rejects.toMatchObject({ code: "reassessment-lineage-restart" });
    expect(f.locks).toHaveLength(before);
  });
  it("pages all accepted rows instead of taking only the first page", async () => {
    const f = fixture(); for (let i = 0; i < 121; i++) f.rows.push(request(`TR-paged-${String(i).padStart(3, "0")}`));
    const snapshot = await collectReassessmentLineage(f.tx, f.input);
    expect(snapshot.rows).toHaveLength(123); expect(f.mocks.taskRun.findMany.mock.calls.some(([query]) => !!query.cursor)).toBe(true);
  });
  it.each(["missing-original", "changed-original-digest", "missing-message", "malformed-binding", "future-binding", "unknown-linked-review", "overflow"])("refuses %s without assuming exclusion", async condition => {
    const f = fixture();
    if (condition === "missing-original") f.rows.shift();
    if (condition === "changed-original-digest") f.input.originals[0]!.requestDigest = "f".repeat(64);
    if (condition === "missing-message") f.rows[1]!.messages = [];
    if (condition === "malformed-binding") Object.assign(f.rows[1]!.a2aMetadata.initiativeReviewBinding, { artifactRef: { kind: "unsupported" } });
    if (condition === "future-binding") Object.assign(f.rows[1]!.a2aMetadata.initiativeReviewBinding, { schemaVersion: 99 });
    if (condition === "unknown-linked-review") Object.assign(f.rows[1]!.a2aMetadata, { initiativeReviewBinding: null });
    if (condition === "overflow") for (let i = 0; i < 501; i++) f.rows.push(request(`TR-overflow-${String(i).padStart(3, "0")}`));
    await expect(collectReassessmentLineage(f.tx, f.input)).rejects.toMatchObject({ code: "reassessment-lineage-unproven" });
    expect(f.locks).toHaveLength(0);
  });
  it("includes an explicitly related predecessor even when its artifact key differs", async () => {
    const f = fixture(); const predecessor = request("TR-predecessor", "owner", "design-spec", { ...binding.artifactRef, commitSha: "c".repeat(40) } as typeof binding.artifactRef);
    // The generic parent relation is stored outside the immutable request.
    predecessor.parentTaskRunId = f.rows[0]!.taskRunId as never;
    f.rows.push(predecessor);
    const snapshot = await collectReassessmentLineage(f.tx, f.input);
    expect(snapshot.rows.map(row => row.taskRunId)).toContain(predecessor.taskRunId);
  });
  it("includes both original policy gates and their independently accepted current candidates", async () => {
    const f = fixture(), second = request("TR-second-original", "owner", "spec-approval"), candidate = request("TR-second-candidate", "other", "spec-approval");
    f.rows.push(second, candidate); f.input.originals.push({ taskRunId: second.taskRunId, requestDigest: second.a2aMetadata.requestDigest });
    const snapshot = await collectReassessmentLineage(f.tx, f.input); expect(snapshot.rows).toHaveLength(4);
  });
  it("excludes a proven ordinary external null sentinel while retaining unknown legacy refusal", async () => {
    const f = fixture(), row = request("TR-ordinary");
    const scope = [`backlog-item:${binding.itemId}`, "tool:list_backlog_items"];
    Object.assign(row, { authorityScope: scope }); Object.assign(row.a2aMetadata, { initiativeReviewBinding: null });
    const ordinary = parseRemoteTaskSubmitParams({ agentId: row.currentAgentId, routeContext: row.routeContext, title: row.title, objective: row.objective,
      prompt: row.objective, idempotencyKey: row.taskRunId, riskClass: "bounded-write", authorityScope: scope });
    if (typeof ordinary === "string") throw new Error(ordinary);
    row.a2aMetadata.requestDigest = remoteTaskRequestDigest(ordinary); f.rows.push(row);
    expect((await collectReassessmentLineage(f.tx, f.input)).rows).toHaveLength(2);
    row.a2aMetadata.requestDigest = "f".repeat(64);
    await expect(collectReassessmentLineage(f.tx, f.input)).rejects.toMatchObject({ code: "reassessment-lineage-unproven" });
  });
});
