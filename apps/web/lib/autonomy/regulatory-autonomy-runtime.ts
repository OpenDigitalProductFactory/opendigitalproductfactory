import {
  isProfessionJurisdictionBasis,
  type ProfessionJurisdictionBasis,
} from "@dpf/db/wiki-taxonomy";
import type { RegionProfile } from "@dpf/db/regulation-applicability";

import type { AutonomyLevel, RiskClass } from "./trust-graduation";
import {
  computeTrustStateFromLedger,
  type ComputedTrustState,
} from "./trust-state";
import {
  resolveRegulatoryAutonomyCeiling,
  type RegulatoryAutonomyCeilingResolution,
  type RegulatoryAutonomyPolicyRecord,
} from "./regulatory-ceiling";

type BusinessContextRegionRow = {
  operatesIn?: string[] | null;
  sellsTo?: string[] | null;
  employsIn?: string[] | null;
  dataResidency?: string[] | null;
  industry?: string | null;
};

type StorefrontArchetypeRow = {
  archetype?: {
    category?: string | null;
  } | null;
} | null;

type RegulatoryAutonomyPolicyDbRow = {
  policyId: string;
  policyKey?: string | null;
  version?: number | null;
  status: string;
  industry?: string | null;
  jurisdiction: string;
  jurisdictionBasis: string;
  activityClass: string;
  maxAutonomyLevel: string;
  humanControlRequired?: boolean | null;
  requiredEvidence?: unknown;
  effectiveFrom?: Date | string | null;
  effectiveUntil?: Date | string | null;
};

type LedgerAgreementRow = {
  ledgerId: string;
  agreement: boolean | null;
  observedAt?: Date | string | null;
};

type TrustStateRow = {
  currentLevel?: string | null;
};

export type RegulatoryAutonomyRuntimeDb = {
  businessContext: {
    findFirst(args: unknown): Promise<BusinessContextRegionRow | null>;
  };
  storefrontConfig: {
    findFirst(args: unknown): Promise<StorefrontArchetypeRow>;
  };
  regulatoryAutonomyPolicy: {
    findMany(args: unknown): Promise<RegulatoryAutonomyPolicyDbRow[]>;
  };
  decisionShadowLedger: {
    upsert(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<LedgerAgreementRow[]>;
  };
  trustState: {
    findUnique(args: unknown): Promise<TrustStateRow | null>;
    upsert(args: unknown): Promise<unknown>;
  };
};

export type RuntimeRegulatoryAutonomyCeiling = {
  activityClass: string;
  asOf: Date;
  profile: RegionProfile;
  industry: string | null;
  policies: RegulatoryAutonomyPolicyRecord[];
  resolution: RegulatoryAutonomyCeilingResolution;
};

export type RegulatoryDecisionShadowTrial = {
  trialId?: string | null;
  candidateDecision: unknown;
  actualDecision: unknown;
  outcome?: unknown;
  agreement: boolean;
  observedAt?: Date | string | null;
  rationale?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type RecordRegulatoryDecisionShadowEvidenceResult = {
  ledgerIds: string[];
  regulatoryEvidence: Record<string, unknown>;
  trustState: ComputedTrustState | null;
};

const DEFAULT_WINDOW_SIZE = 100;

function stringArray(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry) => entry.trim().length > 0) : [];
}

function asOfDate(value?: Date | string | null): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}

function dateOr(value: Date | string | null | undefined, fallback: Date): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return fallback;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function normalizePolicy(row: RegulatoryAutonomyPolicyDbRow): RegulatoryAutonomyPolicyRecord {
  const jurisdictionBasis: ProfessionJurisdictionBasis = isProfessionJurisdictionBasis(row.jurisdictionBasis)
    ? row.jurisdictionBasis
    : "global";
  return {
    policyId: row.policyId,
    policyKey: row.policyKey,
    version: row.version,
    status: row.status,
    industry: row.industry,
    jurisdiction: row.jurisdiction,
    jurisdictionBasis,
    activityClass: row.activityClass,
    maxAutonomyLevel: row.maxAutonomyLevel,
    humanControlRequired: row.humanControlRequired,
    requiredEvidence: row.requiredEvidence,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function trialKey(trial: RegulatoryDecisionShadowTrial, index: number): string {
  const raw = trial.trialId?.trim() || String(index + 1);
  return raw.replace(/\s+/g, "-");
}

function primaryPolicyId(resolution: RegulatoryAutonomyCeilingResolution): string | null {
  const ids = resolution.matchedPolicies
    .map((policy) => policy.policyId)
    .filter((policyId) => policyId.trim().length > 0)
    .sort();
  return ids[0] ?? null;
}

function regulatoryEvidenceFor(runtime: RuntimeRegulatoryAutonomyCeiling): Record<string, unknown> {
  return {
    activityClass: runtime.activityClass,
    asOf: runtime.asOf.toISOString(),
    ceiling: runtime.resolution.ceiling,
    defaulted: runtime.resolution.defaulted,
    humanControlRequired: runtime.resolution.humanControlRequired,
    requiredEvidence: runtime.resolution.requiredEvidence,
    matchedPolicyIds: runtime.resolution.matchedPolicies.map((policy) => policy.policyId),
    matchedBasis: runtime.resolution.matchedBasis,
    reason: runtime.resolution.reason,
    industry: runtime.industry,
    profile: runtime.profile,
  };
}

export async function resolveRuntimeRegulatoryAutonomyCeiling(
  db: RegulatoryAutonomyRuntimeDb,
  input: {
    activityClass: string;
    asOf?: Date | string | null;
    industry?: string | null;
    profile?: RegionProfile | null;
  },
): Promise<RuntimeRegulatoryAutonomyCeiling> {
  const asOf = asOfDate(input.asOf);
  const [businessContext, storefront, policies] = await Promise.all([
    input.profile
      ? Promise.resolve(null)
      : db.businessContext.findFirst({
          select: {
            operatesIn: true,
            sellsTo: true,
            employsIn: true,
            dataResidency: true,
            industry: true,
          },
        }),
    db.storefrontConfig.findFirst({
      select: {
        archetype: {
          select: { category: true },
        },
      },
    }),
    db.regulatoryAutonomyPolicy.findMany({
      where: {
        status: "active",
        effectiveFrom: { lte: asOf },
        OR: [
          { effectiveUntil: null },
          { effectiveUntil: { gt: asOf } },
        ],
      },
    }),
  ]);
  const archetype = storefront?.archetype?.category ?? undefined;
  const profile: RegionProfile = input.profile ?? {
    operatesIn: stringArray(businessContext?.operatesIn),
    sellsTo: stringArray(businessContext?.sellsTo),
    employsIn: stringArray(businessContext?.employsIn),
    dataResidency: stringArray(businessContext?.dataResidency),
    archetype,
  };
  const industry = firstNonEmpty(input.industry, archetype, businessContext?.industry);
  const normalizedPolicies = policies.map(normalizePolicy);
  return {
    activityClass: input.activityClass,
    asOf,
    profile,
    industry,
    policies: normalizedPolicies,
    resolution: resolveRegulatoryAutonomyCeiling({
      policies: normalizedPolicies,
      profile,
      industry,
      activityClass: input.activityClass,
      asOf,
    }),
  };
}

export async function recordRegulatoryDecisionShadowEvidence(
  db: RegulatoryAutonomyRuntimeDb,
  input: {
    agentId: string;
    activityType: string;
    riskClass: RiskClass;
    currentLevel: AutonomyLevel;
    decisionInteractionId: string;
    regulatory: RuntimeRegulatoryAutonomyCeiling;
    trials: readonly RegulatoryDecisionShadowTrial[];
    taskRunId?: string | null;
    toolExecutionId?: string | null;
    windowSize?: number | null;
  },
): Promise<RecordRegulatoryDecisionShadowEvidenceResult> {
  if (input.trials.length === 0) {
    return {
      ledgerIds: [],
      regulatoryEvidence: regulatoryEvidenceFor(input.regulatory),
      trustState: null,
    };
  }

  const regulatoryEvidence = regulatoryEvidenceFor(input.regulatory);
  const regulatoryPolicyId = primaryPolicyId(input.regulatory.resolution);
  const ledgerIds: string[] = [];

  for (const [index, trial] of input.trials.entries()) {
    const ledgerId = `${input.decisionInteractionId}:${trialKey(trial, index)}`;
    ledgerIds.push(ledgerId);
    const observedAt = dateOr(trial.observedAt, input.regulatory.asOf);
    const data = {
      agentId: input.agentId,
      activityType: input.activityType,
      riskClass: input.riskClass,
      autonomyLevel: input.currentLevel,
      proposedDecision: jsonObject(trial.candidateDecision),
      rationale: trial.rationale ?? null,
      actualDecision: jsonObject(trial.actualDecision),
      outcome: trial.outcome == null ? null : jsonObject(trial.outcome),
      agreement: trial.agreement,
      sourceKind: "work-pattern-shadow-trial",
      taskRunId: input.taskRunId ?? null,
      toolExecutionId: input.toolExecutionId ?? null,
      decisionInteractionId: input.decisionInteractionId,
      regulatoryPolicyId,
      regulatoryEvidence,
      metadata: {
        ...(trial.metadata ?? {}),
        trialId: trial.trialId ?? null,
        runtimeConsumer: "regulatory-autonomy",
      },
      observedAt,
      reconciledAt: observedAt,
    };

    await db.decisionShadowLedger.upsert({
      where: { ledgerId },
      update: data,
      create: {
        ledgerId,
        ...data,
      },
    });
  }

  const rows = await db.decisionShadowLedger.findMany({
    where: {
      agentId: input.agentId,
      activityType: input.activityType,
      riskClass: input.riskClass,
    },
    orderBy: { observedAt: "desc" },
    take: input.windowSize ?? DEFAULT_WINDOW_SIZE,
    select: {
      ledgerId: true,
      agreement: true,
      observedAt: true,
    },
  });
  const existing = await db.trustState.findUnique({
    where: {
      agentId_activityType_riskClass: {
        agentId: input.agentId,
        activityType: input.activityType,
        riskClass: input.riskClass,
      },
    },
    select: { currentLevel: true },
  });
  const currentLevel =
    existing?.currentLevel === "shadow" ||
    existing?.currentLevel === "propose" ||
    existing?.currentLevel === "supervised" ||
    existing?.currentLevel === "autopilot"
      ? existing.currentLevel
      : input.currentLevel;
  const trustState = computeTrustStateFromLedger({
    agentId: input.agentId,
    activityType: input.activityType,
    riskClass: input.riskClass,
    currentLevel,
    regulatoryCeiling: input.regulatory.resolution.ceiling,
    rows,
  });
  const lastLedgerId = rows[0]?.ledgerId ?? null;
  const trustStateData = {
    currentLevel: trustState.currentLevel,
    regulatoryCeiling: trustState.regulatoryCeiling,
    sampleCount: trustState.window.samples,
    agreementCount: trustState.window.agreements,
    agreementRate: trustState.agreementRate,
    lastLedgerId,
    recommendation: trustState.recommendation,
    lastEvaluatedAt: new Date(),
  };

  await db.trustState.upsert({
    where: {
      agentId_activityType_riskClass: {
        agentId: input.agentId,
        activityType: input.activityType,
        riskClass: input.riskClass,
      },
    },
    create: {
      agentId: input.agentId,
      activityType: input.activityType,
      riskClass: input.riskClass,
      ...trustStateData,
    },
    update: trustStateData,
  });

  return {
    ledgerIds,
    regulatoryEvidence,
    trustState,
  };
}
