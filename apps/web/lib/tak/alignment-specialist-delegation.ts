import { randomUUID } from "crypto";
import { prisma } from "@dpf/db";

import type {
  AlignmentCorpus,
  ConstitutionalAlignmentResult,
} from "@/lib/decision-perspective/alignment-criteria";

type SpecialistCorpus = Extract<AlignmentCorpus, "portfolio" | "gtm">;
type QualificationStatus = "qualified" | "absent" | "stale" | "out-of-scope";

type ProfessionEvaluation = {
  allowed: boolean;
  interactionId: string;
  professionProfileSelected: boolean;
  professionKey: string | null;
  operatorMessage: string;
  evaluation: {
    outcomeType: string;
    recommendedOptionId?: string | null;
    coverageGap: boolean;
    materialCount: number;
    freshnessDistribution: {
      current: number;
      stale: number;
      superseded: number;
      contradicted: number;
    };
    sources: Array<{ materialId?: string; sourceRef?: unknown }>;
  };
};

type ProfessionEvaluator = (input: {
  agentIdentity: { agentId: string };
  question: string;
  options: string[];
  domainClass: "professional-practice";
  riskTier: "medium";
  routeContext: string;
  triggeredByUserId: string;
}) => Promise<ProfessionEvaluation>;

export type AlignmentDelegationRoute = {
  corpus: SpecialistCorpus;
  agentId: string;
  professionKey: string;
  criterion: "product" | "motion";
  permissionGranted: false;
};

const ROUTES: Record<SpecialistCorpus, AlignmentDelegationRoute> = {
  portfolio: {
    corpus: "portfolio", agentId: "portfolio-backlog-agent",
    professionKey: "portfolio-management", criterion: "product",
    permissionGranted: false,
  },
  gtm: {
    corpus: "gtm", agentId: "marketing-specialist",
    professionKey: "marketing", criterion: "motion",
    permissionGranted: false,
  },
};

export function decideAlignmentDelegation(criteria: {
  product: string | null;
  motion: string | null;
}): AlignmentDelegationRoute[] {
  return [
    ...(criteria.product ? [ROUTES.portfolio] : []),
    ...(criteria.motion ? [ROUTES.gtm] : []),
  ];
}

function qualificationFor(result: ProfessionEvaluation, expectedProfession: string): QualificationStatus {
  if (!result.professionProfileSelected || result.evaluation.coverageGap || result.evaluation.materialCount < 1) {
    return "absent";
  }
  if (result.professionKey !== expectedProfession) return "out-of-scope";
  const freshness = result.evaluation.freshnessDistribution;
  if (freshness.stale > 0 || freshness.superseded > 0 || freshness.contradicted > 0) return "stale";
  if (!result.allowed && result.evaluation.recommendedOptionId !== "rejected") return "absent";
  return "qualified";
}

async function defaultEvaluateProfession(
  input: Parameters<ProfessionEvaluator>[0],
): Promise<ProfessionEvaluation> {
  const { evaluateProfessionDecisionGate } = await import("@/lib/decision-perspective/profession-gate");
  return evaluateProfessionDecisionGate({
    db: prisma,
    ...input,
    options: input.options,
  }) as Promise<ProfessionEvaluation>;
}

async function defaultRecordDelegation(input: {
  fromAgentId: string;
  toAgentId: string;
  originUserId: string;
  reason: string;
}): Promise<string> {
  const chainId = randomUUID();
  await prisma.delegationChain.create({
    data: {
      chainId, depth: 0, fromAgentId: input.fromAgentId, toAgentId: input.toAgentId,
      status: "completed", reason: input.reason, authorityScope: [],
      originUserId: input.originUserId, originAuthority: [], completedAt: new Date(),
    },
  });
  return chainId;
}

export type SpecialistAlignmentCheck = {
  corpus: SpecialistCorpus;
  criterion: "product" | "motion";
  specialistAgentId: string;
  professionKey: string;
  qualification: QualificationStatus;
  verdict: "aligned" | "rejected" | "escalate";
  rationale: string;
  evidenceRefs: string[];
  interactionId: string;
  delegationChainId: string;
  permissionGranted: false;
};

export type SpecialistAlignmentDelegationResult = {
  verdict: "approve" | "decline" | "escalate";
  checks: SpecialistAlignmentCheck[];
  permissionGranted: false;
};

export async function runAlignmentSpecialistDelegation(input: {
  alignment: ConstitutionalAlignmentResult;
  statement: string;
  userId: string;
  coordinatorAgentId: string;
  routeContext?: string;
  evaluateProfession?: ProfessionEvaluator;
  recordDelegation?: typeof defaultRecordDelegation;
}): Promise<SpecialistAlignmentDelegationResult> {
  const routes = decideAlignmentDelegation(input.alignment.criteria.criteria);
  if (routes.length === 0) return { verdict: "escalate", checks: [], permissionGranted: false };
  const evaluateProfession = input.evaluateProfession ?? defaultEvaluateProfession;
  const recordDelegation = input.recordDelegation ?? defaultRecordDelegation;
  const checks: SpecialistAlignmentCheck[] = [];

  for (const route of routes) {
    const delegationChainId = await recordDelegation({
      fromAgentId: input.coordinatorAgentId,
      toAgentId: route.agentId,
      originUserId: input.userId,
      reason: `TAK alignment ${route.corpus}/${route.criterion} WSID check`,
    });
    const result = await evaluateProfession({
      agentIdentity: { agentId: route.agentId },
      question: `Does the proposed action fit the ${route.corpus} corpus? ${input.statement}`,
      options: ["Aligned", "Rejected"],
      domainClass: "professional-practice",
      riskTier: "medium",
      routeContext: input.routeContext ?? "/tak/alignment-specialist",
      triggeredByUserId: input.userId,
    });
    const qualification = qualificationFor(result, route.professionKey);
    const rejected = result.evaluation.recommendedOptionId?.toLowerCase() === "rejected";
    checks.push({
      corpus: route.corpus,
      criterion: route.criterion,
      specialistAgentId: route.agentId,
      professionKey: route.professionKey,
      qualification,
      verdict: qualification !== "qualified" ? "escalate" : rejected ? "rejected" : "aligned",
      rationale: qualification === "qualified"
        ? result.operatorMessage
        : `TAK-JSI ${qualification}: ${route.agentId} cannot supply this ${route.criterion} verdict.`,
      evidenceRefs: result.evaluation.sources
        .map((source) => source.materialId ?? JSON.stringify(source.sourceRef ?? null))
        .filter((ref) => ref !== "null"),
      interactionId: result.interactionId,
      delegationChainId,
      permissionGranted: false,
    });
  }

  return {
    verdict: checks.some((check) => check.verdict === "rejected")
      ? "decline"
      : checks.some((check) => check.verdict === "escalate") ? "escalate" : "approve",
    checks,
    permissionGranted: false,
  };
}
