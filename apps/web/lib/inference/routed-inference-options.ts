import type { ActivityContract } from "@/lib/routing/activity-contract";
import type { ModelClass } from "@/lib/routing/model-card-types";
import type { RequestContract } from "@/lib/routing/request-contract";
import type { RouteDecisionActor } from "@/lib/routing/route-decision-attribution";
import type {
  AsyncOperationAuthorityActor,
  AsyncOperationAuthorityRequest,
} from "./async-operation-authority";

/** Caller-owned constraints and preferences for canonical routing plus dispatch. */
export interface RouteAndCallOptions {
  /**
   * Exact spans of `systemPrompt` that are platform-authored INSTRUCTION rather
   * than the turn's data (BI-463BE12A / BI-9C14CB5D). Supplied by whoever knows
   * the provenance — the prompt assembler for its static blocks, the calling
   * surface for the coworker persona. Anything unlabelled is classified as data,
   * so omitting this is the safe default and changes nothing.
   */
  systemPromptInstructionSpans?: string[];
  /** What each entry of `messages` is — a label per index, never content. */
  messageOrigins?: readonly import(
    "@/lib/inference/data-screening/types"
  ).MessageOrigin[];
  tools?: Array<Record<string, unknown>>;
  taskType?: string;
  preferredProviderId?: string;
  preferredModelId?: string;
  requiresCodeExecution?: boolean;
  requiresWebSearch?: boolean;
  requiresComputerUse?: boolean;
  budgetClass?: "minimize_cost" | "balanced" | "quality_first";
  /** Hard provider boundary compiled by caller-owned policy/readiness. */
  allowedProviders?: string[];
  /** Providers explicitly forbidden by caller-owned policy. */
  deniedProviders?: string[];
  /** Hard residency boundary. Never widened by fallback. */
  residencyPolicy?: RequestContract["residencyPolicy"];
  /** Optional system prompt text for side-effect-free route previews that need data screening parity. */
  screeningSystemPrompt?: string;
  /** Live governed-version reader, invoked again immediately before each provider attempt. */
  inferencePolicyVersionSource?: import(
    "@/lib/inference/data-screening/screen-inference-payload"
  ).ScreenInferencePayloadInput["policyVersionSource"];
  /**
   * Whether exact sensitive values are replaceable for this task. Unknown is
   * fail-closed and never authorizes a transform.
   */
  sensitiveDetailUse?: import(
    "@/lib/govern/data/mask-for-context"
  ).SensitiveDetailUse;
  /**
   * Immutable actor/subject/final-surface intent for a later response PEP.
   * Screening derives sensitivity and decision versions; this never authorizes
   * automatic rehydration inside the routing or provider-dispatch boundary.
   */
  responseRehydration?: import(
    "@/lib/govern/data/rehydration-token-vault"
  ).RehydrationRouteBinding | readonly import(
    "@/lib/govern/data/rehydration-token-vault"
  ).RehydrationRouteBinding[];
  modelTier?: "local" | "robust";
  minimumDimensions?: Record<string, number>;
  requiredModelClass?: ModelClass;
  interactionMode?: "sync" | "background";
  /**
   * Semantic authority for a durable async route. The server resolves this to
   * the exact TaskRun/Workroom row; callers cannot pass an internal scope key.
   */
  durableAsyncOperation?: {
    request: AsyncOperationAuthorityRequest;
    actor: AsyncOperationAuthorityActor;
    /** Closed callers can constrain the selected plan before durable admission. */
    expectedExecution?: {
      providerId: string;
      contractFamily: string;
      executionAdapter: "async";
      explorationMode: "champion";
      plans: readonly {
        recipeId: string;
        modelId: string;
        maxTokens: number;
        providerSettings: Readonly<Record<string, unknown>>;
        toolPolicy: Readonly<Record<string, unknown>>;
        responsePolicy: Readonly<Record<string, unknown>>;
      }[];
    };
    /** The closed caller persists its TaskRun projection before the first wake. */
    deferInitialWake?: boolean;
  };
  threadId?: string;
  maxDurationMs?: number;
  persistDecision?: boolean;
  /** Forbid capability degradation that strips required tools. */
  requireTools?: boolean;
  /**
   * Caller-owned function-call requirement. `required` is stronger than
   * `requireTools`: the endpoint must not return a prose-only completion while
   * a governed terminal action is pending.
   */
  toolChoice?: "auto" | "required" | "none";
  /** Exact sole writer guarded by the caller's terminal-tool policy. */
  terminalWriterToolName?: string;
  minimumCapabilities?: import("@/lib/routing/agent-capability-types").AgentMinimumCapabilities;
  agentMinimumContextTokens?: number;
  agentId?: string;
  agentMessageId?: string;
  /** FeatureBuild this call belongs to. Threaded into AdapterRunTelemetry so
   *  completeBuildPhaseRun can aggregate per-phase tokens/cost (BI-0A6B8B38). */
  buildId?: string;
  routingActor?: RouteDecisionActor;
  /**
   * Portal route this call originates from, e.g. "/customer/marketing".
   * Persisted on the RouteDecisionLog so a declared-vs-measured sensitivity
   * drift is attributable to the route-context entry that declared the level,
   * rather than only to the agent that happened to be on that page.
   */
  routeContext?: string;
  effort?: "low" | "medium" | "high" | "max";
  previousResponseId?: string;
  activityContract?: ActivityContract;
  agentDisplayName?: string;
  mcpSession?: import("@/lib/routing/adapter-types").AdapterMcpSession;
}
