import {
  CHANGE_REVIEW_POLICY_VERSION,
  CHANGE_REVIEWER_VERSION,
  assessSemanticReviewReceiptFreshness,
  buildSemanticChangeReviewPrompt,
  createLowRiskAutoPassReceipt,
  createSemanticReviewReceipt,
  projectSemanticReviewReceipt,
  type SemanticReviewIdentity,
  type SemanticReviewReceipt,
  type SemanticReviewResult,
  type SemanticReviewRisk,
  type SemanticReviewStaleReason,
} from "./semantic-change-review";
import {
  decideExternalReviewActivation,
  type DeliberationArtifactType,
  type StrategyProfile,
} from "@/lib/deliberation/external-review-activation";

export const SEMANTIC_CHANGE_REVIEW_MAX_REPAIR_ROUNDS = 2;

export type SemanticChangeReviewSurface = "external" | "build-studio";
export type SemanticChangeReviewMode = "shadow" | "enforce";

export interface SemanticChangeReviewOperationInput {
  surface: SemanticChangeReviewSurface;
  authorSurface: string;
  artifactType: DeliberationArtifactType;
  title: string;
  artifact: string;
  verificationEvidence: string;
  changedFiles: readonly string[];
  identity: Omit<SemanticReviewIdentity, "policyVersion" | "reviewerVersion"> &
    Partial<Pick<SemanticReviewIdentity, "policyVersion" | "reviewerVersion">>;
  priorReceipt?: SemanticReviewReceipt | null;
  repairRound?: number;
  risk?: SemanticReviewRisk;
  sensitivityFloor?: StrategyProfile;
  mode?: SemanticChangeReviewMode;
}

export interface SemanticChangeReviewDispatchContext {
  strategyProfile: StrategyProfile;
  reviewerId: "change-reviewer";
  specialistIds: readonly string[];
  surface: SemanticChangeReviewSurface;
}

export interface SemanticChangeReviewOperationDeps {
  dispatch(
    prompt: string,
    context: SemanticChangeReviewDispatchContext,
  ): Promise<SemanticReviewResult>;
}

export interface SemanticChangeReviewOperationResult {
  receipt: SemanticReviewReceipt;
  evidence: ReturnType<typeof projectSemanticReviewReceipt>;
  activation: ReturnType<typeof decideExternalReviewActivation>;
  staleReasons: SemanticReviewStaleReason[];
  reusedFreshReceipt: boolean;
  repairLimitReached: boolean;
  mayPublish: boolean;
  nextAction: "publish" | "repair" | "retry-review" | "operator-review" | "shadow-observe";
}

const DOC_ONLY_PATH = /^(?:docs\/|[^/]+\.md$)|\.(?:md|mdx|txt)$/i;
const RUNTIME_CODE_PATH = /\.(?:[cm]?[jt]sx?|vue|svelte|py|go|rs|java|kt|sql|prisma|sh|ps1)$/i;

function docsOnly(files: readonly string[]): boolean {
  return files.length > 0 && files.every((file) => DOC_ONLY_PATH.test(file.replaceAll("\\", "/")));
}

function includesRuntimeCode(files: readonly string[]): boolean {
  return files.some((file) => RUNTIME_CODE_PATH.test(file.replaceAll("\\", "/")));
}

export function resolveSemanticReviewRisk(
  input: SemanticChangeReviewOperationInput,
): SemanticReviewRisk {
  if (input.risk) return input.risk;
  if (docsOnly(input.changedFiles)) return "low";
  if (input.artifactType === "code-change" || includesRuntimeCode(input.changedFiles)) return "high";
  return "medium";
}

export function resolveSemanticReviewCoordination(input: SemanticChangeReviewOperationInput): {
  identity: SemanticReviewIdentity;
  risk: SemanticReviewRisk;
} {
  const specialistIds = [...new Set([
    ...input.identity.specialistIds,
    ...selectSemanticReviewSpecialists(input.changedFiles),
  ])].sort();
  const identity: SemanticReviewIdentity = {
    ...input.identity,
    policyVersion: input.identity.policyVersion ?? CHANGE_REVIEW_POLICY_VERSION,
    reviewerVersion: input.identity.reviewerVersion ?? CHANGE_REVIEWER_VERSION,
    specialistIds,
  };
  requireStableIdentity(identity);
  return { identity, risk: resolveSemanticReviewRisk(input) };
}

/**
 * Content-scoped branches reuse the already-governed dormant specialists from
 * BI-663A6346. This selector contributes reviewer identities to receipt
 * freshness; dispatch adapters decide how to execute the branches.
 */
export function selectSemanticReviewSpecialists(changedFiles: readonly string[]): string[] {
  const specialists = new Set<string>();
  for (const original of changedFiles) {
    const file = original.replaceAll("\\", "/").toLowerCase();
    if (/\.(?:tsx|jsx|css|scss)$/.test(file)) specialists.add("AGT-903");
    if (file.includes("/prisma/") || /(?:schema\.prisma|migration\.sql)$/.test(file)) {
      specialists.add("AGT-902");
    }
    if (/(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(file)) {
      specialists.add("AGT-131");
    }
    if (file.includes("/architecture/") || /(?:^|\/)(?:agents\.md|.*(?:spec|plan).*\.md)$/.test(file)) {
      specialists.add("AGT-181");
    }
  }
  return [...specialists].sort();
}

function requireStableIdentity(identity: SemanticReviewIdentity): void {
  if (
    !identity.capsuleId.trim() ||
    !identity.baseTreeHash.trim() ||
    !identity.headTreeHash.trim() ||
    !identity.diffDigest.trim()
  ) {
    throw new Error("Semantic change review requires a stable committed tree identity before publication.");
  }
}

function resultForReceipt(args: {
  receipt: SemanticReviewReceipt;
  activation: ReturnType<typeof decideExternalReviewActivation>;
  staleReasons?: SemanticReviewStaleReason[];
  reusedFreshReceipt?: boolean;
  repairRound: number;
  mode: SemanticChangeReviewMode;
}): SemanticChangeReviewOperationResult {
  const failed = args.receipt.result.decision === "fail";
  const inconclusive = args.receipt.result.decision === "inconclusive";
  const repairLimitReached = failed && args.repairRound >= SEMANTIC_CHANGE_REVIEW_MAX_REPAIR_ROUNDS;
  const mayPublish = args.mode === "shadow" || (!failed && !inconclusive);
  const nextAction: SemanticChangeReviewOperationResult["nextAction"] = args.mode === "shadow" && (failed || inconclusive)
    ? "shadow-observe"
    : inconclusive
      ? "retry-review"
    : repairLimitReached
      ? "operator-review"
      : failed
        ? "repair"
        : "publish";
  return {
    receipt: args.receipt,
    evidence: projectSemanticReviewReceipt(args.receipt),
    activation: args.activation,
    staleReasons: args.staleReasons ?? [],
    reusedFreshReceipt: args.reusedFreshReceipt ?? false,
    repairLimitReached,
    mayPublish,
    nextAction,
  };
}

export async function runSemanticChangeReview(
  input: SemanticChangeReviewOperationInput,
  deps: SemanticChangeReviewOperationDeps,
): Promise<SemanticChangeReviewOperationResult> {
  const { identity, risk } = resolveSemanticReviewCoordination(input);
  const activation = decideExternalReviewActivation({
    artifactType: input.artifactType,
    authorSurface: input.authorSurface,
    risk,
    sensitivityFloor: input.sensitivityFloor,
  });
  const repairRound = Math.max(0, input.repairRound ?? 0);
  const mode = input.mode ?? "enforce";

  if (input.priorReceipt) {
    const freshness = assessSemanticReviewReceiptFreshness(input.priorReceipt, identity);
    if (freshness.fresh && input.priorReceipt.result.decision !== "inconclusive") {
      return resultForReceipt({
        receipt: input.priorReceipt,
        activation,
        reusedFreshReceipt: true,
        repairRound,
        mode,
      });
    }
    const reviewed = await performReview({ input, identity, activation, risk, deps });
    return resultForReceipt({
      receipt: reviewed,
      activation,
      staleReasons: freshness.reasons,
      repairRound,
      mode,
    });
  }

  if (!activation.activate) {
    const receipt = createLowRiskAutoPassReceipt({ identity, rationale: activation.reason });
    return resultForReceipt({ receipt, activation, repairRound, mode });
  }

  const receipt = await performReview({ input, identity, activation, risk, deps });
  return resultForReceipt({ receipt, activation, repairRound, mode });
}

async function performReview(args: {
  input: SemanticChangeReviewOperationInput;
  identity: SemanticReviewIdentity;
  activation: ReturnType<typeof decideExternalReviewActivation>;
  risk: SemanticReviewRisk;
  deps: SemanticChangeReviewOperationDeps;
}): Promise<SemanticReviewReceipt> {
  const prompt = buildSemanticChangeReviewPrompt({
    title: args.input.title,
    artifact: args.input.artifact,
    verificationEvidence: args.input.verificationEvidence,
  });
  const result = await args.deps.dispatch(prompt, {
    strategyProfile: args.activation.strategyProfile,
    reviewerId: "change-reviewer",
    specialistIds: args.identity.specialistIds,
    surface: args.input.surface,
  });
  return createSemanticReviewReceipt({
    identity: args.identity,
    disposition: "reviewed",
    risk: args.risk,
    result,
    rationale: args.activation.reason,
  });
}
