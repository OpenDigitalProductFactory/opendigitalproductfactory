// apps/web/lib/coding-agent.ts
// Orchestrates code generation inside a sandbox container.

import { execInSandbox } from "@/lib/sandbox";
import { getProviderPriority } from "@/lib/ai-provider-priority";
import type { FeatureBrief } from "@/lib/feature-build-types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CodeGenRequest = {
  containerId: string;
  brief: FeatureBrief;
  plan: Record<string, unknown>;
  instruction?: string;
};

export type CodeGenResult = {
  success: boolean;
  filesChanged: string[];
  summary: string;
  providerId: string;
  modelId: string;
  error?: string;
};

export type CodingReadiness = {
  ready: boolean;
  bestProvider: { providerId: string; modelId: string; tier: string } | null;
  message: string;
};

// ─── Coding Capability Check ─────────────────────────────────────────────────

export async function checkCodingReadiness(): Promise<CodingReadiness> {
  const priority = await getProviderPriority("code_generation");

  if (priority.length === 0) {
    return {
      ready: false,
      bestProvider: null,
      message: "No AI providers configured. Please configure a provider in Platform > AI Providers.",
    };
  }

  const best = priority[0]!;
  return {
    ready: true,
    bestProvider: {
      providerId: best.providerId,
      modelId: best.modelId,
      tier: best.capabilityTier,
    },
    message: `Using ${best.providerId}/${best.modelId} for code generation.`,
  };
}

// ─── Build Prompt ────────────────────────────────────────────────────────────

export function buildCodeGenPrompt(brief: FeatureBrief, plan: Record<string, unknown>, instruction?: string): string {
  const parts = [
    "You are a code generation agent working inside a Next.js 14 App Router project.",
    "The project uses TypeScript, Prisma 5, and TailwindCSS with a dark theme.",
    "",
    "## Feature Brief",
    `Title: ${brief.title}`,
    `Description: ${brief.description}`,
    `Portfolio: ${brief.portfolioContext}`,
    `Target Roles: ${brief.targetRoles.join(", ")}`,
    `Data Needs: ${brief.dataNeeds}`,
    "",
    "## Acceptance Criteria",
    ...brief.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    "",
    "## Implementation Plan",
    JSON.stringify(plan, null, 2),
  ];

  if (instruction) {
    parts.push("", "## Refinement Instruction", instruction);
  }

  parts.push(
    "",
    "## Rules",
    "- Write all files to /workspace",
    "- Use TypeScript strict mode",
    "- Follow existing project patterns",
    "- Do NOT modify the database schema",
    "- Do NOT access any external services",
    "- Output each file as: ### FILE: <path>\\n```typescript\\n<content>\\n```",
  );

  return parts.join("\n");
}

// ─── Run Tests in Sandbox ────────────────────────────────────────────────────

export type SandboxTestResult = {
  passed: boolean;
  typeCheckPassed: boolean;
  testOutput: string;
  typeCheckOutput: string;
};

export async function runSandboxTests(containerId: string): Promise<SandboxTestResult> {
  let testOutput = "";
  let testPassed = false;
  try {
    testOutput = await execInSandbox(containerId, "cd /workspace && pnpm test 2>&1 || true");
    testPassed = testOutput.includes("Tests  ") && !testOutput.includes("FAIL");
  } catch (e) {
    testOutput = e instanceof Error ? e.message : String(e);
  }

  let typeCheckOutput = "";
  let typeCheckPassed = false;
  try {
    typeCheckOutput = await execInSandbox(containerId, "cd /workspace && npx tsc --noEmit 2>&1 || true");
    typeCheckPassed = !typeCheckOutput.includes("error TS");
  } catch (e) {
    typeCheckOutput = e instanceof Error ? e.message : String(e);
  }

  return {
    passed: testPassed && typeCheckPassed,
    typeCheckPassed,
    testOutput,
    typeCheckOutput,
  };
}
