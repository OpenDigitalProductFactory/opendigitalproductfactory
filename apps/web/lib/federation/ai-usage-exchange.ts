// BI-6361A930: AI plan usage shared with a same-organization peer.
//
// The owner's AI plans belong to a person, not to an install: production and
// the paired Dev install draw on the same Claude, ChatGPT/Codex, Grok and
// Google plans. To value a plan and spread its fee correctly, each install
// needs the other's usage. That usage travels over the existing work-sync
// channel, the same way the backlog does:
//
//   serving:   GET /api/v1/federation/ai-usage (same-org peer only) returns
//              THIS install's own TokenUsage and rate-limit hits for the last
//              30 days, in hourly buckets per provider. Usage pulled from a
//              peer is never re-served, so nothing is counted twice.
//   receiving: on the work-sync cadence, ai-usage-sync.ts pulls each trusted
//              same-org peer and keeps the last pull in PlatformConfig.
//
// Token counts per provider and hour carry no prompt, person or customer data.
// Pure: no database or clock access.

import {
  ESTIMATE_LOOKBACK_DAYS,
  PEER_USAGE_STALE_AFTER_MS,
  type PeerUsageReason,
  type PeerUsageStatus,
  type UsageBucket,
} from "@/lib/finance/subscription-cost-estimator";

export const AI_USAGE_SPEC_VERSION = "dpf.ai-usage.v1";
export const AI_USAGE_PATH = "/api/v1/federation/ai-usage";
/** PlatformConfig key holding the last AI-usage pull per link. */
export const PEER_AI_USAGE_KEY = "federation.ai-usage.peer.v1";
/**
 * The links whose installs share the owner's plans: trusted, live,
 * same-organization peers (the only role that maps to the same-organization
 * relationship preset in demand-reconciliation.ts).
 */
export const SAME_ORG_PEER_LINK_WHERE = { linkState: "trusted", revokedAt: null, quarantinedAt: null, role: "same-org-peer" } as const;
/** 30 days x 24 hours x a generous provider count. A larger body is refused as invalid. */
export const AI_USAGE_MAX_ROWS = 30 * 24 * 40;

/** One hourly bucket: [providerId, hour (floor(epoch s / 3600)), inputTokens, outputTokens, limitHits]. */
export type FederatedAiUsageRowV1 = [string, number, number, number, number];

export interface FederatedAiUsageV1 {
  specVersion: typeof AI_USAGE_SPEC_VERSION;
  originInstallationId: string;
  generatedAt: string;
  lookbackDays: number;
  rows: FederatedAiUsageRowV1[];
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Every way the body falls short of the v1 contract; empty when it is valid. */
export function validateFederatedAiUsageV1(body: unknown): string[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return ["body is not an object"];
  const b = body as Partial<FederatedAiUsageV1>;
  const violations: string[] = [];
  if (b.specVersion !== AI_USAGE_SPEC_VERSION) violations.push(`specVersion is not ${AI_USAGE_SPEC_VERSION}`);
  if (typeof b.originInstallationId !== "string" || !b.originInstallationId) violations.push("originInstallationId missing");
  if (typeof b.generatedAt !== "string" || Number.isNaN(Date.parse(b.generatedAt))) violations.push("generatedAt is not a time");
  if (!Array.isArray(b.rows)) return [...violations, "rows is not an array"];
  if (b.rows.length > AI_USAGE_MAX_ROWS) violations.push(`rows exceeds ${AI_USAGE_MAX_ROWS}`);
  const bad = b.rows.findIndex((row: unknown) => !Array.isArray(row) || row.length !== 5 || typeof row[0] !== "string" || !row[0]
    || !isCount(row[1]) || !isCount(row[2]) || !isCount(row[3]) || !isCount(row[4]));
  if (bad >= 0) violations.push(`row ${bad} is malformed`);
  return violations;
}

/** Serving side: this install's own hourly usage and limit hits, joined into rows. */
export function buildFederatedAiUsage(input: {
  originInstallationId: string;
  now: Date;
  usage: ReadonlyArray<{ providerId: string; hour: number; inputTokens: number; outputTokens: number }>;
  hits: ReadonlyArray<{ providerId: string; hour: number; hits: number }>;
}): FederatedAiUsageV1 {
  const rows = new Map<string, FederatedAiUsageRowV1>();
  const at = (providerId: string, hour: number): FederatedAiUsageRowV1 => {
    const key = `${providerId}\x00${hour}`;
    let row = rows.get(key);
    if (!row) rows.set(key, (row = [providerId, hour, 0, 0, 0]));
    return row;
  };
  const count = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
  for (const u of input.usage) {
    const row = at(u.providerId, u.hour);
    row[2] += count(u.inputTokens);
    row[3] += count(u.outputTokens);
  }
  for (const h of input.hits) at(h.providerId, h.hour)[4] += count(h.hits);
  return {
    specVersion: AI_USAGE_SPEC_VERSION,
    originInstallationId: input.originInstallationId,
    generatedAt: input.now.toISOString(),
    lookbackDays: ESTIMATE_LOOKBACK_DAYS,
    rows: [...rows.values()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])),
  };
}

export type PeerAiUsagePullOutcome = "pulled" | "no-token" | "unreachable" | "peer-outdated" | "refused" | "invalid" | "identity-mismatch";

export interface PeerAiUsageLinkRecordV1 {
  linkId: string;
  peerInstallationId: string | null;
  outcome: PeerAiUsagePullOutcome;
  detail: string | null;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  /** The last usage that landed, kept across failed pulls so the page can say "as of". */
  usage: FederatedAiUsageV1 | null;
}

export interface PeerAiUsageRecordV1 {
  schemaVersion: 1;
  links: PeerAiUsageLinkRecordV1[];
}

export function parsePeerAiUsageRecord(value: unknown): PeerAiUsageRecordV1 | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Partial<PeerAiUsageRecordV1>;
  return record.schemaVersion === 1 && Array.isArray(record.links) ? (record as PeerAiUsageRecordV1) : null;
}

export type PeerAiUsagePull =
  | { linkId: string; outcome: "pulled"; usage: FederatedAiUsageV1 }
  | { linkId: string; outcome: Exclude<PeerAiUsagePullOutcome, "pulled">; detail: string | null };

/** Classify a failed GET the way the operator would fix it. */
export function classifyAiUsageFetchFailure(status: number): "unreachable" | "peer-outdated" | "refused" {
  if (status === 404 || status === 405) return "peer-outdated";
  if (status === 401 || status === 403) return "refused";
  return "unreachable";
}

/**
 * Next stored record. Only links pulled this cycle are kept (a revoked link
 * drops out). A failed pull keeps the last usage that landed.
 */
export function mergePeerAiUsageRecord(
  previous: PeerAiUsageRecordV1 | null,
  pulls: readonly PeerAiUsagePull[],
  now: Date,
): PeerAiUsageRecordV1 {
  const at = now.toISOString();
  return {
    schemaVersion: 1,
    links: pulls.map((pull): PeerAiUsageLinkRecordV1 => {
      const before = previous?.links.find((link) => link.linkId === pull.linkId);
      if (pull.outcome === "pulled") {
        return { linkId: pull.linkId, peerInstallationId: pull.usage.originInstallationId, outcome: "pulled", detail: null,
          lastAttemptAt: at, lastSuccessAt: at, usage: pull.usage };
      }
      return { linkId: pull.linkId, peerInstallationId: before?.peerInstallationId ?? null, outcome: pull.outcome, detail: pull.detail,
        lastAttemptAt: at, lastSuccessAt: before?.lastSuccessAt ?? null, usage: before?.usage ?? null };
    }),
  };
}

const REASON: Record<Exclude<PeerAiUsagePullOutcome, "pulled">, PeerUsageReason> = {
  "no-token": "refused",
  unreachable: "unreachable",
  "peer-outdated": "peer-outdated",
  refused: "refused",
  invalid: "invalid",
  "identity-mismatch": "invalid",
};

/**
 * What the Finance page knows about each paired install: its usage buckets and
 * whether that usage is current, stale or missing. `linkIds` are the trusted
 * same-organization links right now; a link with no stored pull yet is
 * reported missing, never silently absent.
 */
export function peerUsageFromRecord(
  record: PeerAiUsageRecordV1 | null,
  linkIds: readonly string[],
  now: Date,
): { peers: PeerUsageStatus[]; buckets: UsageBucket[] } {
  const peers: PeerUsageStatus[] = [];
  const buckets: UsageBucket[] = [];
  for (const linkId of linkIds) {
    const link = record?.links.find((l) => l.linkId === linkId);
    if (!link) {
      peers.push({ linkId, install: linkId, state: "missing", reason: "never-pulled", lastSuccessAt: null });
      continue;
    }
    const install = link.usage?.originInstallationId ?? link.peerInstallationId ?? linkId;
    const failure = link.outcome === "pulled" ? null : REASON[link.outcome];
    const success = link.lastSuccessAt ? Date.parse(link.lastSuccessAt) : Number.NaN;
    const state = !link.usage || Number.isNaN(success) ? "missing"
      : failure || now.getTime() - success > PEER_USAGE_STALE_AFTER_MS ? "stale" : "current";
    peers.push({ linkId, install, state, reason: state === "current" ? null : failure ?? "unreachable", lastSuccessAt: link.lastSuccessAt });
    for (const [providerId, hour, inputTokens, outputTokens, limitHits] of link.usage?.rows ?? []) {
      buckets.push({ install, providerId, hour, inputTokens, outputTokens, limitHits });
    }
  }
  return { peers, buckets };
}
