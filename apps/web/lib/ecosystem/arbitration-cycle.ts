/**
 * The arbitration cycle on the repository controller (BI-FB03E2FD).
 *
 * `arbitrate` was built and tested but had no caller, so the controller's
 * ecosystem queue had no defensible order and a peer submitter heard nothing
 * until work was delivered. WWMD DI-56D5E82AD9D2 settled the shape: ORDERING
 * plus REAL DECISIONS — not a parallel capacity allocator, not a contract change.
 *
 * - Each intake cycle ranks the open ecosystem items and records the rank and
 *   its plain-language reason on the item, where the operator works. Only a
 *   changed position is recorded, so the activity log does not fill with
 *   repeats. The capacity line stays with the accountable human; the item's
 *   own `priority` is never written here, so a priority a person set survives.
 * - A submitter is answered only on a real decision, in the existing
 *   vocabulary: `accepted` when the item moves into work, `rejected` when it is
 *   retired. A retirement with no recorded reason sends nothing — a bare
 *   verdict is not closure (spec §3.5).
 */

import { arbitrate, type ArbitrationEntry } from "./arbitration";

export const ARBITRATION_ACTIVITY_KIND = "ecosystem_arbitration";
const ECOSYSTEM_TAG = "ecosystem-inbound";
const OPEN_STATUSES = ["triaging", "open", "deferred"];
const PEER_ORIGIN = /\[origin:ecosystem-peer-demand:([^\]\s]+)\]/;
/** The controller's open ecosystem queue, bounded so a four-hourly rank stays cheap. */
const RANK_LIMIT = 500;
const DECISION_LIMIT = 200;

export interface ArbitrationItemRow {
  id: string;
  itemId: string;
  title: string;
  workType: string | null;
  demandScore: number | null;
  createdAt: Date;
  activities: Array<{ payload: unknown }>;
}

export interface ArbitrationCycleDb {
  backlogItem: { findMany(args: unknown): Promise<ArbitrationItemRow[]> };
  backlogItemActivity: { create(args: unknown): Promise<unknown> };
}

export interface ArbitrationCycleResult {
  ranked: number;
  recorded: number;
  top: Array<{ itemId: string; rank: number; rationale: string }>;
}

function lastPosition(row: ArbitrationItemRow): { rank?: number; rationale?: string } {
  const payload = row.activities[0]?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const { rank, rationale } = payload as { rank?: unknown; rationale?: unknown };
  return {
    ...(typeof rank === "number" ? { rank } : {}),
    ...(typeof rationale === "string" ? { rationale } : {}),
  };
}

/** Rank the open ecosystem queue and record each changed position. */
export async function runEcosystemArbitrationCycle(
  db: ArbitrationCycleDb,
  now: Date = new Date(),
): Promise<ArbitrationCycleResult> {
  const rows = await db.backlogItem.findMany({
    where: { lifecycleTags: { has: ECOSYSTEM_TAG }, status: { in: OPEN_STATUSES } },
    select: {
      id: true, itemId: true, title: true, workType: true, demandScore: true, createdAt: true,
      activities: {
        where: { kind: ARBITRATION_ACTIVITY_KIND },
        orderBy: { recordedAt: "desc" },
        take: 1,
        select: { payload: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: RANK_LIMIT,
  });
  const byRef = new Map(rows.map((row) => [row.itemId, row]));
  const entries: ArbitrationEntry[] = arbitrate(rows.map((row) => ({
    ref: row.itemId,
    title: row.title,
    score: row.demandScore,
    workType: row.workType,
    submittedAt: row.createdAt,
  })), now);

  let recorded = 0;
  for (const entry of entries) {
    const row = byRef.get(entry.ref)!;
    const previous = lastPosition(row);
    if (previous.rank === entry.rank && previous.rationale === entry.rationale) continue;
    await db.backlogItemActivity.create({ data: {
      backlogItemId: row.id,
      kind: ARBITRATION_ACTIVITY_KIND,
      summary: `Ecosystem queue position ${entry.rank} of ${entries.length}: ${entry.rationale}`.slice(0, 500),
      payload: { rank: entry.rank, of: entries.length, rationale: entry.rationale, rankedAt: now.toISOString() },
    } });
    recorded++;
  }
  return {
    ranked: entries.length,
    recorded,
    top: entries.slice(0, 5).map((entry) => ({ itemId: entry.ref, rank: entry.rank, rationale: entry.rationale })),
  };
}

// ── Decisions back to the submitter ──────────────────────────────────────────

export type EcosystemDecision = "accepted" | "rejected";

export interface DecisionCandidateRow {
  itemId: string;
  title: string;
  status: string;
  body: string | null;
  /** The latest status_change activity, newest first. */
  activities: Array<{ payload: unknown }>;
}

export interface DecisionMember {
  originInstallationId: string;
  envelopeId: string;
  mirrorRefs: string[];
}

export interface DecisionNotice {
  itemId: string;
  clusterId: string;
  decision: EcosystemDecision;
  message: string;
  member: DecisionMember;
}

export interface DecisionDb {
  backlogItem: { findMany(args: unknown): Promise<DecisionCandidateRow[]> };
  federatedRecordMirror: {
    findMany(args: unknown): Promise<Array<{ mirrorId: string; payload: unknown; localRecordRef?: string | null }>>;
  };
}

export interface DecisionSendDeps {
  /** Queue one notice through the existing disposition writeback. */
  queue: (input: {
    clusterId: string;
    decision: EcosystemDecision;
    message: string;
    members: DecisionMember[];
    now: Date;
  }) => Promise<{ queued: number }>;
  /** Reads the envelope identity from a held peer demand mirror payload. */
  decodeEnvelope: (payload: unknown) => { envelopeId: string; originInstallationId: string } | null;
}

export interface DecisionRunResult {
  sent: number;
  withheld: Array<{ itemId: string; reason: string }>;
}

function decisionFor(status: string): EcosystemDecision | null {
  if (status === "in-progress") return "accepted";
  if (status === "retired") return "rejected";
  return null;
}

/** The submitter-facing message, or null when no reason was recorded. */
function decisionMessage(row: DecisionCandidateRow, decision: EcosystemDecision): string | null {
  const title = row.title.trim();
  if (decision === "accepted") return `Taken into work: "${title}".`;
  const payload = row.activities[0]?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as { to?: unknown; rationale?: unknown; reason?: unknown };
  if (record.to !== "retired") return null;
  const why = [record.reason, record.rationale].find((value) => typeof value === "string" && value.trim());
  return typeof why === "string" ? `Declined: "${title}". ${why.trim()}` : null;
}

export function decisionClusterId(itemId: string, decision: EcosystemDecision): string {
  return `ecosystem:${itemId}:${decision}`;
}

/** The disposition mirror's localRecordRef, as queueFounderDispositionNotices writes it. */
export function decisionRecordRef(clusterId: string, envelopeId: string): string {
  return `disposition:${clusterId}:${envelopeId}`;
}

export function peerOriginMirrorId(body: string | null): string | null {
  return body?.match(PEER_ORIGIN)?.[1] ?? null;
}

/**
 * Plan the notices owed for peer-submitted ecosystem items whose state is now
 * a real decision. Pure: what was already sent is passed in.
 */
export function planDecisionNotices(
  rows: DecisionCandidateRow[],
  envelopes: Map<string, { envelopeId: string; originInstallationId: string }>,
  alreadySent: Set<string>,
): { notices: DecisionNotice[]; withheld: DecisionRunResult["withheld"] } {
  const notices: DecisionNotice[] = [];
  const withheld: DecisionRunResult["withheld"] = [];
  for (const row of rows) {
    const decision = decisionFor(row.status);
    if (!decision) continue;
    const mirrorId = peerOriginMirrorId(row.body);
    // Not peer demand: an upstream issue is answered on the issue itself.
    if (!mirrorId) continue;
    const envelope = envelopes.get(mirrorId);
    if (!envelope) {
      withheld.push({ itemId: row.itemId, reason: "the submitted demand is no longer held here" });
      continue;
    }
    const clusterId = decisionClusterId(row.itemId, decision);
    if (alreadySent.has(decisionRecordRef(clusterId, envelope.envelopeId))) continue;
    const message = decisionMessage(row, decision);
    if (!message) {
      withheld.push({ itemId: row.itemId, reason: "retired without a recorded reason" });
      continue;
    }
    notices.push({ itemId: row.itemId, clusterId, decision, message, member: { ...envelope, mirrorRefs: [mirrorId] } });
  }
  return { notices, withheld };
}

/** Answer every peer submitter whose item reached a real decision. */
export async function sendEcosystemDecisionNotices(
  db: DecisionDb,
  deps: DecisionSendDeps,
  now: Date = new Date(),
): Promise<DecisionRunResult> {
  const rows = await db.backlogItem.findMany({
    where: { lifecycleTags: { hasEvery: [ECOSYSTEM_TAG, "peer-demand"] }, status: { in: ["in-progress", "retired"] } },
    select: {
      itemId: true, title: true, status: true, body: true,
      activities: { where: { kind: "status_change" }, orderBy: { recordedAt: "desc" }, take: 1, select: { payload: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: DECISION_LIMIT,
  });
  const mirrorIds = rows.flatMap((row) => peerOriginMirrorId(row.body) ?? []);
  if (mirrorIds.length === 0) return { sent: 0, withheld: [] };

  const held = await db.federatedRecordMirror.findMany({
    where: { mirrorId: { in: mirrorIds }, recordType: "demand-envelope", canonicalSide: "peer" },
    select: { mirrorId: true, payload: true },
  });
  const envelopes = new Map<string, { envelopeId: string; originInstallationId: string }>();
  for (const row of held) {
    const envelope = deps.decodeEnvelope(row.payload);
    if (envelope) envelopes.set(row.mirrorId, envelope);
  }

  const owedRefs = rows.flatMap((row) => {
    const decision = decisionFor(row.status);
    const mirrorId = peerOriginMirrorId(row.body);
    const envelope = mirrorId ? envelopes.get(mirrorId) : undefined;
    return decision && envelope ? [decisionRecordRef(decisionClusterId(row.itemId, decision), envelope.envelopeId)] : [];
  });
  const sentRows = owedRefs.length === 0 ? [] : await db.federatedRecordMirror.findMany({
    where: { recordType: "demand-disposition", canonicalSide: "local", localRecordRef: { in: owedRefs } },
    select: { mirrorId: true, payload: true, localRecordRef: true },
  });
  const alreadySent = new Set(sentRows.flatMap((row) => row.localRecordRef ?? []));

  const { notices, withheld } = planDecisionNotices(rows, envelopes, alreadySent);
  let sent = 0;
  for (const notice of notices) {
    const result = await deps.queue({ clusterId: notice.clusterId, decision: notice.decision,
      message: notice.message, members: [notice.member], now });
    sent += result.queued;
  }
  return { sent, withheld };
}

/** One line for the intake job's schedule view. */
export function summarizeArbitration(ranking: ArbitrationCycleResult, decisions: DecisionRunResult): string {
  const queue = ranking.ranked === 0
    ? "Ecosystem queue: nothing open."
    : `Ecosystem queue: ${ranking.ranked} ranked, ${ranking.recorded} moved. Top: `
      + ranking.top.map((entry) => `${entry.rank}. ${entry.itemId} (${entry.rationale})`).join("; ") + ".";
  const answered = `${decisions.sent} submitter notice(s) sent`
    + (decisions.withheld.length ? `; ${decisions.withheld.length} withheld (${decisions.withheld
      .slice(0, 5).map((entry) => `${entry.itemId}: ${entry.reason}`).join("; ")})` : "");
  return `${queue} ${answered}.`;
}
