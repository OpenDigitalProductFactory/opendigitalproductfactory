import { prisma } from "@dpf/db";
import type {
  CoworkerCapabilityNeedKind,
  CoworkerCapabilityNeedSeverity,
  CoworkerCapabilityNeedStatus,
  CoworkerNeedFilters,
  JsonObject,
} from "./types";
import {
  COWORKER_CAPABILITY_NEED_KINDS,
  COWORKER_CAPABILITY_NEED_SEVERITIES,
  COWORKER_CAPABILITY_NEED_STATUSES,
} from "./types";

type ReviewNeedRow = {
  needId: string;
  assessmentId: string;
  agentId: string;
  kind: string;
  severity: string;
  status: string;
  need: string;
  blocks: string;
  evidenceJson: unknown;
  readinessJson: unknown;
  linkedBacklogItemId: string | null;
  duplicateOfId: string | null;
  reviewerNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  agent: {
    name: string;
    slugId: string | null;
    tier: number;
    valueStream: string | null;
  };
  assessment: {
    verdict: string;
    confidence: string;
    missionSummary: string | null;
    capabilitySummary: string | null;
    routeContext: string | null;
    trigger: string;
    createdAt: Date;
  };
  linkedBacklogItem: {
    itemId: string;
    title: string;
    status: string;
  } | null;
  duplicateOf: {
    needId: string;
    need: string;
  } | null;
  duplicates: Array<{ needId: string }>;
};

type ReviewDb = {
  listReviewNeeds(filters: CoworkerNeedFilters): Promise<ReviewNeedRow[]>;
};

export type CoworkerCapabilityNeedReviewFilters = CoworkerNeedFilters;

export type CoworkerCapabilityNeedReviewItem = {
  needId: string;
  assessmentId: string;
  agentId: string;
  coworkerName: string;
  coworkerSlug: string;
  coworkerTier: number;
  valueStream: string | null;
  kind: string;
  severity: string;
  status: string;
  need: string;
  blocks: string;
  evidencePreview: string;
  readinessPreview: string;
  linkedBacklogItemId: string | null;
  linkedBacklogItemTitle: string | null;
  linkedBacklogItemStatus: string | null;
  duplicateOfId: string | null;
  duplicateOfNeed: string | null;
  duplicateCount: number;
  reviewerNote: string | null;
  assessmentVerdict: string;
  assessmentConfidence: string;
  missionSummary: string | null;
  capabilitySummary: string | null;
  routeContext: string | null;
  trigger: string;
  createdAtLabel: string;
  updatedAtLabel: string;
};

export type CoworkerCapabilityNeedReview = {
  summary: {
    total: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
    byKind: Record<string, number>;
  };
  filterOptions: {
    statuses: string[];
    severities: string[];
    kinds: string[];
  };
  needs: CoworkerCapabilityNeedReviewItem[];
};

function defaultDb(): ReviewDb {
  return {
    listReviewNeeds: (filters) =>
      prisma.coworkerCapabilityNeed.findMany({
        where: compact({
          agentId: filters.agentId,
          status: filters.status,
          kind: filters.kind,
          severity: filters.severity,
        }),
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
        include: {
          agent: {
            select: {
              name: true,
              slugId: true,
              tier: true,
              valueStream: true,
            },
          },
          assessment: {
            select: {
              verdict: true,
              confidence: true,
              missionSummary: true,
              capabilitySummary: true,
              routeContext: true,
              trigger: true,
              createdAt: true,
            },
          },
          linkedBacklogItem: {
            select: {
              itemId: true,
              title: true,
              status: true,
            },
          },
          duplicateOf: {
            select: {
              needId: true,
              need: true,
            },
          },
          duplicates: {
            select: {
              needId: true,
            },
          },
        },
      }) as Promise<ReviewNeedRow[]>,
  };
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function countBy(items: ReviewNeedRow[], key: "status" | "severity" | "kind") {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item[key]] = (acc[item[key]] ?? 0) + 1;
    return acc;
  }, {});
}

function uniqueSorted(items: ReviewNeedRow[], key: "status" | "severity" | "kind") {
  return Array.from(new Set(items.map((item) => item[key]))).sort((a, b) => a.localeCompare(b));
}

function asJsonObject(value: unknown): JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function previewJson(value: unknown): string {
  const entries = Object.entries(asJsonObject(value));
  if (entries.length === 0) return "No structured evidence";

  return entries
    .slice(0, 5)
    .map(([key, entry]) => `${key}: ${formatJsonValue(entry)}`)
    .join("; ");
}

function formatJsonValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }
  if (value != null && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function toReviewItem(row: ReviewNeedRow): CoworkerCapabilityNeedReviewItem {
  return {
    needId: row.needId,
    assessmentId: row.assessmentId,
    agentId: row.agentId,
    coworkerName: row.agent.name,
    coworkerSlug: row.agent.slugId ?? row.agentId,
    coworkerTier: row.agent.tier,
    valueStream: row.agent.valueStream,
    kind: row.kind,
    severity: row.severity,
    status: row.status,
    need: row.need,
    blocks: row.blocks,
    evidencePreview: previewJson(row.evidenceJson),
    readinessPreview: previewJson(row.readinessJson),
    linkedBacklogItemId: row.linkedBacklogItemId,
    linkedBacklogItemTitle: row.linkedBacklogItem?.title ?? null,
    linkedBacklogItemStatus: row.linkedBacklogItem?.status ?? null,
    duplicateOfId: row.duplicateOfId,
    duplicateOfNeed: row.duplicateOf?.need ?? null,
    duplicateCount: row.duplicates.length,
    reviewerNote: row.reviewerNote,
    assessmentVerdict: row.assessment.verdict,
    assessmentConfidence: row.assessment.confidence,
    missionSummary: row.assessment.missionSummary,
    capabilitySummary: row.assessment.capabilitySummary,
    routeContext: row.assessment.routeContext,
    trigger: row.assessment.trigger,
    createdAtLabel: formatDate(row.createdAt),
    updatedAtLabel: formatDate(row.updatedAt),
  };
}

export async function getCoworkerCapabilityNeedReview(
  filters: CoworkerCapabilityNeedReviewFilters = {},
  deps?: { db?: ReviewDb },
): Promise<CoworkerCapabilityNeedReview> {
  const db = deps?.db ?? defaultDb();
  const rows = await db.listReviewNeeds(filters);

  return {
    summary: {
      total: rows.length,
      byStatus: countBy(rows, "status"),
      bySeverity: countBy(rows, "severity"),
      byKind: countBy(rows, "kind"),
    },
    filterOptions: {
      statuses: mergeKnownOptions(COWORKER_CAPABILITY_NEED_STATUSES, uniqueSorted(rows, "status")),
      severities: mergeKnownOptions(COWORKER_CAPABILITY_NEED_SEVERITIES, uniqueSorted(rows, "severity")),
      kinds: mergeKnownOptions(COWORKER_CAPABILITY_NEED_KINDS, uniqueSorted(rows, "kind")),
    },
    needs: rows.map(toReviewItem),
  };
}

export function parseCoworkerCapabilityNeedReviewFilters(input: {
  status?: string | string[];
  kind?: string | string[];
  severity?: string | string[];
  agentId?: string | string[];
}): CoworkerCapabilityNeedReviewFilters {
  const status = first(input.status);
  const kind = first(input.kind);
  const severity = first(input.severity);
  const agentId = first(input.agentId);

  return {
    status: oneOf(status, COWORKER_CAPABILITY_NEED_STATUSES),
    kind: oneOf(kind, COWORKER_CAPABILITY_NEED_KINDS),
    severity: oneOf(severity, COWORKER_CAPABILITY_NEED_SEVERITIES),
    agentId,
  };
}

function first(value?: string | string[]) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function oneOf<const T extends readonly string[]>(value: string | undefined, allowed: T): T[number] | undefined {
  return value != null && allowed.includes(value) ? value as T[number] : undefined;
}

function mergeKnownOptions<const T extends readonly string[]>(known: T, observed: string[]) {
  return Array.from(new Set([...known, ...observed]));
}
