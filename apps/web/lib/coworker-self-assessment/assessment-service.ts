import { randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import { ingestBacklogItem } from "@/lib/operate/backlog-ingest";
import type { BacklogWorkType } from "@/lib/explore/backlog";
import type {
  CoworkerCapabilityNeedInput,
  CoworkerNeedFilters,
  JsonObject,
  ResolveCoworkerCapabilityNeedInput,
  SubmitCoworkerSelfAssessmentInput,
} from "./types";

type AssessmentCreateData = {
  assessmentId: string;
  agentId: string;
  trigger: string;
  routeContext?: string | null;
  verdict: string;
  confidence: string;
  missionSummary?: string | null;
  capabilitySummary?: string | null;
  rawPayload: JsonObject;
  createdAt: Date;
};

type NeedCreateData = {
  needId: string;
  assessmentId: string;
  agentId: string;
  kind: string;
  severity: string;
  status: string;
  need: string;
  blocks: string;
  evidenceJson: JsonObject;
  readinessJson: JsonObject;
  createdAt: Date;
};

type NeedUpdateData = {
  status?: string;
  linkedBacklogItemId?: string;
  duplicateOfId?: string;
  reviewerNote?: string;
};

type CoworkerSelfAssessmentDb = {
  createAssessment(data: AssessmentCreateData): Promise<unknown>;
  createNeed(data: NeedCreateData): Promise<unknown>;
  listNeeds(filters: CoworkerNeedFilters): Promise<unknown[]>;
  updateNeed(needId: string, data: NeedUpdateData): Promise<unknown>;
};

/** Files one capability need into the backlog. Returns the linked item id, or
 *  null when the projection failed (non-fatal — the need is still recorded). */
type FileCapabilityNeedFn = (input: {
  needId: string;
  agentId: string;
  kind: string;
  severity: string;
  need: string;
  blocks: string;
}) => Promise<{ itemId: string } | null>;

export type CoworkerSelfAssessmentDeps = {
  now: () => Date;
  createId: (prefix: "CWSA" | "CWN") => string;
  db: CoworkerSelfAssessmentDb;
  fileBacklogItem: FileCapabilityNeedFn;
};

function defaultCreateId(prefix: "CWSA" | "CWN") {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

/**
 * Map a capability-need kind to a backlog workType (advisory for triage). The
 * precise ones (tool/skill) carry through; the rest pick the closest category.
 */
export function capabilityNeedToWorkType(kind: string): BacklogWorkType {
  switch (kind) {
    case "tool":
      return "tool";
    case "skill":
      return "skill";
    case "prompt":
    case "convention":
      return "doc";
    case "grant":
    case "model":
    case "boundary":
      return "chore";
    // code, data, memory, ui_surface, other → feature
    default:
      return "feature";
  }
}

/**
 * Stable origin id for dedup: the same gap, re-surfaced by a later self-
 * assessment (a new needId), touches one backlog item instead of spawning a
 * duplicate. Keyed by coworker + kind + normalized need text.
 */
export function capabilityNeedOriginId(agentId: string, kind: string, need: string): string {
  const slug = need.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
  return `${agentId}:${kind}:${slug}`;
}

/**
 * File one capability need into the backlog through the shared front door.
 * Exported so the submit path AND the orphan-reconcile (BI-8CE36E65 Phase 6)
 * share ONE filing behaviour — same origin dedup key + body — and never drift.
 * Non-fatal: returns null on failure (the need is still recorded as evidence).
 */
export async function fileCapabilityNeedToBacklog(n: {
  needId: string;
  agentId: string;
  kind: string;
  severity: string;
  need: string;
  blocks: string;
}): Promise<{ itemId: string } | null> {
  try {
    const res = await ingestBacklogItem({
      title: `[${n.kind}] ${n.need}`.replace(/\s+/g, " ").trim().slice(0, 200),
      body: [
        n.need,
        `Blocks: ${n.blocks}`,
        `Kind: ${n.kind} | Severity: ${n.severity}`,
        `Coworker: ${n.agentId}`,
        `From capability need ${n.needId}`,
      ].join("\n"),
      workType: capabilityNeedToWorkType(n.kind),
      source: "automated-detection",
      itemIdPrefix: "CAP",
      agentId: n.agentId,
      origin: { kind: "capability-need", id: capabilityNeedOriginId(n.agentId, n.kind, n.need) },
    });
    return { itemId: res.itemId };
  } catch (err) {
    // Non-fatal: the need is still recorded even if the backlog projection fails.
    console.error("[coworker-self-assessment] backlog auto-file failed", err);
    return null;
  }
}

function defaultFileBacklogItem(): FileCapabilityNeedFn {
  return fileCapabilityNeedToBacklog;
}

function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function defaultDb(): CoworkerSelfAssessmentDb {
  return {
    createAssessment: (data) =>
      prisma.coworkerSelfAssessment.create({
        data: {
          ...data,
          rawPayload: data.rawPayload as Prisma.InputJsonValue,
        },
      }),
    createNeed: (data) =>
      prisma.coworkerCapabilityNeed.create({
        data: {
          ...data,
          evidenceJson: data.evidenceJson as Prisma.InputJsonValue,
          readinessJson: data.readinessJson as Prisma.InputJsonValue,
        },
      }),
    listNeeds: (filters) =>
      prisma.coworkerCapabilityNeed.findMany({
        where: defined({
          agentId: filters.agentId,
          status: filters.status,
          kind: filters.kind,
          severity: filters.severity,
        }),
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      }),
    updateNeed: (needId, data) =>
      prisma.coworkerCapabilityNeed.update({
        where: { needId },
        data,
      }),
  };
}

function depsOrDefault(deps?: Partial<CoworkerSelfAssessmentDeps>): CoworkerSelfAssessmentDeps {
  return {
    now: deps?.now ?? (() => new Date()),
    createId: deps?.createId ?? defaultCreateId,
    db: deps?.db ?? defaultDb(),
    fileBacklogItem: deps?.fileBacklogItem ?? defaultFileBacklogItem(),
  };
}

function normalizeNeed(
  input: CoworkerCapabilityNeedInput,
  assessmentId: string,
  agentId: string,
  needId: string,
  createdAt: Date,
): NeedCreateData {
  return {
    needId,
    assessmentId,
    agentId,
    kind: input.kind,
    severity: input.severity,
    status: "submitted",
    need: input.need.trim(),
    blocks: input.blocks.trim(),
    evidenceJson: input.evidenceJson ?? {},
    readinessJson: input.readinessJson ?? {},
    createdAt,
  };
}

export async function submitCoworkerSelfAssessment(
  input: SubmitCoworkerSelfAssessmentInput,
  deps?: Partial<CoworkerSelfAssessmentDeps>,
): Promise<{ assessmentId: string; needIds: string[]; backlogItemIds: string[] }> {
  const resolved = depsOrDefault(deps);
  const createdAt = resolved.now();
  const assessmentId = resolved.createId("CWSA");

  await resolved.db.createAssessment({
    assessmentId,
    agentId: input.agentId,
    trigger: input.trigger,
    routeContext: input.routeContext,
    verdict: input.verdict,
    confidence: input.confidence,
    missionSummary: input.missionSummary,
    capabilitySummary: input.capabilitySummary,
    rawPayload: input.rawPayload ?? {},
    createdAt,
  });

  const needIds: string[] = [];
  const backlogItemIds: string[] = [];
  for (const need of input.needs) {
    const needId = resolved.createId("CWN");
    needIds.push(needId);
    await resolved.db.createNeed(
      normalizeNeed(need, assessmentId, input.agentId, needId, createdAt),
    );

    // Consolidation (EP-INTAKE-UNIFY / BI-8CE36E65): file the need into the
    // backlog the moment it is submitted, so the gap is visible and triageable
    // there instead of waiting for a manual link that never happens. The need
    // stays the evidence record; the BacklogItem is the work.
    const filed = await resolved.fileBacklogItem({
      needId,
      agentId: input.agentId,
      kind: need.kind,
      severity: need.severity,
      need: need.need.trim(),
      blocks: need.blocks.trim(),
    });
    if (filed?.itemId) {
      backlogItemIds.push(filed.itemId);
      await resolved.db.updateNeed(needId, {
        linkedBacklogItemId: filed.itemId,
        status: "backlog-filed",
      });
    }
  }

  return { assessmentId, needIds, backlogItemIds };
}

export async function listCoworkerCapabilityNeeds(
  filters: CoworkerNeedFilters = {},
  deps?: Partial<CoworkerSelfAssessmentDeps>,
) {
  return depsOrDefault(deps).db.listNeeds(filters);
}

export async function linkNeedToBacklogItem(
  needId: string,
  backlogItemId: string,
  deps?: Partial<CoworkerSelfAssessmentDeps>,
) {
  return depsOrDefault(deps).db.updateNeed(needId, {
    linkedBacklogItemId: backlogItemId,
    status: "backlog-filed",
  });
}

export async function resolveCapabilityNeed(
  needId: string,
  decision: ResolveCoworkerCapabilityNeedInput,
  deps?: Partial<CoworkerSelfAssessmentDeps>,
) {
  return depsOrDefault(deps).db.updateNeed(needId, defined({
    status: decision.status,
    duplicateOfId: decision.duplicateOfId,
    reviewerNote: decision.reviewerNote,
  }));
}
