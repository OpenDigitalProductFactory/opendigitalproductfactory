/**
 * EP-INF-012: Built-in task requirement contracts + DB-backed loader.
 *
 * minimumTier maps to the "thinking cap" analogy from Anthropic's adaptive-model
 * guidance: simple tasks (adequate) never touch frontier-tier endpoints; complex
 * tasks (frontier) demand the best available reasoning and tool-calling.
 *
 *   greeting / status-query / summarization → adequate (Haiku-equivalent, effort=low)
 *   data-extraction / web-search / creative  → strong  (Sonnet-equivalent, effort=medium)
 *   reasoning / code-gen / tool-action       → frontier (Opus/Sonnet, effort=high)
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
    selectionRationale: "Requires tool-calling fidelity — frontier only.",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { toolFidelity: 70 },
    minimumTier: "frontier",
    preferCheap: false,
    origin: "system",
  },
};

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * Retrieves a task requirement contract, prioritising the database then falling
 * back to built-in definitions. Results are cached in memory for the process lifetime.
 *
 * DB rows win over built-ins so admins can tune task requirements without code changes.
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
      const requirement = dbRow as unknown as TaskRequirement;
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
