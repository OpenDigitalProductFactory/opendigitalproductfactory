import type { IntegrationImportStagingRecord } from "@/lib/integrations/import-staging";
import type { WordPressProbe } from "./client";

export interface WordPressCursor { modifiedGmt: string; id: number }
export type WordPressReadKind = "post" | "page" | "media";
export type WordPressSyncCheckpoints = Partial<Record<WordPressReadKind, WordPressCursor>>;
export type WordPressReadRecord = {
  id: number;
  modified_gmt?: string;
  slug?: string;
  status?: string;
  title?: { rendered?: string };
  caption?: { rendered?: string };
  mime_type?: string;
  [key: string]: unknown;
};

export function compareWordPressCursor(left: WordPressCursor, right: WordPressCursor): number {
  const time = left.modifiedGmt.localeCompare(right.modifiedGmt);
  return time === 0 ? left.id - right.id : time;
}

function cursor(record: WordPressReadRecord): WordPressCursor {
  return { modifiedGmt: record.modified_gmt ?? "1970-01-01T00:00:00", id: record.id };
}

function stage(kind: WordPressReadKind, record: WordPressReadRecord): IntegrationImportStagingRecord {
  const title = kind === "media" ? record.caption?.rendered : record.title?.rendered;
  return {
    entityFamily: `wordpress-${kind}`,
    externalId: String(record.id),
    sourceProvider: "wordpress-self-hosted",
    sourceTimestamp: record.modified_gmt ? `${record.modified_gmt}Z` : null,
    ownerSide: "external",
    proposedLocalLink: {
      entityType: kind === "media" ? "MediaAsset" : kind === "page" ? "Document" : "OutboundDraft",
      localId: null,
      status: "candidate",
      confidence: "low",
      reason: "Read-only WordPress observation; review before linking to canonical DPF content.",
    },
    displayFields: [
      title ? { label: kind === "media" ? "Caption" : "Title", value: String(title).slice(0, 500) } : null,
      record.slug ? { label: "Slug", value: record.slug.slice(0, 300) } : null,
      record.status ? { label: "WordPress status", value: record.status.slice(0, 100) } : null,
      record.mime_type ? { label: "MIME type", value: record.mime_type.slice(0, 200) } : null,
    ].filter((field): field is { label: string; value: string } => Boolean(field)),
    readOnly: true,
  };
}

export function stageWordPressDiscovery(probe: WordPressProbe): IntegrationImportStagingRecord[] {
  const typeRecords = [
    ...probe.supportedResourceKinds.map((value) => ({ value, supported: true })),
    ...(probe.unsupportedResourceTypes ?? []).map((value) => ({ value, supported: false })),
  ].map(({ value, supported }): IntegrationImportStagingRecord => ({
    entityFamily: "wordpress-type",
    externalId: value,
    sourceProvider: "wordpress-self-hosted",
    sourceTimestamp: null,
    ownerSide: "external",
    proposedLocalLink: {
      entityType: "IntegrationCapability",
      localId: null,
      status: supported ? "candidate" : "blocked",
      confidence: "high",
      reason: supported ? "WordPress core resource discovered for governed read/projection." : "Custom WordPress type discovered as read-only unsupported evidence.",
    },
    displayFields: [{ label: "Resource type", value }, { label: "Support", value: supported ? "Core supported" : "Discovered only" }],
    readOnly: true,
  }));
  const taxonomyRecords = (probe.supportedTaxonomies ?? []).map((value): IntegrationImportStagingRecord => ({
    entityFamily: "wordpress-taxonomy",
    externalId: value,
    sourceProvider: "wordpress-self-hosted",
    sourceTimestamp: null,
    ownerSide: "external",
    proposedLocalLink: { entityType: "IntegrationCapability", localId: null, status: "candidate", confidence: "high", reason: "WordPress taxonomy discovered for explicit term-ID resolution." },
    displayFields: [{ label: "Taxonomy", value }],
    readOnly: true,
  }));
  return [...typeRecords, ...taxonomyRecords];
}

export async function syncWordPressReadModels(input: {
  list(kind: WordPressReadKind, input: { page: number; pageSize: number; modifiedAfter?: string | null }): Promise<{ records: WordPressReadRecord[]; totalPages: number }>;
  kinds: WordPressReadKind[];
  checkpoints?: WordPressSyncCheckpoints;
  pageSize?: number;
  maxPages?: number;
}): Promise<{ records: IntegrationImportStagingRecord[]; checkpoints: WordPressSyncCheckpoints; truncated: boolean }> {
  const pageSize = input.pageSize ?? 50;
  const maxPages = input.maxPages ?? 20;
  const byIdentity = new Map<string, { kind: WordPressReadKind; record: WordPressReadRecord }>();
  let truncated = false;
  const checkpoints: WordPressSyncCheckpoints = { ...(input.checkpoints ?? {}) };
  for (const kind of input.kinds) {
    const previous = input.checkpoints?.[kind] ?? null;
    let latest = previous;
    const modifiedAfter = previous ? overlapStart(previous.modifiedGmt) : null;
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await input.list(kind, { page, pageSize, modifiedAfter });
      for (const record of result.records) {
        const position = cursor(record);
        if (previous && compareWordPressCursor(position, previous) <= 0) continue;
        byIdentity.set(`${kind}:${record.id}`, { kind, record });
        if (!latest || compareWordPressCursor(position, latest) > 0) latest = position;
      }
      if (page >= result.totalPages) break;
      if (page === maxPages) truncated = true;
    }
    if (latest) checkpoints[kind] = latest;
  }
  const sorted = [...byIdentity.values()].sort((left, right) => compareWordPressCursor(cursor(left.record), cursor(right.record)) || left.kind.localeCompare(right.kind));
  return { records: sorted.map(({ kind, record }) => stage(kind, record)), checkpoints, truncated };
}

function overlapStart(modifiedGmt: string): string {
  const time = new Date(`${modifiedGmt}Z`).getTime();
  if (!Number.isFinite(time)) return modifiedGmt;
  return new Date(time - 5 * 60_000).toISOString().replace(/\.000Z$/, "").replace(/Z$/, "");
}
