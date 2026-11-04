// BI-39247CB8 — governed bulk retire of the backlog copies that the inbound
// issue triage (scheduled job `ecosystem-inbound-issue-triage`) filed from a
// same-organization peer's demand envelopes.
//
// A same-organization peer sends its whole backlog as demand envelopes, and
// work sync already mirrors that backlog here, so the intake filed each
// envelope as a second, local copy (4,138 on one production install, 2026-10-29
// and 2026-11-03), including envelopes from revoked links and demand the peer had
// withdrawn. The creating path is fixed by BI-C7D95F7E (#6861) and BI-F4866228.
//
// WWMD DI-F7294B768E8D chose ONE governed, reversible bulk retire over a SQL
// retire at upgrade: a read-only dry run, then one approval envelope for the
// operator, then each copy retired through the retire_backlog_item core path so
// it keeps its status history and can be restored with update_backlog_item_status.
//
// This module is the pure part: which copies are in scope, which carry real
// local work and are kept for individual review, what each retirement says,
// and the digest that binds an approval to the exact selection.

import { createHash } from "node:crypto";

import { peerOwnedStatusRefusal } from "@/lib/backlog/peer-owned-item";

export const PEER_DEMAND_ORIGIN_KIND = "ecosystem-peer-demand";
export const PEER_DEMAND_MARKER_PREFIX = `[origin:${PEER_DEMAND_ORIGIN_KIND}:`;
/** Leads every resolution this sweep writes; marks an item as already retired by it. */
export const SWEEP_RESOLUTION_PREFIX = "[peer-demand-intake-copy-retirement]";
export const SAME_ORG_PEER_ROLE = "same-org-peer";
export const WORK_SYNC_MARKER_PREFIX = "[origin:federatedWork:";

const PEER_DEMAND_MARKER = /\[origin:ecosystem-peer-demand:(fdm_[A-Za-z0-9]+)\]/;

/** Statuses a copy may be retired from. Anything further along was moved on purpose. */
const RETIRABLE_STATUSES: ReadonlySet<string> = new Set(["triaging", "open"]);

/** Activity the platform writes on its own while filing, reconciling, twinning,
 *  scoring and auto-triaging an item. None of it is local work on the copy. */
const SYSTEM_ACTIVITY_KINDS: ReadonlySet<string> = new Set([
  "intake_origin",
  "federated_twin",
  "triage_assessment",
  "demand_scored",
]);

export type OriginCategory = "revoked-link" | "withdrawn-demand" | "same-org-live";

export type CopyActivity = {
  kind: string;
  /** A person recorded it. */
  recordedById: string | null;
  /** For intake_origin rows: the origin kind the row reconciled. */
  originKind: string | null;
};

export type CopyFacts = {
  id: string;
  itemId: string;
  title: string;
  status: string;
  body: string | null;
  resolution: string | null;
  claimedById: string | null;
  claimedByAgentId: string | null;
  claimStatus: string | null;
  activeBuildId: string | null;
  /** The demand-envelope mirror the marker names, with its link; null when it no longer resolves. */
  mirror: {
    syncStatus: string;
    disposition: string | null;
    link: { role: string; linkState: string; revoked: boolean } | null;
  } | null;
  workroomCount: number;
  evidenceLinkCount: number;
  originatedBuildCount: number;
  activities: CopyActivity[];
  /** Mutating tools called on the item after it was filed. */
  mutatingToolNames: string[];
  /** The earliest work-sync mirror with the same title, if any. */
  workSyncTwinItemId: string | null;
};

export type CopyClassification =
  | { kind: "out-of-scope"; reason: string }
  | { kind: "already-retired" }
  | { kind: "keep"; origin: OriginCategory | null; reasons: string[] }
  | { kind: "retire"; origin: OriginCategory; outcome: "duplicate" | "discard"; duplicateOfItemId: string | null };

export function peerDemandMirrorId(body: string | null | undefined): string | null {
  return body?.match(PEER_DEMAND_MARKER)?.[1] ?? null;
}

function originCategory(mirror: CopyFacts["mirror"]): OriginCategory | "unresolved" | "cross-org-live" {
  if (!mirror || !mirror.link) return "unresolved";
  if (mirror.link.revoked || mirror.link.linkState === "revoked") return "revoked-link";
  if (mirror.syncStatus === "withdrawn" || mirror.disposition === "withdrawn") return "withdrawn-demand";
  if (mirror.link.role === SAME_ORG_PEER_ROLE) return "same-org-live";
  return "cross-org-live";
}

/** Why a copy carries real local work and must be reviewed by hand; empty when untouched. */
export function localWorkReasons(facts: CopyFacts): string[] {
  const reasons: string[] = [];
  if (!RETIRABLE_STATUSES.has(facts.status)) reasons.push(`status:${facts.status}`);
  if (facts.claimedById || facts.claimedByAgentId || facts.claimStatus === "active") reasons.push("claimed");
  if (facts.activeBuildId || facts.originatedBuildCount > 0) reasons.push("build");
  if (facts.workroomCount > 0) reasons.push("workroom");
  if (facts.evidenceLinkCount > 0) reasons.push("demand-evidence");
  const kinds = new Set<string>();
  for (const activity of facts.activities) {
    if (activity.recordedById) reasons.push("person-activity");
    if (!SYSTEM_ACTIVITY_KINDS.has(activity.kind)) kinds.add(`work-activity:${activity.kind}`);
    if (activity.kind === "intake_origin" && activity.originKind && activity.originKind !== PEER_DEMAND_ORIGIN_KIND) {
      kinds.add(`absorbed-local-intake:${activity.originKind}`);
    }
  }
  reasons.push(...[...kinds].sort());
  if (facts.mutatingToolNames.length > 0) reasons.push(`tool-edits:${[...new Set(facts.mutatingToolNames)].sort().join(",")}`);
  // retire_backlog_item refuses a body that carries a work-sync marker (copied
  // from the peer's own text); predict that here rather than fail at apply.
  if (peerOwnedStatusRefusal(facts.itemId, facts.body)) reasons.push("foreign-work-sync-marker");
  return [...new Set(reasons)];
}

export function classifyPeerDemandCopy(facts: CopyFacts): CopyClassification {
  if (!peerDemandMirrorId(facts.body)) return { kind: "out-of-scope", reason: "no-peer-demand-marker" };
  if (facts.status === "retired" && facts.resolution?.startsWith(SWEEP_RESOLUTION_PREFIX)) {
    return { kind: "already-retired" };
  }
  const origin = originCategory(facts.mirror);
  if (origin === "cross-org-live") return { kind: "out-of-scope", reason: "live-cross-organization-demand" };
  const reasons = localWorkReasons(facts);
  if (origin === "unresolved") return { kind: "keep", origin: null, reasons: ["mirror-unresolved", ...reasons] };
  if (reasons.length > 0) return { kind: "keep", origin, reasons };
  return facts.workSyncTwinItemId
    ? { kind: "retire", origin, outcome: "duplicate", duplicateOfItemId: facts.workSyncTwinItemId }
    : { kind: "retire", origin, outcome: "discard", duplicateOfItemId: null };
}

const ORIGIN_COPY: Record<OriginCategory, string> = {
  "revoked-link": "demand on a same-organization link that has since been revoked",
  "withdrawn-demand": "demand the peer installation had withdrawn",
  "same-org-live": "a same-organization peer's demand, which work sync already mirrors here",
};

/** Arguments for retireBacklogItemTool — the same core path retire_backlog_item uses. */
export function retirementParams(
  itemId: string,
  plan: Extract<CopyClassification, { kind: "retire" }>,
): Record<string, unknown> {
  const twin = plan.duplicateOfItemId
    ? `Work sync already mirrors this item as ${plan.duplicateOfItemId}.`
    : "The peer installation tracks this work.";
  const rationale = [
    SWEEP_RESOLUTION_PREFIX,
    `Copy filed by ecosystem-inbound-issue-triage from ${ORIGIN_COPY[plan.origin]}.`,
    twin,
    "Creating path fixed by BI-C7D95F7E; retired in one governed bulk retire per WWMD DI-F7294B768E8D (BI-39247CB8).",
    "Restore with update_backlog_item_status if this copy carries work.",
  ].join(" ");
  return {
    itemId,
    outcome: plan.outcome,
    rationale,
    reason: `Inbound-triage copy of same-organization peer demand (BI-C7D95F7E, DI-F7294B768E8D)`,
    ...(plan.duplicateOfItemId ? { duplicateOfId: plan.duplicateOfItemId } : {}),
  };
}

/** Binds an approval to the exact set: the items still to retire plus those this sweep already retired. */
export function selectionDigest(itemIds: readonly string[]): string {
  const sorted = [...new Set(itemIds)].sort();
  return createHash("sha256").update(`peer-demand-intake-copies.v1\n${sorted.join("\n")}`).digest("hex");
}

export type ClassifiedCopy = { itemId: string; title: string; status: string; classification: CopyClassification };

export type RetirementPlan = {
  digest: string;
  scanned: number;
  outOfScope: number;
  alreadyRetired: string[];
  toRetire: Array<{ itemId: string; title: string; status: string; plan: Extract<CopyClassification, { kind: "retire" }> }>;
  kept: Array<{ itemId: string; title: string; status: string; origin: OriginCategory | null; reasons: string[] }>;
};

export function buildRetirementPlan(copies: readonly ClassifiedCopy[]): RetirementPlan {
  const plan: RetirementPlan = { digest: "", scanned: copies.length, outOfScope: 0, alreadyRetired: [], toRetire: [], kept: [] };
  for (const copy of copies) {
    const c = copy.classification;
    if (c.kind === "out-of-scope") plan.outOfScope += 1;
    else if (c.kind === "already-retired") plan.alreadyRetired.push(copy.itemId);
    else if (c.kind === "keep") plan.kept.push({ itemId: copy.itemId, title: copy.title, status: copy.status, origin: c.origin, reasons: c.reasons });
    else plan.toRetire.push({ itemId: copy.itemId, title: copy.title, status: copy.status, plan: c });
  }
  plan.toRetire.sort((a, b) => a.itemId.localeCompare(b.itemId));
  plan.kept.sort((a, b) => a.itemId.localeCompare(b.itemId));
  plan.digest = selectionDigest([...plan.toRetire.map((r) => r.itemId), ...plan.alreadyRetired]);
  return plan;
}

function countBy<T>(rows: readonly T[], key: (row: T) => string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) for (const k of key(row)) out[k] = (out[k] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Read-only dry-run report: exact counts by category, samples, and the digest to approve. */
export function summarizeRetirementPlan(plan: RetirementPlan, opts: { sampleSize?: number; keptListLimit?: number } = {}) {
  const sampleSize = opts.sampleSize ?? 5;
  const keptListLimit = opts.keptListLimit ?? 500;
  const samples: Record<string, Array<{ itemId: string; title: string; status: string; outcome: string; duplicateOfItemId: string | null }>> = {};
  for (const row of plan.toRetire) {
    const key = row.plan.origin;
    const bucket = (samples[key] ??= []);
    if (bucket.length < sampleSize) {
      bucket.push({ itemId: row.itemId, title: row.title, status: row.status, outcome: row.plan.outcome, duplicateOfItemId: row.plan.duplicateOfItemId });
    }
  }
  return {
    selectionDigest: plan.digest,
    scanned: plan.scanned,
    outOfScope: plan.outOfScope,
    alreadyRetired: plan.alreadyRetired.length,
    toRetire: {
      total: plan.toRetire.length,
      byOrigin: countBy(plan.toRetire, (r) => [r.plan.origin]),
      byStatus: countBy(plan.toRetire, (r) => [r.status]),
      byOutcome: countBy(plan.toRetire, (r) => [r.plan.outcome]),
    },
    keptForReview: {
      total: plan.kept.length,
      byReason: countBy(plan.kept, (k) => k.reasons.map((reason) => reason.split(":")[0]!)),
      byStatus: countBy(plan.kept, (k) => [k.status]),
      items: plan.kept.slice(0, keptListLimit),
      truncated: plan.kept.length > keptListLimit,
    },
    samples,
  };
}
