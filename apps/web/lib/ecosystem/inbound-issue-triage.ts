/**
 * Inbound ecosystem triage (BI-F47386ED) — the half of the loop that did not exist.
 *
 * Two transports carry an ecosystem submission upstream: a GitHub issue filed by
 * the relay (for an install with no federation link) and a federated demand
 * envelope (for a linked one). Neither was ever read back, so a platform-
 * development install could not see what the ecosystem had submitted.
 *
 * This runner normalizes both into one shape and files them through the EXISTING
 * backlog front door, which already dedupes, bumps occurrence counts and records
 * provenance. It is pure and dependency-injected: no Prisma, no fetch.
 */

import { parseArchetypeRefs } from "@/lib/federation/demand-projection";
import type { BacklogIngestInput } from "@/lib/operate/backlog-ingest";
import { BACKLOG_WORK_TYPE_VALUES, type BacklogWorkType } from "@/lib/explore/backlog";

/** Where an inbound item came from. Part of the provenance marker, so a re-run
 *  matches the same origin instead of filing a second copy. */
export type InboundSourceKind = "upstream-issue" | "peer-demand";

export interface InboundEcosystemItem {
  sourceKind: InboundSourceKind;
  /** Stable id at the origin: the issue number, or the demand mirror id. */
  sourceId: string;
  title: string;
  summary: string;
  workType?: string | null;
  occurrenceCount?: number;
  /** Namespaced applicability refs from the demand envelope, when present. */
  archetypeRefs?: string[] | null;
  /** Stable install pseudonym of the submitter. Never a personal identity. */
  submitter?: string | null;
  /** How many distinct organizations reported it, when the envelope said. */
  affectedOrganizations?: number | null;
  url?: string | null;
}

export interface InboundTriageResult {
  ingested: number;
  deduped: number;
  failed: number;
  /** Item ids touched, newest first — what a caller reports to an operator. */
  itemIds: string[];
}

export interface InboundTriageDeps {
  items: InboundEcosystemItem[];
  ingest: (input: BacklogIngestInput) => Promise<{ itemId: string; created: boolean }>;
  /** Injected so a failure is observable in tests instead of only on a console. */
  onFailure?: (item: InboundEcosystemItem, error: unknown) => void;
}

function isWorkType(value: unknown): value is BacklogWorkType {
  return typeof value === "string" && (BACKLOG_WORK_TYPE_VALUES as readonly string[]).includes(value);
}

/**
 * Compose the body an operator reads, keeping the submitter and the link to the
 * origin visible. Provenance is the point of this slice: an item with no
 * attributable submitter cannot be weighted by submitter later.
 */
export function composeInboundBody(item: InboundEcosystemItem): string {
  const lines = [item.summary.trim()];
  const facts: string[] = [];
  if (item.submitter) facts.push(`Submitted by install \`${item.submitter}\``);
  if (typeof item.affectedOrganizations === "number") {
    facts.push(`${item.affectedOrganizations} organization${item.affectedOrganizations === 1 ? "" : "s"} affected`);
  }
  if (item.url) facts.push(item.url);
  if (facts.length > 0) lines.push("", ...facts.map((fact) => `- ${fact}`));
  return lines.join("\n");
}

/** Map one inbound item onto the backlog front door's input contract. */
export function toBacklogIngestInput(item: InboundEcosystemItem): BacklogIngestInput {
  const scope = parseArchetypeRefs(item.archetypeRefs);
  return {
    title: item.title.slice(0, 500),
    body: composeInboundBody(item),
    // The origin really is a person at another install asking for something;
    // it merely ARRIVES by automation. Recording it as automated-detection
    // would erase the submitter the arbitration model depends on.
    source: "user-request",
    workType: isWorkType(item.workType) ? item.workType : "feature",
    // Provenance marker: a re-run of the sweep matches this same origin rather
    // than filing a duplicate.
    origin: { kind: `ecosystem-${item.sourceKind}`, id: item.sourceId },
    ...(scope.scopeKind ? { scopeKind: scope.scopeKind as BacklogIngestInput["scopeKind"] } : {}),
    ...(scope.archetypeCategories.length > 0 ? { archetypeCategories: scope.archetypeCategories } : {}),
    ...(scope.archetypeIds.length > 0 ? { archetypeIds: scope.archetypeIds } : {}),
    lifecycleTags: ["ecosystem-inbound", item.sourceKind],
  };
}

export async function runInboundIssueTriage(deps: InboundTriageDeps): Promise<InboundTriageResult> {
  const result: InboundTriageResult = { ingested: 0, deduped: 0, failed: 0, itemIds: [] };

  for (const item of deps.items) {
    // Fault-isolate each item: one bad record must not strand every record
    // after it — the same lesson the demand reconciliation loop already learned.
    try {
      const filed = await deps.ingest(toBacklogIngestInput(item));
      if (filed.created) result.ingested++;
      else result.deduped++;
      result.itemIds.push(filed.itemId);
    } catch (err) {
      result.failed++;
      deps.onFailure?.(item, err);
    }
  }

  return result;
}

/** Pure mapper: peer-side demand mirrors → inbound items.
 *
 *  Deliberately not routed through `NetworkDemandView`: that read model serves
 *  the ops panel and carries neither the envelope's applicability refs nor the
 *  originating installation, which are exactly the provenance and relevance
 *  fields this slice exists to preserve. */
export function mapPeerDemandMirrors(
  rows: Array<{ mirrorId: string; payload: unknown }>,
  decode: (payload: unknown) => { envelope: DecodableDemandEnvelope } | null,
): InboundEcosystemItem[] {
  return rows.flatMap((row) => {
    const decoded = decode(row.payload);
    if (!decoded) return [];
    const envelope = decoded.envelope;
    return [{
      sourceKind: "peer-demand" as const,
      sourceId: row.mirrorId,
      title: envelope.title,
      summary: envelope.summary,
      workType: envelope.workType ?? null,
      occurrenceCount: envelope.signal?.occurrenceCount ?? 0,
      archetypeRefs: envelope.applicability?.archetypeRefs ?? null,
      // The install pseudonym, never a personal identity.
      submitter: envelope.originInstallationId ?? null,
      affectedOrganizations: envelope.signal?.affectedOrganizations ?? null,
    }];
  });
}

/** The envelope fields this mapper reads. Structural on purpose, so the mapper
 *  stays testable without constructing a full validated envelope. */
export interface DecodableDemandEnvelope {
  title: string;
  summary: string;
  workType?: string;
  originInstallationId?: string;
  applicability?: { archetypeRefs?: string[] };
  signal?: { occurrenceCount?: number; affectedOrganizations?: number };
}

/** Map upstream GitHub issues onto the same inbound shape. */
export function mapUpstreamIssues(
  issues: Array<{ number: number; title: string; body: string | null; labels: string[]; htmlUrl: string }>,
): InboundEcosystemItem[] {
  return issues.map((issue) => ({
    sourceKind: "upstream-issue" as const,
    sourceId: String(issue.number),
    title: issue.title,
    summary: issue.body?.trim() || issue.title,
    // A relay-filed issue carries its work type as a label, when it carries one.
    workType: issue.labels.find((label) => (BACKLOG_WORK_TYPE_VALUES as readonly string[]).includes(label)) ?? null,
    submitter: parseInstallPseudonym(issue.body),
    url: issue.htmlUrl,
  }));
}

/** The issue bridge stamps the install pseudonym into the body so the project
 *  team can thread replies to one contributor across issues. Recover it, so an
 *  ingested item stays attributable to its submitter. */
export function parseInstallPseudonym(body: string | null | undefined): string | null {
  if (!body) return null;
  const match = /Install:\s*`([^`]+)`/.exec(body);
  return match?.[1]?.trim() || null;
}
