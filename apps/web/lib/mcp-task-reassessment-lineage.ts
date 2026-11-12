import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { Prisma } from "@dpf/db";
import { parseInitiativeReviewBinding, type InitiativeReviewBinding } from "./mcp-task-review-contract";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { remoteTaskRequestMatches } from "./mcp-task-capacity-contract";

export type ReassessmentLineageInput = { binding: InitiativeReviewBinding; organizationId: string | null;
  originals: readonly { taskRunId: string; requestDigest: string }[] };
export type ReassessmentLineageRow = { id: string; taskRunId: string; userId: string; currentAgentId: string | null;
  parentTaskRunId: string | null; status: string; requestDigest: string; binding: InitiativeReviewBinding;
  authorityScope: unknown; a2aMetadata: unknown; progressPayload: unknown; updatedAt: string };
export type ReassessmentLineageSnapshot = { input: ReassessmentLineageInput; subjectRowId: string; rows: ReassessmentLineageRow[]; fingerprint: string };
export type LockedReassessmentLineage = { snapshot: ReassessmentLineageSnapshot; itemRowIds: readonly string[] };
export class ReassessmentLineageError extends Error {
  constructor(readonly code: "reassessment-lineage-unproven" | "reassessment-lineage-restart") { super(code); this.name = "ReassessmentLineageError"; }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const equal = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const fail = (): never => { throw new ReassessmentLineageError("reassessment-lineage-unproven"); };
const PAGE = 50, MAX_TASKS = 500, MAX_ROOMS = 100;
const selection = { id: true, taskRunId: true, userId: true, currentAgentId: true, parentTaskRunId: true, status: true,
  authorityScope: true, a2aMetadata: true, progressPayload: true, updatedAt: true, routeContext: true, title: true, objective: true,
  messages: { where: { role: "user" }, orderBy: { createdAt: "asc" as const }, take: 1, select: { parts: true } } };
type Candidate = Prisma.TaskRunGetPayload<{ select: typeof selection }>;

async function tasks(tx: Prisma.TransactionClient, where: Prisma.TaskRunWhereInput): Promise<Candidate[]> {
  const rows: Candidate[] = []; let cursor: string | undefined;
  for (;;) {
    const page = await tx.taskRun.findMany({ where, select: selection, orderBy: { id: "asc" }, take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (page.length > PAGE || rows.length + page.length > MAX_TASKS || page.some(row => rows.some(prior => prior.id === row.id))) fail();
    rows.push(...page); if (page.length < PAGE) return rows;
    const next = page.at(-1)?.id; if (!next || next === cursor) fail(); cursor = next;
  }
}

/** Decode historical acceptance without consulting a token's present authority.
 * An inactive old user or credential never removes an accepted allocation. */
function accepted(row: Candidate, required: boolean): ReassessmentLineageRow | null {
  const metadata = object(row.a2aMetadata) ? row.a2aMetadata : null;
  const raw = metadata?.initiativeReviewBinding;
  if (raw === null || raw === undefined) {
    const reviewScope = Array.isArray(row.authorityScope) && row.authorityScope.some(scope => typeof scope === "string"
      && scope.startsWith("tool:record_initiative_"));
    if (required || reviewScope) return fail();
    if (metadata && ["interactive", "scheduled", "build", "deliberation", "radar", "system-recovery", "capacity-continuity"].includes(String(metadata.trigger))) return null;
    // An external null sentinel is ordinary only when its complete accepted
    // unbound request can be reconstructed. Unknown legacy rows are not zero.
  }
  const binding = raw === null || raw === undefined ? undefined : parseInitiativeReviewBinding(raw);
  if (!metadata || binding === null || binding && !equal(binding, raw) || metadata.trigger !== "external-mcp"
    || typeof metadata.requestDigest !== "string" || !/^[a-f0-9]{64}$/.test(metadata.requestDigest)
    || !Array.isArray(row.authorityScope) || row.authorityScope.some(scope => typeof scope !== "string")) return fail();
  const first = row.messages[0]?.parts;
  const prompt = Array.isArray(first) ? first.find(part => object(part) && typeof part.text === "string") : null;
  const parsed = parseRemoteTaskSubmitParams({ agentId: metadata.requestedAgentId ?? row.currentAgentId, routeContext: row.routeContext,
    title: row.title, objective: Object.hasOwn(metadata, "requestObjective") ? metadata.requestObjective : row.objective,
    prompt: object(prompt) ? prompt.text : undefined, idempotencyKey: metadata.idempotencyKey, riskClass: metadata.riskClass,
    threadId: metadata.requestedThreadId ?? null, authorityScope: row.authorityScope, ...(binding ? { initiativeReviewBinding: binding } : {}),
    ...(metadata.collaborationKind ? { collaborationKind: metadata.collaborationKind } : {}) });
  if (typeof parsed === "string" || !remoteTaskRequestMatches(metadata, parsed)) return fail();
  if (!binding) return null;
  return { id: row.id, taskRunId: row.taskRunId, userId: row.userId, currentAgentId: row.currentAgentId,
    parentTaskRunId: row.parentTaskRunId, status: row.status, requestDigest: metadata.requestDigest, binding,
    authorityScope: row.authorityScope, a2aMetadata: row.a2aMetadata, progressPayload: row.progressPayload, updatedAt: row.updatedAt.toISOString() };
}
const key = (binding: InitiativeReviewBinding) => hash({ gate: binding.gate, artifactRef: binding.artifactRef });
function references(row: ReassessmentLineageRow): string[] {
  const relation = row.binding.presentReassessment;
  return [...new Set([...(row.parentTaskRunId ? [row.parentTaskRunId] : []), ...(relation ? [relation.originalTaskRunId, ...relation.predecessorTaskRunIds] : [])])];
}

async function subjectCandidates(tx: Prisma.TransactionClient, subject: { id: string; itemId: string }): Promise<Candidate[]> {
  const aliases = [subject.id, subject.itemId];
  const rooms = await tx.workroom.findMany({ where: { backlogItemId: { in: aliases } }, orderBy: { id: "asc" }, take: MAX_ROOMS + 1,
    select: { id: true, capsuleId: true, taskRunId: true } });
  if (rooms.length > MAX_ROOMS) return fail();
  const clauses: Prisma.TaskRunWhereInput[] = aliases.flatMap(item => [
    { a2aMetadata: { path: ["initiativeReviewBinding", "itemId"], equals: item } }, { authorityScope: { array_contains: [`backlog-item:${item}`] } },
  ]);
  clauses.push({ workrooms: { some: { backlogItemId: { in: aliases } } } });
  if (rooms.length) clauses.push({ id: { in: rooms.flatMap(room => room.taskRunId ? [room.taskRunId] : []) } },
    ...rooms.map(room => ({ a2aMetadata: { path: ["initiativeReviewBinding", "workroomRef", "workroomId"], equals: room.capsuleId } })));
  return tasks(tx, { OR: clauses });
}

/** Called after the subject lock. Plain bounded reads never acquire existing
 * TaskRun locks beneath it; malformed linked history cannot prove exclusion. */
export async function collectReviewCreationPredecessors(tx: Prisma.TransactionClient, binding: InitiativeReviewBinding): Promise<ReassessmentLineageRow[]> {
  const parsed = parseInitiativeReviewBinding(binding);
  if (!parsed || !equal(parsed, binding)) return fail();
  const subject = await tx.backlogItem.findUnique({ where: { itemId: binding.itemId }, select: { id: true, itemId: true } });
  if (!subject) return fail();
  const aliases = [subject.id, subject.itemId], rows: ReassessmentLineageRow[] = [];
  for (const row of await subjectCandidates(tx, subject)) {
    const checked = accepted(row, false);
    if (checked && aliases.includes(checked.binding.itemId) && key(checked.binding) === key(binding)) rows.push(checked);
  }
  return rows;
}

/** Queries only exact subject/Workroom owners and explicit lineage relations.
 * Neither actor, credential family nor task status narrows this inventory. */
export async function collectReassessmentLineage(tx: Prisma.TransactionClient, input: ReassessmentLineageInput): Promise<ReassessmentLineageSnapshot> {
  const parsed = parseInitiativeReviewBinding(input.binding);
  if (!parsed || !equal(parsed, input.binding) || input.binding.artifactRef.kind !== "repo-blob-at-commit" || !input.originals.length
    || input.originals.length > 2 || new Set(input.originals.map(row => row.taskRunId)).size !== input.originals.length
    || new Set(input.originals.map(row => row.requestDigest)).size !== input.originals.length
    || input.originals.some(row => !row.taskRunId.startsWith("TR-") || !/^[a-f0-9]{64}$/.test(row.requestDigest))) return fail();
  const subject = await tx.backlogItem.findUnique({ where: { itemId: input.binding.itemId }, select: { id: true, itemId: true, organizationId: true } });
  if (!subject || subject.organizationId !== input.organizationId) return fail();
  const aliases = [subject.id, subject.itemId];
  const originalRows = await tasks(tx, { taskRunId: { in: input.originals.map(row => row.taskRunId) } });
  const members = new Map<string, ReassessmentLineageRow>(), keys = new Set<string>();
  for (const original of input.originals) {
    const row = originalRows.find(row => row.taskRunId === original.taskRunId); if (!row) return fail();
    const checked = accepted(row, true);
    if (!checked || checked.requestDigest !== original.requestDigest || !aliases.includes(checked.binding.itemId)) return fail();
    keys.add(key(checked.binding)); members.set(checked.id, checked);
  }
  if (!keys.has(key(input.binding))) return fail();
  for (const row of await subjectCandidates(tx, subject)) {
    const checked = accepted(row, false);
    if (checked && aliases.includes(checked.binding.itemId) && keys.has(key(checked.binding))) members.set(checked.id, checked);
  }
  for (let depth = 0; depth <= MAX_TASKS; depth++) {
    const before = members.size, current = [...members.values()], ids = current.flatMap(row => [row.id, row.taskRunId]);
    const required = [...new Set(current.flatMap(references))];
    const related = await tasks(tx, { OR: [{ id: { in: required } }, { taskRunId: { in: required } }, { parentTaskRunId: { in: ids } },
      ...current.flatMap(row => [{ a2aMetadata: { path: ["initiativeReviewBinding", "presentReassessment", "originalTaskRunId"], equals: row.taskRunId } },
        { a2aMetadata: { path: ["initiativeReviewBinding", "presentReassessment", "predecessorTaskRunIds"], array_contains: [row.taskRunId] } }]) ] });
    for (const ref of required) if (!related.some(row => row.id === ref || row.taskRunId === ref) && !current.some(row => row.id === ref || row.taskRunId === ref)) return fail();
    for (const row of related) {
      // A driver/mock returning an unrelated row cannot expand authority.
      const checked = accepted(row, true); if (!checked || !aliases.includes(checked.binding.itemId)) return fail();
      if (required.includes(row.id) || required.includes(row.taskRunId) || row.parentTaskRunId && ids.includes(row.parentTaskRunId)
        || references(checked).some(ref => ids.includes(ref))) members.set(checked.id, checked);
    }
    if (members.size > MAX_TASKS) return fail();
    if (before === members.size) {
      const rows = [...members.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const snapshot = { input: JSON.parse(JSON.stringify(input)) as ReassessmentLineageInput, subjectRowId: subject.id, rows };
      return { ...snapshot, fingerprint: hash(snapshot) };
    }
  }
  return fail();
}

/** Every existing task lock precedes every owning item lock. Item arguments
 * are semantic BI-* keys; physical rows are resolved and locked in id order. */
export async function lockReassessmentLineage(tx: Prisma.TransactionClient, snapshot: ReassessmentLineageSnapshot,
  itemIds: readonly string[]): Promise<LockedReassessmentLineage> {
  const ids = [...new Set(itemIds)];
  if (!ids.includes(snapshot.input.binding.itemId) || !ids.length || ids.length > 2) return fail();
  const items = await tx.backlogItem.findMany({ where: { itemId: { in: ids } }, select: { id: true, itemId: true, organizationId: true } });
  if (items.length !== ids.length || items.some(row => !ids.includes(row.itemId) || row.organizationId !== snapshot.input.organizationId)
    || !items.some(row => row.id === snapshot.subjectRowId && row.itemId === snapshot.input.binding.itemId)) return fail();
  for (const id of snapshot.rows.map(row => row.id).sort()) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "TaskRun" WHERE "id" = ${id} FOR UPDATE`;
    if (locked.length !== 1 || locked[0]?.id !== id) return fail();
  }
  const itemRowIds = items.map(row => row.id).sort();
  for (const id of itemRowIds) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "BacklogItem" WHERE "id" = ${id} FOR UPDATE`;
    if (locked.length !== 1 || locked[0]?.id !== id) return fail();
  }
  return { snapshot, itemRowIds };
}

/** A changed set aborts this transaction. The caller must recollect in a fresh
 * transaction; this function never adds task locks beneath an item lock. */
export async function revalidateReassessmentLineage(tx: Prisma.TransactionClient, locked: LockedReassessmentLineage): Promise<ReassessmentLineageSnapshot> {
  const current = await collectReassessmentLineage(tx, locked.snapshot.input);
  if (current.fingerprint !== locked.snapshot.fingerprint) throw new ReassessmentLineageError("reassessment-lineage-restart");
  return current;
}
