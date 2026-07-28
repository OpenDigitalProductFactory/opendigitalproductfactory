import {
  DEMAND_SCORE_FRAMEWORKS,
  type DemandScoreFramework,
  type DemandStage,
} from "../explore/backlog";
import { resolveEstimateProvenance } from "./estimate-provenance";
import {
  buildDemandActivationState,
  evaluateDemandTransition,
  type DemandActivationInput,
} from "./activation";

export type DemandTransitionRow = {
  id: string;
  itemId: string;
  status: string;
  body: string | null;
  demandStage: string | null;
  demandScoreFramework: string | null;
  reach: number | null;
  occurrenceCount: number | null;
  impact: number | null;
  confidence: number | null;
  businessValue: number | null;
  timeCriticality: number | null;
  riskOpportunity: number | null;
  jobSize: number | null;
  effortSize: string | null;
  investmentBucket: string | null;
  estimateAiJobSize: number | null;
  estimateHumanJobSize: number | null;
  estimateAgreed: boolean | null;
  demandEvidenceLinks: Array<{ id: string }>;
};

type DemandTransitionTx = {
  backlogItem: {
    update: (args: unknown) => Promise<unknown>;
  };
  backlogItemActivity: {
    create: (args: unknown) => Promise<unknown>;
  };
};

export type DemandTransitionDb = DemandTransitionTx & {
  backlogItem: DemandTransitionTx["backlogItem"] & {
    findUnique: (args: unknown) => Promise<DemandTransitionRow | null>;
  };
  $transaction: <T>(
    work: (tx: DemandTransitionTx) => Promise<T>,
  ) => Promise<T>;
};

export type TransitionDemandItemInput = {
  itemId: string;
  to: DemandStage;
  rationale?: string | null;
  recordedByUserId?: string | null;
  recordedByAgentId?: string | null;
  fundingDecisionAllowed?: boolean;
};

export type TransitionDemandItemResult =
  | {
      ok: true;
      itemId: string;
      from: string;
      to: DemandStage;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export function demandActivationInputFromRow(
  row: DemandTransitionRow,
  fundingDecisionAllowed = false,
): DemandActivationInput {
  const framework = (
    DEMAND_SCORE_FRAMEWORKS as readonly string[]
  ).includes(row.demandScoreFramework ?? "")
    ? (row.demandScoreFramework as DemandScoreFramework)
    : "rice";
  const estimate = resolveEstimateProvenance({
    aiJobSize: row.estimateAiJobSize,
    humanJobSize: row.estimateHumanJobSize,
    agreed: row.estimateAgreed,
  });
  return {
    demandStage: row.demandStage,
    status: row.status,
    problemStatement: row.body,
    evidenceCount: row.demandEvidenceLinks.length,
    framework,
    scoreInputs: {
      reach: row.reach,
      occurrenceCount: row.occurrenceCount,
      impact: row.impact,
      confidence: row.confidence,
      businessValue: row.businessValue,
      timeCriticality: row.timeCriticality,
      riskOpportunity: row.riskOpportunity,
      jobSize: row.jobSize,
      effortSize: row.effortSize,
    },
    investmentBucket: row.investmentBucket,
    estimateSource: estimate.source,
    estimateAgreed: row.estimateAgreed,
    estimateDiverged: estimate.diverged,
    fundingDecisionAllowed,
  };
}

export async function loadDemandActivation(
  db: DemandTransitionDb,
  itemId: string,
): Promise<
  | {
      row: DemandTransitionRow;
      input: DemandActivationInput;
      state: ReturnType<typeof buildDemandActivationState>;
    }
  | null
> {
  const row = await db.backlogItem.findUnique({
    where: { itemId },
    select: {
      id: true,
      itemId: true,
      status: true,
      body: true,
      demandStage: true,
      demandScoreFramework: true,
      reach: true,
      occurrenceCount: true,
      impact: true,
      confidence: true,
      businessValue: true,
      timeCriticality: true,
      riskOpportunity: true,
      jobSize: true,
      effortSize: true,
      investmentBucket: true,
      estimateAiJobSize: true,
      estimateHumanJobSize: true,
      estimateAgreed: true,
      demandEvidenceLinks: {
        where: { status: "active" },
        select: { id: true },
      },
    },
  });
  if (!row) return null;
  const activation = demandActivationInputFromRow(row);
  return {
    row,
    input: activation,
    state: buildDemandActivationState(activation),
  };
}

export async function transitionDemandItem(
  db: DemandTransitionDb,
  input: TransitionDemandItemInput,
): Promise<TransitionDemandItemResult> {
  const itemId = input.itemId.trim();
  if (!itemId) {
    return { ok: false, code: "item-required", message: "itemId is required." };
  }
  const loaded = await loadDemandActivation(db, itemId);
  if (!loaded) {
    return { ok: false, code: "not-found", message: `Demand ${itemId} was not found.` };
  }
  const { row } = loaded;

  const stateInput = demandActivationInputFromRow(
    row,
    input.fundingDecisionAllowed === true,
  );
  const decision = evaluateDemandTransition(
    stateInput,
    input.to,
    input.rationale,
  );
  if (!decision.allowed) {
    return { ok: false, code: decision.code, message: decision.message };
  }
  const state = buildDemandActivationState(stateInput);
  await db.$transaction(async (tx) => {
    await tx.backlogItem.update({
      where: { id: row.id },
      data: { demandStage: input.to },
    });
    await tx.backlogItemActivity.create({
      data: {
        backlogItemId: row.id,
        kind: "demand_stage_transition",
        summary: `${decision.from} → ${input.to}`,
        payload: {
          from: decision.from,
          to: input.to,
          rationale: input.rationale?.trim() || null,
          framework: state.score.framework,
          score: state.score.score,
          inputs: state.score.contributions,
          missing: state.score.missing,
          confidence: state.score.confidence,
          evidenceCount: state.score.evidenceCount,
          effectiveJobSize: state.score.effectiveJobSize,
          estimateSource: state.score.estimateSource,
          provisional: state.score.provisional,
          investmentBucket: stateInput.investmentBucket,
        },
        recordedById: input.recordedByUserId ?? null,
        recordedByAgentId: input.recordedByAgentId ?? null,
      },
    });
  });
  return { ok: true, itemId: row.itemId, from: decision.from, to: input.to };
}
