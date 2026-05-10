import { randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
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

export type CoworkerSelfAssessmentDeps = {
  now: () => Date;
  createId: (prefix: "CWSA" | "CWN") => string;
  db: CoworkerSelfAssessmentDb;
};

function defaultCreateId(prefix: "CWSA" | "CWN") {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
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
): Promise<{ assessmentId: string; needIds: string[] }> {
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
  for (const need of input.needs) {
    const needId = resolved.createId("CWN");
    needIds.push(needId);
    await resolved.db.createNeed(
      normalizeNeed(need, assessmentId, input.agentId, needId, createdAt),
    );
  }

  return { assessmentId, needIds };
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
