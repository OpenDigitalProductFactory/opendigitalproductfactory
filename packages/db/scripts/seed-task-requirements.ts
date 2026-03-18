/**
 * Seed TaskRequirement records for the 9 built-in task types.
 * Run: DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx packages/db/scripts/seed-task-requirements.ts
 */
import { prisma } from "../src/client";

interface TaskReqSeed {
  taskType: string;
  description: string;
  selectionRationale: string;
  requiredCapabilities: Record<string, unknown>;
  preferredMinScores: Record<string, number>;
  preferCheap: boolean;
  defaultInstructions?: string;
  evaluationTokenLimit: number;
}

const TASK_REQUIREMENTS: TaskReqSeed[] = [
  {
    taskType: "greeting",
    description: "Simple conversational greeting or small talk",
    selectionRationale: "Simple dialog — any capable model works, prefer cheapest",
    requiredCapabilities: {},
    preferredMinScores: { conversational: 40 },
    preferCheap: true,
    evaluationTokenLimit: 200,
  },
  {
    taskType: "status-query",
    description: "Data lookup or status check against platform data",
    selectionRationale: "Data lookup — needs accuracy not depth, prefer cheapest",
    requiredCapabilities: {},
    preferredMinScores: { instructionFollowing: 40 },
    preferCheap: true,
    evaluationTokenLimit: 300,
  },
  {
    taskType: "summarization",
    description: "Summarize or condense information following specific format requirements",
    selectionRationale: "Needs to follow formatting instructions precisely",
    requiredCapabilities: {},
    preferredMinScores: { instructionFollowing: 50 },
    preferCheap: true,
    evaluationTokenLimit: 500,
  },
  {
    taskType: "reasoning",
    description: "Complex analysis, comparison, evaluation, or multi-step logical reasoning",
    selectionRationale: "Complex analysis needs strong reasoning — quality over cost",
    requiredCapabilities: {},
    preferredMinScores: { reasoning: 80 },
    preferCheap: false,
    evaluationTokenLimit: 1000,
  },
  {
    taskType: "data-extraction",
    description: "Extract structured data from unstructured input",
    selectionRationale: "Must produce valid structured output — hard requirement",
    requiredCapabilities: { supportsStructuredOutput: true },
    preferredMinScores: { structuredOutput: 70 },
    preferCheap: true,
    evaluationTokenLimit: 500,
  },
  {
    taskType: "code-gen",
    description: "Generate, edit, or review code",
    selectionRationale: "Code quality is critical — requires tool support for applying changes",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { codegen: 75, instructionFollowing: 60 },
    preferCheap: false,
    evaluationTokenLimit: 1000,
  },
  {
    taskType: "web-search",
    description: "Search the web and synthesize results",
    selectionRationale: "Must call search tools correctly",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { toolFidelity: 60 },
    preferCheap: true,
    evaluationTokenLimit: 500,
  },
  {
    taskType: "creative",
    description: "Creative writing, brainstorming, or content generation",
    selectionRationale: "Needs both creativity and coherence — quality over cost",
    requiredCapabilities: {},
    preferredMinScores: { conversational: 60, reasoning: 50 },
    preferCheap: false,
    evaluationTokenLimit: 500,
  },
  {
    taskType: "tool-action",
    description: "Multi-step tool use with platform actions or external APIs",
    selectionRationale: "Must call tools accurately and abstain when no tool fits — quality critical",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { toolFidelity: 70 },
    preferCheap: false,
    evaluationTokenLimit: 800,
  },
];

async function main() {
  for (const req of TASK_REQUIREMENTS) {
    await prisma.taskRequirement.upsert({
      where: { taskType: req.taskType },
      update: {
        description: req.description,
        selectionRationale: req.selectionRationale,
        requiredCapabilities: req.requiredCapabilities,
        preferredMinScores: req.preferredMinScores,
        preferCheap: req.preferCheap,
        defaultInstructions: req.defaultInstructions ?? null,
        evaluationTokenLimit: req.evaluationTokenLimit,
        origin: "system",
      },
      create: {
        taskType: req.taskType,
        description: req.description,
        selectionRationale: req.selectionRationale,
        requiredCapabilities: req.requiredCapabilities,
        preferredMinScores: req.preferredMinScores,
        preferCheap: req.preferCheap,
        defaultInstructions: req.defaultInstructions ?? null,
        evaluationTokenLimit: req.evaluationTokenLimit,
        origin: "system",
      },
    });
    console.log(`SEEDED: ${req.taskType}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
