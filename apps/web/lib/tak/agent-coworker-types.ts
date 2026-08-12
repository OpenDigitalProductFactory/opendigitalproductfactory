import type { CapabilityKey } from "@/lib/permissions";

export type AttachmentInfo = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parsedSummary: string | null;
};

/**
 * Provider/adapter that produced an assistant turn — surfaced in the UI so
 * users can tell which leg of dynamic routing answered (e.g. Codex CLI vs
 * Anthropic API). Sourced from AdapterRunTelemetry joined on agentMessageId,
 * falling back to AgentMessage.providerId for pre-telemetry rows. Omitted
 * when no provider data is available (user messages, system messages,
 * legacy rows).
 */
export type AgentMessageProvider = {
  /** Display name (from ModelProvider.name), e.g. "Anthropic", "ChatGPT". */
  name: string;
  /** Raw provider id (AgentMessage.providerId / telemetry providerId), e.g. "anthropic", "openai", "local". Drives the friendly-label helper; may be null for legacy rows. */
  providerId?: string | null;
  /** Model id used for the call, e.g. "claude-opus-4-7", "gpt-5-codex". May be null when only AgentMessage.providerId is known. */
  modelId: string | null;
  /** Adapter kind from telemetry (e.g. "claude-cli", "anthropic-api", "openai-api"). Null when falling back to AgentMessage.providerId. */
  adapterKind: string | null;
};

/** Serialized message for client/server boundary. */
export type AgentMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentId: string | null;
  routeContext: string | null;
  createdAt: string; // ISO string via .toISOString()
  attachments?: AttachmentInfo[];
  provider?: AgentMessageProvider;
  proposal?: {
    proposalId: string;
    actionType: string;
    parameters: Record<string, unknown>;
    status: string;
    resultEntityId?: string;
    resultError?: string;
  };
};

/** Resolved agent info returned by resolveAgentForRoute. */
export type AgentInfo = {
  agentId: string;
  agentName: string;
  agentDescription: string;
  canAssist: boolean;
  sensitivity: RouteSensitivity;
  systemPrompt: string;
  skills: AgentSkill[];
  modelRequirements?: AgentModelRequirements;
};

/** A context-relevant action the agent can help with. */
export type AgentSkill = {
  label: string;
  description: string;
  capability: CapabilityKey | null;
  prompt: string;
  // Enriched fields (Phase 2 — optional for backward compatibility)
  skillId?: string;
  category?: string;
  tags?: string[];
  riskBand?: string;
  taskType?: string;
  triggerPattern?: string | null;
  userInvocable?: boolean;
  agentInvocable?: boolean;
  allowedTools?: string[];
};

/** Model capability requirements for an agent. */
export type AgentModelRequirements = {
  minCapabilityTier?: string;
  instructionFollowing?: "excellent" | "adequate";
  codingCapability?: "excellent" | "adequate";
  preferredProviderId?: string;
  preferredModelId?: string;
  requiredCapabilities?: Array<"codeExecution" | "webSearch" | "computerUse">;
  /** Minimum dimension scores (0-100). Models below any threshold are excluded from routing. */
  minimumDimensions?: Record<string, number>;
  /** Budget posture for this agent. Overrides the default "balanced". */
  budgetClass?: "minimize_cost" | "balanced" | "quality_first";
  /** EP-INF-012: Default minimum quality tier (fallback when no DB config exists). */
  defaultMinimumTier?: "frontier" | "strong" | "adequate" | "basic";
  /** EP-INF-012: Default budget class (fallback when no DB config exists). */
  defaultBudgetClass?: "minimize_cost" | "balanced" | "quality_first";
  /**
   * EP-INF-013: Default reasoning effort for this agent.
   * Maps to Anthropic thinking.budget_tokens and OpenAI reasoning_effort.
   *   low    — no extended thinking; fast and cheap (COO, status agents)
   *   medium — moderate thinking budget (data extraction, moderate reasoning)
   *   high   — extended thinking (code-gen, multi-step tool use, Build Studio)
   *   max    — maximum budget; Opus-only (reserved for future deep-reasoning agents)
   * Omit to use the platform default (equivalent to "low").
   */
  defaultEffort?: "low" | "medium" | "high" | "max";
};

/** Entry in the route-to-agent map. */
export type RouteAgentEntry = {
  agentId: string;
  agentName: string;
  agentDescription: string;
  capability: CapabilityKey | null;
  sensitivity: RouteSensitivity;
  systemPrompt: string;
  skills: AgentSkill[];
  modelRequirements?: AgentModelRequirements;
};

/** Max message content length (chars). */
export const MAX_MESSAGE_LENGTH = 10000;

/** Validate message input (pure function, usable from tests and server actions). */
export function validateMessageInput(input: {
  content: string;
  routeContext: string;
}): string | null {
  const trimmed = input.content.trim();
  if (!trimmed) return "Message content cannot be empty";
  if (trimmed.length > MAX_MESSAGE_LENGTH) return `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`;
  if (!input.routeContext) return "Route context is required";
  return null;
}
import type { RouteSensitivity } from "@/lib/agent-sensitivity";
