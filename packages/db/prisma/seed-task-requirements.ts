/**
 * Seed script: built-in task requirement contracts.
 *
 * Run with:
 *   pnpm --filter @dpf/db exec ts-node prisma/seed-task-requirements.ts
 *
 * The source of truth for BUILT_IN_TASK_REQUIREMENTS is
 * apps/web/lib/routing/task-requirements.ts. This script duplicates the
 * data to avoid cross-package imports in a standalone seed context.
 * If you add a task type in task-requirements.ts, add it here too.
 */

import { prisma } from "@dpf/db";

const BUILT_IN_TASK_REQUIREMENTS = [
  {
    taskType: "greeting",
    description: "Simple conversational greeting or acknowledgement.",
    selectionRationale: "Simple dialog — any capable model works.",
    requiredCapabilities: {},
    preferredMinScores: { conversational: 40 },
    preferCheap: true,
    origin: "system",
  },
  {
    taskType: "status-query",
    description: "Factual data lookup and status reporting.",
    selectionRationale: "Data lookup — needs accuracy, not depth.",
    requiredCapabilities: {},
    preferredMinScores: { instructionFollowing: 40 },
    preferCheap: true,
    origin: "system",
  },
  {
    taskType: "summarization",
    description: "Summarizing a block of text.",
    selectionRationale: "Needs to follow formatting instructions.",
    requiredCapabilities: {},
    preferredMinScores: { instructionFollowing: 50 },
    preferCheap: true,
    origin: "system",
  },
  {
    taskType: "data-extraction",
    description: "Extracting structured data (e.g., JSON) from unstructured text.",
    selectionRationale: "Must produce valid structured output reliably.",
    requiredCapabilities: { supportsStructuredOutput: true },
    preferredMinScores: { structuredOutput: 70 },
    preferCheap: true,
    origin: "system",
  },
  {
    taskType: "web-search",
    description: "Using a search tool to answer a question.",
    selectionRationale: "Must call search tools correctly.",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { toolFidelity: 60 },
    preferCheap: true,
    origin: "system",
  },
  {
    taskType: "creative",
    description: "Creative writing, brainstorming, or open-ended ideation.",
    selectionRationale: "Needs both creativity and coherence.",
    requiredCapabilities: {},
    preferredMinScores: { conversational: 60, reasoning: 50 },
    preferCheap: false,
    origin: "system",
  },
  {
    taskType: "reasoning",
    description: "Complex, multi-step analytical reasoning.",
    selectionRationale: "Complex analysis needs strong reasoning — frontier only.",
    requiredCapabilities: {},
    preferredMinScores: { reasoning: 80 },
    preferCheap: false,
    origin: "system",
  },
  {
    taskType: "code-gen",
    description: "Generating or modifying source code.",
    selectionRationale: "Code quality is critical — frontier only.",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { codegen: 75, instructionFollowing: 60 },
    preferCheap: false,
    origin: "system",
  },
  {
    taskType: "tool-action",
    description: "Multi-step tool use with external APIs.",
    selectionRationale: "Requires tool-calling fidelity — frontier only.",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { toolFidelity: 70 },
    preferCheap: false,
    origin: "system",
  },
];

async function main() {
  console.log(`Seeding ${BUILT_IN_TASK_REQUIREMENTS.length} built-in task requirements...`);
  for (const req of BUILT_IN_TASK_REQUIREMENTS) {
    const { taskType, ...data } = req;
    await prisma.taskRequirement.upsert({
      where: { taskType },
      update: data,
      create: { taskType, ...data },
    });
    console.log(`  upserted: ${taskType}`);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
