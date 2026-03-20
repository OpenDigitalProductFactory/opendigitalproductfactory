// apps/web/lib/coding-agent.ts
// Orchestrates code generation inside a sandbox container.

import { execInSandbox } from "@/lib/sandbox";
import { getProviderPriority, callWithFailover } from "@/lib/ai-provider-priority";
import type { FeatureBrief } from "@/lib/feature-build-types";
import type { AgentEvent } from "@/lib/agent-event-bus";

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
    `Target Roles: ${Array.isArray(brief.targetRoles) ? brief.targetRoles.join(", ") : brief.targetRoles ?? "All"}`,
    `Data Needs: ${brief.dataNeeds ?? "None specified"}`,
    "",
    "## Acceptance Criteria",
    ...(Array.isArray(brief.acceptanceCriteria) ? brief.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`) : [String(brief.acceptanceCriteria ?? "Not specified")]),
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
    "- Schema changes are allowed. Add new models/fields to prisma/schema.prisma as needed.",
    "- After schema changes, use `prisma db push` to apply changes to the sandbox database.",
    "- Do NOT use `prisma migrate dev` — use `prisma db push` for sandbox iteration.",
    "- Do NOT drop existing tables or columns without explicit instruction.",
    "- When a schema change moves or renames existing data (e.g. moving a column to a new model, adding a non-nullable FK), document the required backfill SQL in a comment block at the top of the affected schema file section. Format: '// MIGRATION NOTE: <table> backfill required — <SQL summary>'. This comment is used when promoting the change to production via a proper migration file.",
    "- Do NOT silently discard existing data. If a field is being deprecated in favour of a new model, keep the old column in the sandbox schema until the backfill is verified.",
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

// ─── Auto-Execute Build Plan ────────────────────────────────────────────────
// Called by the system when build phase starts. Runs the coding agent against
// the sandbox with the approved plan. Does NOT depend on the coworker agent.

export type BuildExecutionResult = {
  success: boolean;
  filesChanged: string[];
  testResult: SandboxTestResult | null;
  summary: string;
  providerId: string;
  modelId: string;
  error?: string;
};

export async function executeBuildPlan(params: {
  containerId: string;
  brief: FeatureBrief;
  plan: Record<string, unknown>;
  onProgress?: (event: AgentEvent) => void;
}): Promise<BuildExecutionResult> {
  const { containerId, brief, plan, onProgress } = params;

  // 1. Check coding readiness
  onProgress?.({ type: "tool:start", tool: "checkCodingReadiness", iteration: 0 });
  const readiness = await checkCodingReadiness();
  if (!readiness.ready || !readiness.bestProvider) {
    return {
      success: false, filesChanged: [], testResult: null,
      summary: readiness.message,
      providerId: "none", modelId: "none",
      error: "No coding-capable provider available.",
    };
  }
  onProgress?.({ type: "tool:complete", tool: "checkCodingReadiness", success: true });

  // 2. Build the code generation prompt
  const prompt = buildCodeGenPrompt(brief, plan);

  // 3. Call the LLM for code generation
  onProgress?.({ type: "tool:start", tool: "generate_code", iteration: 1 });
  let llmResponse: string;
  let providerId: string;
  let modelId: string;
  try {
    const result = await callWithFailover(
      [{ role: "user", content: prompt }],
      "You are a code generation agent. Output file contents in the specified format. Do not explain — just write code.",
      "internal",
      { task: "code_generation" },
    );
    llmResponse = result.content;
    providerId = result.providerId;
    modelId = result.modelId;
  } catch (err) {
    return {
      success: false, filesChanged: [], testResult: null,
      summary: `Code generation failed: ${err instanceof Error ? err.message : String(err)}`,
      providerId: readiness.bestProvider.providerId,
      modelId: readiness.bestProvider.modelId,
      error: String(err),
    };
  }
  onProgress?.({ type: "tool:complete", tool: "generate_code", success: true });

  // 4. Parse file outputs from LLM response and write to sandbox
  onProgress?.({ type: "tool:start", tool: "write_files_to_sandbox", iteration: 2 });
  const filePattern = /### FILE: (.+?)\n```(?:typescript|tsx|ts|js|jsx|css|json)?\n([\s\S]*?)```/g;
  const filesChanged: string[] = [];
  let match;
  while ((match = filePattern.exec(llmResponse)) !== null) {
    const filePath = match[1]!.trim();
    const fileContent = match[2]!;
    try {
      // Ensure directory exists and write file
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      if (dir) await execInSandbox(containerId, `mkdir -p "${dir}"`);
      const encodedContent = Buffer.from(fileContent).toString("base64");
      await execInSandbox(containerId, `echo ${encodedContent} | base64 -d > "${filePath}"`);
      filesChanged.push(filePath);
    } catch (err) {
      console.warn(`[coding-agent] Failed to write ${filePath}:`, err);
    }
  }
  onProgress?.({ type: "tool:complete", tool: "write_files_to_sandbox", success: filesChanged.length > 0 });

  // 5. Run tests
  onProgress?.({ type: "tool:start", tool: "run_sandbox_tests", iteration: 3 });
  const testResult = await runSandboxTests(containerId);
  onProgress?.({ type: "tool:complete", tool: "run_sandbox_tests", success: testResult.passed });

  const summary = [
    `Code generated by ${providerId}/${modelId}.`,
    `${filesChanged.length} file(s) written: ${filesChanged.join(", ") || "none"}`,
    `Tests: ${testResult.passed ? "PASS" : "FAIL"}. Typecheck: ${testResult.typeCheckPassed ? "PASS" : "FAIL"}.`,
  ].join(" ");

  return {
    success: filesChanged.length > 0,
    filesChanged,
    testResult,
    summary,
    providerId,
    modelId,
  };
}
