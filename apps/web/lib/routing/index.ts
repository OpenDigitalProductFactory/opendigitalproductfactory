export type {
  SensitivityLevel,
  EndpointManifest,
  TaskRequirementContract,
  PolicyRuleEval,
  PolicyCondition,
  CandidateTrace,
  RouteDecision,
  EndpointOverride,
  BuiltinDimension,
} from "./types";
export { BUILTIN_DIMENSIONS } from "./types";
export { routeEndpoint, filterHard, filterByPolicy } from "./pipeline";
export { computeFitness, normalizeWeights } from "./scoring";
export { formatDecisionForUser } from "./explain";
export {
  loadEndpointManifests,
  loadTaskRequirement,
  loadPolicyRules,
  loadOverrides,
  persistRouteDecision,
} from "./loader";
export { callWithFallbackChain } from "./fallback";
export type { FallbackResult } from "./fallback";
export { runDimensionEval, runAllDimensionEvals, computeNewScore, detectDrift } from "./eval-runner";
export type { EvalRunResult } from "./eval-runner";
export { scoreDimension } from "./eval-scoring";
export { GOLDEN_TESTS, getTestsForDimension } from "./golden-tests";
export { updateEndpointDimensionScores } from "./production-feedback";
export { getBaselineForModel } from "./family-baselines";
export type { FamilyBaseline } from "./family-baselines";
export { extractModelMetadata } from "./metadata-extractor";
export type { ExtractedMetadata } from "./metadata-extractor";

// EP-INF-004: Rate limits & capacity
export type { CapacityStatus } from "./rate-tracker";
export {
  recordRequest,
  checkModelCapacity,
  setModelLimits,
  learnFromRateLimitResponse,
  extractRetryAfterMs,
} from "./rate-tracker";
export { scheduleRecovery, cancelRecovery } from "./rate-recovery";

// EP-INF-003: ModelCard types and adapter registry
export type { ModelCard, ModelCardCapabilities, ModelCardPricing, ModelClass, ModelCardDimensionScores } from "./model-card-types";
export { EMPTY_CAPABILITIES, EMPTY_PRICING, DEFAULT_DIMENSION_SCORES } from "./model-card-types";
export type { ProviderAdapter, DiscoveredModelEntry } from "./adapter-interface";
export { getAdapter, extractModelCardWithFallback } from "./adapter-registry";
export { classifyModel } from "./model-classifier";
export { computeMetadataHash } from "./metadata-hash";

// EP-INF-005a: Contract-based selection
export type { RequestContract } from "./request-contract";
export { inferContract } from "./request-contract";
export { estimateCost, estimateSuccessProbability, rankByCostPerSuccess } from "./cost-ranking";
export { routeEndpointV2 } from "./pipeline-v2";

// EP-INF-005b: Execution recipes
export type { RoutedExecutionPlan, RecipeRow } from "./recipe-types";
export { buildPlanFromRecipe, buildDefaultPlan } from "./execution-plan";
export { buildSeedRecipe } from "./recipe-seeder";
export { loadChampionRecipe } from "./recipe-loader";

// EP-INF-006: Adaptive loop
export type { RewardWeights, OutcomeSignals } from "./reward";
export { computeReward, DEFAULT_REWARD_WEIGHTS } from "./reward";
export { recordRouteOutcome } from "./route-outcome";
export { updateRecipePerformance } from "./recipe-performance";
export { selectRecipeWithExploration, evaluatePromotions, promoteChallenger } from "./champion-challenger";
export { shouldRunGoldenTests } from "./golden-realignment";

// EP-INF-008a: Execution adapter framework
export type { ExecutionAdapterHandler, AdapterRequest, AdapterResult, ResolvedProvider, ToolCallEntry } from "./adapter-types";
export { registerExecutionAdapter, getExecutionAdapter } from "./execution-adapter-registry";
export { chatAdapter } from "./chat-adapter";

// EP-INF-008b: Provider tools
export { buildProviderTools } from "./provider-tools";
export { isAnthropic, isOpenAI } from "./provider-utils";
