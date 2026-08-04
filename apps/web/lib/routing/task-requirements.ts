/**
 * EP-INF-012: Built-in task requirement contracts + DB-backed loader.
 *
 * minimumTier maps to the "thinking cap" analogy from Anthropic's adaptive-model
 * guidance: simple tasks (adequate) never touch frontier-tier endpoints; complex
 * tasks (frontier) demand the best available reasoning and tool-calling.
 *
 *   greeting / status-query / summarization → adequate (Haiku-equivalent, effort=low)
 *   data-extraction / web-search / creative  → strong  (Sonnet-equivalent, effort=medium)
 *   tool-action                              → strong  (see the note on its entry)
 *   reasoning / code-gen                     → frontier (Opus/Sonnet, effort=high)
 */

import { prisma } from "@dpf/db";
import type { TaskRequirement } from "./task-router-types";

// ── In-memory cache ────────────────────────────────────────────────────────────

const taskRequirementCache = new Map<string, TaskRequirement>();

// ── Built-in definitions ───────────────────────────────────────────────────────

export const BUILT_IN_TASK_REQUIREMENTS: Record<string, TaskRequirement> = {
  greeting: {
    taskType: "greeting",
    description: "Simple conversational greeting or acknowledgement.",
    selectionRationale: "Simple dialog — any capable model works.",
    requiredCapabilities: {},
    preferredMinScores: { conversational: 40 },
    minimumTier: "adequate",
    preferCheap: true,
    origin: "system",
  },
  "status-query": {
    taskType: "status-query",
    description: "Factual data lookup and status reporting.",
    selectionRationale: "Data lookup — needs accuracy, not depth.",
    requiredCapabilities: {},
    preferredMinScores: { instructionFollowing: 40 },
    minimumTier: "adequate",
    preferCheap: true,
    origin: "system",
  },
  summarization: {
    taskType: "summarization",
    description: "Summarizing a block of text.",
    selectionRationale: "Needs to follow formatting instructions.",
    requiredCapabilities: {},
    preferredMinScores: { instructionFollowing: 50 },
    minimumTier: "adequate",
    preferCheap: true,
    origin: "system",
  },
  "data-extraction": {
    taskType: "data-extraction",
    description: "Extracting structured data (e.g., JSON) from unstructured text.",
    selectionRationale: "Must produce valid structured output reliably.",
    requiredCapabilities: { supportsStructuredOutput: true },
    preferredMinScores: { structuredOutput: 70 },
    minimumTier: "strong",
    preferCheap: true,
    origin: "system",
  },
  "web-search": {
    taskType: "web-search",
    description: "Using a search tool to answer a question.",
    selectionRationale: "Must call search tools correctly.",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { toolFidelity: 60 },
    minimumTier: "strong",
    preferCheap: true,
    origin: "system",
  },
  creative: {
    taskType: "creative",
    description: "Creative writing, brainstorming, or open-ended ideation.",
    selectionRationale: "Needs both creativity and coherence.",
    requiredCapabilities: {},
    preferredMinScores: { conversational: 60, reasoning: 50 },
    minimumTier: "strong",
    preferCheap: false,
    origin: "system",
  },
  reasoning: {
    taskType: "reasoning",
    description: "Complex, multi-step analytical reasoning.",
    selectionRationale: "Complex analysis needs strong reasoning — frontier only.",
    requiredCapabilities: {},
    preferredMinScores: { reasoning: 80 },
    minimumTier: "frontier",
    preferCheap: false,
    origin: "system",
  },
  "code-gen": {
    taskType: "code-gen",
    description: "Generating or modifying source code.",
    selectionRationale: "Code quality is critical — frontier only.",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { codegen: 75, instructionFollowing: 60 },
    minimumTier: "frontier",
    preferCheap: false,
    origin: "system",
  },
  "tool-action": {
    taskType: "tool-action",
    description: "Multi-step tool use with external APIs.",
    // Tool-calling fidelity is what this task actually needs, and the tier floor
    // is a proxy for it. `frontier` (TIER_MINIMUM_DIMENSIONS: codegen/toolFidelity/
    // reasoning all >= 85) over-constrained that proxy: it gates on *reasoning*
    // and *codegen* too, so a model with perfect tool fidelity was excluded for
    // scoring 79 on reasoning. That made restricted-sensitivity tool work
    // unroutable by construction — the only provider cleared for `restricted`
    // data is the bundled local model, and no local model clears an 85 reasoning
    // floor, so employee/finance requests had zero eligible endpoints and
    // surfaced as "No AI model can handle this request right now".
    //
    // `strong` (>= 70) still comfortably exceeds this requirement's own stated
    // preferredMinScores.toolFidelity of 70. Cloud endpoints are unaffected in
    // practice: the Stage-5b tier sort (pipeline-v2.ts) ranks user-configured
    // endpoints ahead of bundled local ones, so a capable cloud provider is still
    // chosen first wherever its sensitivity clearance permits. Lowering the floor
    // only adds a fallback where the alternative was failing outright.
    selectionRationale:
      "Requires tool-calling fidelity; strong tier or better, cloud preferred where clearance allows.",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { toolFidelity: 70 },
    minimumTier: "strong",
    preferCheap: false,
    origin: "system",
  },

  // ── Inbound business-email processing (SysML AI-cockpit model, Slice E1) ────
  // Email triage is high-volume, privacy-sensitive background utility work. Pin it
  // to the utility tier (adequate, never frontier) and minimize_cost so it routes
  // to cheap/local-preferred capacity — the DPF equivalent of Odysseus's dedicated
  // "utility" email model role, made load-bearing through the task requirement
  // rather than an ad-hoc call-site flag. residencyPolicy is intentionally left
  // unset by default (so installs without local AI still work); an operator/org can
  // set residencyPolicy="local_only" on the DB TaskRequirement row to harden
  // privacy. Satisfies REQ-AIC-E1 in the AI-cockpit SysML model.
  "email-triage": {
    taskType: "email-triage",
    description: "Classifying / triaging an inbound business email (intent, spam, urgency, routing).",
    selectionRationale: "High-volume, privacy-sensitive background utility work — keep it cheap/local-preferred, never frontier.",
    requiredCapabilities: {},
    preferredMinScores: { instructionFollowing: 45 },
    minimumTier: "adequate",
    preferCheap: true,
    budgetClassDefault: "minimize_cost",
    reasoningDepthDefault: "low",
    origin: "system",
  },
  "email-summarize": {
    taskType: "email-summarize",
    description: "Summarizing an inbound email or thread into a short brief.",
    selectionRationale: "Low-risk summarization — cheap/local utility tier.",
    requiredCapabilities: {},
    preferredMinScores: { instructionFollowing: 50 },
    minimumTier: "adequate",
    preferCheap: true,
    budgetClassDefault: "minimize_cost",
    reasoningDepthDefault: "low",
    origin: "system",
  },
  "email-extract": {
    taskType: "email-extract",
    description: "Extracting action items / entities (dates, asks, references) from an inbound email.",
    selectionRationale: "Structured extraction from email — favour cheap/local; structured-output quality is preferred, not hard-required, so local models stay eligible.",
    requiredCapabilities: {},
    preferredMinScores: { structuredOutput: 55, instructionFollowing: 50 },
    minimumTier: "adequate",
    preferCheap: true,
    budgetClassDefault: "minimize_cost",
    reasoningDepthDefault: "medium",
    origin: "system",
  },
};

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * Retrieves a task requirement contract, prioritising persisted fields then
 * filling contract fields the current table cannot represent from the built-in
 * definition. Results are cached in memory for the process lifetime.
 *
 * DB rows win over built-ins so admins can tune task requirements without code
 * changes. Built-in-only fields such as minimumTier remain load-bearing until
 * the persistence contract can store an explicit override.
 */
export async function getTaskRequirement(
  taskType: string,
): Promise<TaskRequirement | undefined> {
  if (taskRequirementCache.has(taskType)) {
    return taskRequirementCache.get(taskType);
  }

  // Try DB first; fall back to the built-in catalogue if the query fails
  // (e.g. tests running without a provisioned Prisma client, or a transient
  // connection blip). BUILT_IN_TASK_REQUIREMENTS is the canonical fallback
  // so routing always gets a contract — missing DB must never break tier
  // enforcement.
  try {
    const dbRow = await prisma.taskRequirement.findUnique({ where: { taskType } });
    if (dbRow) {
      const requirement = {
        ...BUILT_IN_TASK_REQUIREMENTS[taskType],
        ...(dbRow as unknown as TaskRequirement),
      } as TaskRequirement;
      taskRequirementCache.set(taskType, requirement);
      return requirement;
    }
  } catch {
    // Fall through to built-in.
  }

  const builtIn = BUILT_IN_TASK_REQUIREMENTS[taskType];
  if (builtIn) taskRequirementCache.set(taskType, builtIn);
  return builtIn;
}
