import type { ActivityContract } from "@/lib/routing/activity-contract";
import type { ModelClass } from "@/lib/routing/model-card-types";
import type { RequestContract } from "@/lib/routing/request-contract";
import type { RouteDecisionActor } from "@/lib/routing/route-decision-attribution";

/** Caller-owned constraints and preferences for canonical routing plus dispatch. */
export interface RouteAndCallOptions {
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
  modelTier?: "local" | "robust";
  minimumDimensions?: Record<string, number>;
  requiredModelClass?: ModelClass;
  interactionMode?: "sync" | "background";
  threadId?: string;
  maxDurationMs?: number;
  persistDecision?: boolean;
  /** Forbid capability degradation that strips required tools. */
  requireTools?: boolean;
  minimumCapabilities?: import("@/lib/routing/agent-capability-types").AgentMinimumCapabilities;
  agentMinimumContextTokens?: number;
  agentId?: string;
  agentMessageId?: string;
  /** FeatureBuild this call belongs to. Threaded into AdapterRunTelemetry so
   *  completeBuildPhaseRun can aggregate per-phase tokens/cost (BI-0A6B8B38). */
  buildId?: string;
  routingActor?: RouteDecisionActor;
  effort?: "low" | "medium" | "high" | "max";
  previousResponseId?: string;
  activityContract?: ActivityContract;
  agentDisplayName?: string;
  mcpSession?: import("@/lib/routing/adapter-types").AdapterMcpSession;
}
