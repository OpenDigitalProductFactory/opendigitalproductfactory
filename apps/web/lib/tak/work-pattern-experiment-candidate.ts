import { createHash, randomUUID } from "node:crypto";

import { prisma, type Prisma } from "@dpf/db";

import { coworkerAuthorityWhere } from "@/lib/coworker-identity";
import {
  COWORKER_CAPABILITY_NEED_KINDS,
  COWORKER_CAPABILITY_NEED_SEVERITIES,
  type CoworkerCapabilityNeedKind,
  type CoworkerCapabilityNeedSeverity,
} from "@/lib/coworker-self-assessment/types";
import { isRecord } from "@/lib/shared/coerce";

import { workPatternFixtureDigest } from "./work-pattern-experiment-fixture";
import { workPatternExperimentDefinitionKey } from "./work-pattern-experiment-identity";
import {
  isPromotionPolicyAdmissible,
  parseReviewedExperimentCandidate,
  type ReviewedExperimentCandidate,
} from "./work-pattern-experiment-scheduler";
import {
  WORK_PATTERN_DECISION_SCOPES,
  mergeWorkPatternMetadata,
  type WorkPatternDecisionScope,
  type WorkPatternMetadata,
} from "./work-pattern-types";

const OPEN_NEED_STATUSES = ["submitted", "reviewing", "accepted", "backlog-filed"] as const;
const EVALUATION_METHOD = "governed-work-pattern-experiment";

export type ProposeWorkPatternExperimentCandidateInput = {
  agentId: string;
  need: string;
  blocks: string;
  kind?: CoworkerCapabilityNeedKind;
  severity?: CoworkerCapabilityNeedSeverity;
  decisionScope?: WorkPatternDecisionScope;
  routeContext?: string | null;
  candidate: unknown;
};

export type ProposeWorkPatternExperimentCandidateResult =
  | {
      status: "proposed" | "reused";
      assessmentId: string;
      needId: string;
      agentId: string;
      patternKey: string;
      experimentDefinitionKey: string;
      fingerprint: string;
      reviewRoute: string;
    }
  | {
      status: "rejected";
      reason:
        | "invalid_input"
        | "invalid_experiment_candidate"
        | "authority_ceiling"
        | "missing_build_replay_fixture"
        | "coworker_not_found";
    };

export type ExistingCandidateNeedRow = {
  needId: string;
  assessmentId: string;
  evidenceJson: unknown;
};

export type ProposeWorkPatternExperimentCandidateDb = {
  findCoworker(agentId: string): Promise<{ agentId: string } | null>;
  listOpenNeeds(agentId: string): Promise<ExistingCandidateNeedRow[]>;
  createProposal(data: {
    assessmentId: string;
    needId: string;
    agentId: string;
    routeContext: string;
    kind: CoworkerCapabilityNeedKind;
    severity: CoworkerCapabilityNeedSeverity;
    need: string;
    blocks: string;
    evidenceJson: Record<string, unknown>;
    readinessJson: Record<string, unknown>;
    rawPayload: Record<string, unknown>;
    createdAt: Date;
  }): Promise<void>;
};

export type ProposeWorkPatternExperimentCandidateDeps = {
  db?: ProposeWorkPatternExperimentCandidateDb;
  now?: () => Date;
  createId?: (prefix: "CWSA" | "CWN") => string;
};

function defaultCreateId(prefix: "CWSA" | "CWN"): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function defaultDb(): ProposeWorkPatternExperimentCandidateDb {
  return {
    findCoworker: (agentId) =>
      prisma.agent.findFirst({
        where: coworkerAuthorityWhere(agentId),
        select: { agentId: true },
      }),
    listOpenNeeds: (agentId) =>
      prisma.coworkerCapabilityNeed.findMany({
        where: {
          agentId,
          status: { in: [...OPEN_NEED_STATUSES] },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          needId: true,
          assessmentId: true,
          evidenceJson: true,
        },
      }),
    createProposal: async (data) => {
      await prisma.$transaction(async (tx) => {
        await tx.coworkerSelfAssessment.create({
          data: {
            assessmentId: data.assessmentId,
            agentId: data.agentId,
            trigger: "work-pattern-experiment-proposal",
            routeContext: data.routeContext,
            verdict: "gaps",
            confidence: "high",
            missionSummary: `Governed Living Playbook experiment proposal for ${data.agentId}.`,
            capabilitySummary: data.need,
            rawPayload: data.rawPayload as Prisma.InputJsonValue,
            createdAt: data.createdAt,
          },
        });
        await tx.coworkerCapabilityNeed.create({
          data: {
            needId: data.needId,
            assessmentId: data.assessmentId,
            agentId: data.agentId,
            kind: data.kind,
            severity: data.severity,
            status: "submitted",
            need: data.need,
            blocks: data.blocks,
            evidenceJson: data.evidenceJson as Prisma.InputJsonValue,
            readinessJson: data.readinessJson as Prisma.InputJsonValue,
            createdAt: data.createdAt,
          },
        });
      });
    },
  };
}

export function workPatternExperimentCandidateFingerprint(input: {
  agentId: string;
  definitionKey: string;
  candidate: ReviewedExperimentCandidate;
}): string {
  const fixtureDigests = input.candidate.cells
    .map((cell) => `${cell.methodVariantKey}:${cell.modelVariantKey}:${cell.fixtureParts ? workPatternFixtureDigest(cell.fixtureParts) : "none"}`)
    .sort();
  return createHash("sha256")
    .update(
      JSON.stringify({
        agentId: input.agentId,
        patternKey: input.candidate.definition.patternKey,
        definitionKey: input.definitionKey,
        pairKey: input.candidate.pairKey,
        fixtureDigests,
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

function readFingerprint(evidenceJson: unknown): string | null {
  if (!isRecord(evidenceJson)) return null;
  const direct = evidenceJson.fingerprint;
  return typeof direct === "string" && direct.trim().length > 0 ? direct.trim() : null;
}

/**
 * Originates one governed Living Playbook experiment candidate as a reviewable
 * CoworkerCapabilityNeed on the target coworker. Never creates an
 * AuthorityBinding, TaskRun, TaskArtifact, FeatureBuild, or live mutation; the
 * operator still approves or rejects the candidate in the coworker detail panel.
 */
export async function proposeWorkPatternExperimentCandidate(
  input: ProposeWorkPatternExperimentCandidateInput,
  deps?: ProposeWorkPatternExperimentCandidateDeps,
): Promise<ProposeWorkPatternExperimentCandidateResult> {
  const agentId = typeof input.agentId === "string" ? input.agentId.trim() : "";
  const need = typeof input.need === "string" ? input.need.trim() : "";
  const blocks = typeof input.blocks === "string" ? input.blocks.trim() : "";
  if (!agentId || !need || !blocks) {
    return { status: "rejected", reason: "invalid_input" };
  }

  const candidate = parseReviewedExperimentCandidate(input.candidate);
  if (!candidate) {
    return { status: "rejected", reason: "invalid_experiment_candidate" };
  }
  if (!isPromotionPolicyAdmissible(candidate)) {
    return { status: "rejected", reason: "authority_ceiling" };
  }
  if (
    candidate.activityKey === "build.implement"
    && candidate.cells.some((cell) => cell.fixtureParts === undefined)
  ) {
    return { status: "rejected", reason: "missing_build_replay_fixture" };
  }

  const db = deps?.db ?? defaultDb();
  const coworker = await db.findCoworker(agentId);
  if (!coworker) {
    return { status: "rejected", reason: "coworker_not_found" };
  }

  const canonicalAgentId = coworker.agentId;
  const patternKey = candidate.definition.patternKey;
  const experimentDefinitionKey = workPatternExperimentDefinitionKey(candidate.definition);
  const fingerprint = workPatternExperimentCandidateFingerprint({
    agentId: canonicalAgentId,
    definitionKey: experimentDefinitionKey,
    candidate,
  });
  const reviewRoute = `/platform/ai/agent/${canonicalAgentId}`;

  const openNeeds = await db.listOpenNeeds(canonicalAgentId);
  const existing = openNeeds.find((row) => readFingerprint(row.evidenceJson) === fingerprint);
  if (existing) {
    return {
      status: "reused",
      assessmentId: existing.assessmentId,
      needId: existing.needId,
      agentId: canonicalAgentId,
      patternKey,
      experimentDefinitionKey,
      fingerprint,
      reviewRoute,
    };
  }

  const kind: CoworkerCapabilityNeedKind =
    input.kind && COWORKER_CAPABILITY_NEED_KINDS.includes(input.kind) ? input.kind : "skill";
  const severity: CoworkerCapabilityNeedSeverity =
    input.severity && COWORKER_CAPABILITY_NEED_SEVERITIES.includes(input.severity)
      ? input.severity
      : "important";
  const decisionScope: WorkPatternDecisionScope =
    input.decisionScope && WORK_PATTERN_DECISION_SCOPES.includes(input.decisionScope)
      ? input.decisionScope
      : "platform-wwmd";
  const routeContext =
    typeof input.routeContext === "string" && input.routeContext.trim().length > 0
      ? input.routeContext.trim()
      : reviewRoute;

  const createdAt = (deps?.now ?? (() => new Date()))();
  const createId = deps?.createId ?? defaultCreateId;
  const assessmentId = createId("CWSA");
  const needId = createId("CWN");
  const maxPatternVersion = Math.max(
    1,
    ...candidate.definition.methodVariants.map((variant) => variant.patternVersion),
  );
  const workPattern: WorkPatternMetadata = {
    patternKey,
    status: "candidate",
    scope: "activity",
    version: maxPatternVersion,
    source: "human-review",
    decisionScope,
    observedAt: createdAt.toISOString(),
    evidence: [{ capabilityNeedId: needId }],
    candidate: {
      kind,
      need,
      blocks,
      fingerprint,
      evaluationMethod: EVALUATION_METHOD,
    },
  };
  const evidenceJson = mergeWorkPatternMetadata(
    {
      patternKey,
      activityClass: candidate.activityKey,
      riskClass: candidate.riskClass,
      decisionScope,
      fingerprint,
      evaluationMethod: EVALUATION_METHOD,
      experimentDefinitionKey,
      workPatternExperimentCandidate: candidate,
    },
    workPattern,
  );
  const readinessJson = {
    readyForReview: true,
    readyForCaseActivation: false,
    activationProposed: true,
    blockers: ["pattern-status-not-approved-or-active"],
  };

  await db.createProposal({
    assessmentId,
    needId,
    agentId: canonicalAgentId,
    routeContext,
    kind,
    severity,
    need,
    blocks,
    evidenceJson,
    readinessJson,
    rawPayload: {
      source: "propose_work_pattern_experiment_candidate",
      patternKey,
      experimentDefinitionKey,
      fingerprint,
    },
    createdAt,
  });

  return {
    status: "proposed",
    assessmentId,
    needId,
    agentId: canonicalAgentId,
    patternKey,
    experimentDefinitionKey,
    fingerprint,
    reviewRoute,
  };
}
