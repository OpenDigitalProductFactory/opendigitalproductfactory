// Coworker-envelope source — CoworkerActionEnvelope rows in status `proposed`
// that belong to the reading user.
//
// A governed coworker whose authority decision returns `require-approval` gets a
// CoworkerActionEnvelope and its TaskRun is parked on `input-required`
// (lib/coworker/authority-approval-envelope.ts). Until BI-7CB2CCDE the inbox had
// no loader for that table at all, so the only Approve control on the page came
// from the AgentActionProposal source — a different record class entirely, whose
// button could only ever settle unrelated work. This source is the missing half.
//
// Two rules govern it:
//
//   1. Delegating-user isolation. `delegatingUserId` is the ONLY user who may
//      decide an envelope (assertCallerIsDelegate in envelope-actions.ts), so it
//      is a required query predicate here, not a post-filter. No user id, no
//      query, no items.
//   2. Only live proposals are actionable. Resolved and expired envelopes are
//      excluded from the live query AND re-checked in the pure projector, so a
//      stale render cannot present a control the state machine would refuse.
//   3. A request nobody answered does not vanish (BI-0012E6CA). Expired and
//      lapsed-proposed envelopes from the last seven days come back as a
//      non-urgent "Expired unanswered" item with "Ask again" and no decision
//      controls, until the coworker or the person raises it again.
//
// Spec: docs/superpowers/specs/2026-06-23-human-attention-surface-design.md §4.1.

import type { prisma } from "@dpf/db";

import { observeEnvelopeBacklog } from "@/lib/coworker/envelope-observability";
import {
  envelopeApproveRoute,
  envelopeDeclineRoute,
  envelopeReraiseRoute,
} from "@/lib/coworker/envelope-routes";
import { EXPIRED_APPROVAL_RESURFACE_MS } from "@/lib/coworker/approval-lifetime";
import { isRecord } from "@/lib/shared/coerce";
import { SOURCE_CATALOG } from "@dpf/i18n";
import {
  coworkerEnvelopesAwaitingDecision,
  coworkerEnvelopesExpiredUnactioned,
} from "@/lib/operate/metrics";
import { immutableArtifactIdentity, parseInitiativeReviewBinding } from "@/lib/mcp-task-review-contract";

import { attentionAuthorForAgent } from "../attribution";
import {
  envelopeIdFromExecutionResult,
  summarizeCoworkerEnvelopeDecision,
} from "../coworker-envelope-decision";
import type {
  AttentionEnvelopeApproval,
  AttentionEnvelopeReviewBinding,
  AttentionItem,
  TimeToAct,
} from "../types";

type Db = typeof prisma;

/** The envelope columns this projection reads, plus the bound TaskRun's
 *  metadata. Structural so the pure projector is testable without Prisma. */
export type CoworkerEnvelopeRow = {
  id: string;
  coworkerAgentId: string;
  delegatingUserId: string;
  manifestActionId: string;
  rationale: string;
  status: string;
  taskRunId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  /** Present on authority envelopes; ties a re-raised request to its source. */
  approvalBindingFingerprint?: string | null;
  argsJson?: unknown;
  proposedParameters?: unknown;
  /** The tool's declared consequence, resolved from the tool registry. */
  consequence?: string | null;
  taskRun: { a2aMetadata: unknown } | null;
};

/** The one status that can still be decided. Every other value in the
 *  envelope state machine is either mid-flight or terminal. */
const DECIDABLE_STATUS = "proposed";

const EXPIRED_COPY = SOURCE_CATALOG.approvals.expiredUnanswered;

/**
 * Nobody answered this request before its window closed: it is `expired`, or
 * still `proposed` past `expiresAt` because no sweep has settled it yet. A row
 * carrying a person's approval (humanApproval) or a policy authorization
 * (policyAuthority) WAS answered — an approved call that lapsed before it ran
 * is not "unanswered" and is reported through its outcome instead.
 */
export function isExpiredUnanswered(row: CoworkerEnvelopeRow, nowMs: number): boolean {
  const lapsed = row.status === "expired"
    || (row.status === DECIDABLE_STATUS && row.expiresAt !== null && row.expiresAt.getTime() <= nowMs);
  if (!lapsed) return false;
  const args = isRecord(row.argsJson) ? row.argsJson : null;
  return !(args && ("humanApproval" in args || "policyAuthority" in args));
}

/** The immutable artifact the reviewer was bound to, when the task carries one.
 *  Reuses the canonical parser rather than re-reading the shape locally. */
function reviewBindingOf(
  row: CoworkerEnvelopeRow,
): AttentionEnvelopeReviewBinding | undefined {
  const metadata = row.taskRun?.a2aMetadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const binding = parseInitiativeReviewBinding(
    (metadata as Record<string, unknown>).initiativeReviewBinding,
  );
  if (!binding) return undefined;
  const identity = immutableArtifactIdentity(binding.artifactRef);
  return {
    gate: binding.gate,
    itemId: binding.itemId,
    repositoryFullName: identity.repositoryFullName,
    commitSha: identity.version,
    path: identity.path,
    providerBlobId: identity.expectedBlobId,
  };
}

/** How close the approval window is to closing. An envelope with no expiry has
 *  no deadline to report. */
function timeToAct(expiresAt: Date | null, nowMs: number): TimeToAct {
  if (!expiresAt) return "none";
  const msLeft = expiresAt.getTime() - nowMs;
  if (msLeft <= 0) return "overdue";
  if (msLeft <= 86_400_000) return "due-today";
  return "due-soon";
}

/** Pure projection of one envelope row into an attention item. */
export function coworkerEnvelopeToAttentionItem(
  row: CoworkerEnvelopeRow,
  nowMs: number,
): AttentionItem {
  const expired = row.expiresAt !== null && row.expiresAt.getTime() <= nowMs;
  const expiredUnanswered = isExpiredUnanswered(row, nowMs);
  const reviewBinding = reviewBindingOf(row);
  const decision = summarizeCoworkerEnvelopeDecision({
    toolName: row.manifestActionId,
    proposedParameters: row.proposedParameters,
    argsJson: row.argsJson,
    reviewBinding,
    recommenderAgentId: row.coworkerAgentId,
    authorizerUserId: row.delegatingUserId,
    consequence: row.consequence ?? null,
    rationale: row.rationale,
  });
  const approval: AttentionEnvelopeApproval = {
    envelopeId: row.id,
    coworkerAgentId: row.coworkerAgentId,
    delegatingUserId: row.delegatingUserId,
    manifestActionId: row.manifestActionId,
    rationale: row.rationale,
    status: row.status,
    taskRunId: row.taskRunId,
    expiresAtIso: row.expiresAt?.toISOString() ?? null,
    actionable: row.status === DECIDABLE_STATUS && !expired,
    expiredUnanswered,
    decision,
    ...(reviewBinding ? { reviewBinding } : {}),
    approveHref: envelopeApproveRoute(row.id),
    declineHref: envelopeDeclineRoute(row.id),
    reraiseHref: envelopeReraiseRoute(row.id),
  };

  if (expiredUnanswered) {
    return {
      id: `coworker-envelope:${row.id}`,
      source: "coworker-envelope",
      title: `${EXPIRED_COPY.label}: ${row.manifestActionId} for ${row.coworkerAgentId}`,
      context: `${EXPIRED_COPY.context} ${row.rationale}`,
      decisionClass: { scorability: "unscorable" },
      riskClass: "read",
      triage: {
        // Nothing is waiting on it any more: the coworker was told to carry on
        // and the window is closed, so there is no deadline to report.
        timeToAct: "none",
        residueReason: "policy-approval",
        blastRadius: "the coworker work that asked for this approval",
        decideEffort: "review",
        // Asking again only puts the same request back in front of you.
        irreversible: false,
      },
      createdAtIso: row.createdAt.toISOString(),
      portfolio: "for-employees",
      // No Authorize/Decline: a lapsed request can never be decided from a
      // stale card. "Ask again" is an in-place mutation on the card, so it
      // carries no href (the generic owner layer turns hrefs into buttons).
      actions: [{ kind: "answer", label: EXPIRED_COPY.askAgain }],
      deepLink: "/workspace/inbox",
      audience: { operator: true },
      technical: {
        detectedBy: row.coworkerAgentId,
        ...(approval.reviewBinding ? { backlogItemId: approval.reviewBinding.itemId } : {}),
      },
      author: attentionAuthorForAgent(row.coworkerAgentId, { trustLevel: "propose" }),
      envelope: approval,
    } satisfies AttentionItem;
  }

  const deadline = row.expiresAt?.toISOString();
  return {
    id: `coworker-envelope:${row.id}`,
    source: "coworker-envelope",
    // Raw, for technical detail only. The owner headline comes from the copy layer.
    title: `Approve ${row.manifestActionId} for ${row.coworkerAgentId}`,
    // The coworker's own stated reason — the rationale the owner decides on.
    context: row.rationale,
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: timeToAct(row.expiresAt, nowMs),
      ...(deadline ? { deadlineIso: deadline } : {}),
      residueReason: "policy-approval",
      blastRadius: "the coworker task waiting on this approval",
      decideEffort: "review",
      // The approved action runs for real and its receipt cannot be unrecorded.
      irreversible: true,
    },
    createdAtIso: row.createdAt.toISOString(),
    portfolio: "for-employees",
    // Deliberately link-free. The decision belongs on THIS card, through the
    // envelope endpoints; an href here would become an owner button that
    // navigates away from the only surface that can settle the envelope.
    actions: [
      { kind: "approve", label: "Authorize" },
      { kind: "reject", label: "Decline" },
    ],
    deepLink: "/workspace/inbox",
    audience: { operator: true },
    technical: {
      detectedBy: row.coworkerAgentId,
      ...(approval.reviewBinding ? { backlogItemId: approval.reviewBinding.itemId } : {}),
    },
    author: attentionAuthorForAgent(row.coworkerAgentId, { trustLevel: "propose" }),
    envelope: approval,
  };
}

/**
 * Load the reading user's live envelope proposals.
 *
 * `delegatingUserId` is required. An anonymous or unresolved caller gets an
 * empty list and no query at all — an inbox must never fall back to "every
 * user's envelopes" when it cannot name the reader.
 */
export async function loadCoworkerEnvelopeItems(
  db: Db,
  delegatingUserId: string | undefined,
  nowMs: number = Date.now(),
  envelopeId?: string,
): Promise<AttentionItem[]> {
  if (!delegatingUserId) return [];
  const now = new Date(nowMs);
  const rows = await db.coworkerActionEnvelope.findMany({
    where: {
      delegatingUserId,
      ...(envelopeId ? { id: envelopeId } : {}),
      status: DECIDABLE_STATUS,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      coworkerAgentId: true,
      delegatingUserId: true,
      manifestActionId: true,
      rationale: true,
      status: true,
      taskRunId: true,
      expiresAt: true,
      createdAt: true,
      argsJson: true,
      taskRun: { select: { a2aMetadata: true } },
    },
  });
  const lapsed = await loadExpiredUnanswered(db, delegatingUserId, nowMs, envelopeId);
  const liveIds = new Set((rows as unknown as CoworkerEnvelopeRow[]).map((row) => row.id));
  const allRows = [
    ...(rows as unknown as CoworkerEnvelopeRow[]),
    ...lapsed.filter((row) => !liveIds.has(row.id)),
  ];
  const proposedByEnvelopeId = await loadProposedParameters(db, allRows);
  const consequenceByTool = await loadDeclaredConsequences(
    allRows.map((row) => row.manifestActionId),
  );
  // Fire-and-forget backlog observation (BI-78D3CF1E). The query above
  // deliberately EXCLUDES expired envelopes, because an expired one is not
  // actionable — which is exactly why nothing could see them lapsing. This
  // publishes the two gauges beside it: how many are waiting on a person, and
  // how many closed unanswered. Install-wide, because the operator's question is
  // "are consent requests lapsing here", not "are mine".
  void observeEnvelopeBacklog(
    {
      countProposedWithin: (at) =>
        db.coworkerActionEnvelope.count({
          where: {
            status: DECIDABLE_STATUS,
            OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
          },
        }),
      countProposedExpired: (at) =>
        db.coworkerActionEnvelope.count({
          where: {
            status: DECIDABLE_STATUS,
            resolvedAt: null,
            expiresAt: { lte: at },
          },
        }),
    },
    {
      awaiting: coworkerEnvelopesAwaitingDecision,
      expiredUnactioned: coworkerEnvelopesExpiredUnactioned,
    },
    now,
  ).catch(() => {
    // Observability must never affect the inbox it rides on.
  });

  return allRows.map((row) =>
    coworkerEnvelopeToAttentionItem(
      {
        ...row,
        ...(proposedByEnvelopeId.has(row.id)
          ? { proposedParameters: proposedByEnvelopeId.get(row.id) }
          : {}),
        consequence: consequenceByTool.get(row.manifestActionId) ?? null,
      },
      nowMs,
    ),
  );
}

/**
 * The reader's requests that closed unanswered in the last seven days and have
 * not been asked again (BI-0012E6CA).
 *
 * A request counts as asked again when a newer envelope exists for the same
 * exact binding — the coworker re-asked, or the person pressed "Ask again"
 * (which copies the binding). The unanswered predicate is re-checked in code
 * (isExpiredUnanswered) rather than trusted from the query.
 */
async function loadExpiredUnanswered(
  db: Db,
  delegatingUserId: string,
  nowMs: number,
  envelopeId: string | undefined,
): Promise<CoworkerEnvelopeRow[]> {
  const now = new Date(nowMs);
  const candidates = await db.coworkerActionEnvelope.findMany({
    where: {
      delegatingUserId,
      ...(envelopeId ? { id: envelopeId } : {}),
      status: { in: ["expired", DECIDABLE_STATUS] },
      expiresAt: { lte: now },
      createdAt: { gte: new Date(nowMs - EXPIRED_APPROVAL_RESURFACE_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      coworkerAgentId: true,
      delegatingUserId: true,
      manifestActionId: true,
      rationale: true,
      status: true,
      taskRunId: true,
      expiresAt: true,
      createdAt: true,
      argsJson: true,
      approvalBindingFingerprint: true,
      taskRun: { select: { a2aMetadata: true } },
    },
  }) as unknown as CoworkerEnvelopeRow[];
  const unanswered = candidates.filter((row) =>
    row.delegatingUserId === delegatingUserId && isExpiredUnanswered(row, nowMs));
  const fingerprints = [...new Set(unanswered.flatMap((row) =>
    row.approvalBindingFingerprint ? [row.approvalBindingFingerprint] : []))];
  if (fingerprints.length === 0) return unanswered;

  const oldest = unanswered.reduce((min, row) => (row.createdAt < min ? row.createdAt : min), unanswered[0]!.createdAt);
  const successors = await db.coworkerActionEnvelope.findMany({
    where: {
      delegatingUserId,
      approvalBindingFingerprint: { in: fingerprints },
      createdAt: { gt: oldest },
    },
    select: { id: true, approvalBindingFingerprint: true, createdAt: true },
  }) as unknown as Array<{ id: string; approvalBindingFingerprint: string | null; createdAt: Date }>;
  return unanswered.filter((row) => !successors.some((later) =>
    later.id !== row.id
    && later.approvalBindingFingerprint === row.approvalBindingFingerprint
    && later.createdAt > row.createdAt));
}

type ProposedExecutionRow = {
  taskRunId: string | null;
  toolName: string;
  userId?: string;
  parameters: unknown;
  result: unknown;
};

/**
 * The pending call the envelope was minted for, found by the envelope id the
 * governed executor wrote into its result. Every surface writes that id, so
 * this finds external MCP envelopes (which carry no TaskRun) as well as task
 * envelopes (BI-12E5DD91). Only the delegating user's own execution of the
 * same tool is accepted.
 */
async function loadProposedParameters(
  db: Db,
  rows: CoworkerEnvelopeRow[],
): Promise<Map<string, unknown>> {
  if (rows.length === 0) return new Map();
  const executions = await db.toolExecution.findMany({
    where: {
      success: false,
      toolName: { in: [...new Set(rows.map((row) => row.manifestActionId))] },
      OR: rows.map((row) => ({ result: { path: ["data", "envelopeId"], equals: row.id } })),
    },
    orderBy: { createdAt: "desc" },
    select: { taskRunId: true, toolName: true, userId: true, parameters: true, result: true },
  }) as ProposedExecutionRow[];
  const proposed = new Map<string, unknown>();
  for (const row of rows) {
    const match = executions.find((execution) =>
      execution.toolName === row.manifestActionId
      && envelopeIdFromExecutionResult(execution.result) === row.id
      && (execution.userId === undefined || execution.userId === row.delegatingUserId)
      && (!row.taskRunId || execution.taskRunId === row.taskRunId),
    );
    if (match) proposed.set(row.id, match.parameters);
  }
  return proposed;
}

/** Declared consequences, read from the tool registry. Display only: an
 *  unavailable registry leaves the card saying none is declared. */
async function loadDeclaredConsequences(toolNames: string[]): Promise<Map<string, string>> {
  const wanted = new Set(toolNames);
  const out = new Map<string, string>();
  if (wanted.size === 0) return out;
  try {
    const { PLATFORM_TOOLS } = await import("@/lib/mcp-tools");
    for (const tool of PLATFORM_TOOLS) {
      if (wanted.has(tool.name) && tool.consequence) out.set(tool.name, tool.consequence);
    }
  } catch {
    // Display-only enrichment; the card falls back to "none declared".
  }
  return out;
}
