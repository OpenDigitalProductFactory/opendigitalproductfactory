// apps/web/lib/coding-agent.ts
// Orchestrates code generation inside a sandbox container.

import { execInSandbox } from "@/lib/sandbox";
import { getProviderPriority } from "@/lib/ai-provider-priority";
import { routeAndCall } from "@/lib/routed-inference";
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
    "## UX Standards (mandatory — see docs/platform-usability-standards.md)",
    "- CSS Variables: Use var(--dpf-text), var(--dpf-muted), var(--dpf-surface-1), var(--dpf-surface-2), var(--dpf-bg), var(--dpf-border), var(--dpf-accent) for all colors. NEVER use text-white, text-black, bg-white, bg-black, or inline hex values. Exception: text-white on bg-[var(--dpf-accent)] buttons.",
    "- Contrast: Text on backgrounds must meet 4.5:1 ratio. UI components (borders, focus rings) must meet 3:1. These are enforced by the platform's branding system.",
    "- Semantic HTML: Use <nav>, <main>, <section>, <article>, <aside>, <header>, <footer> — not generic <div>s for structural elements.",
    "- ARIA: Interactive elements must have accessible names. Buttons need descriptive text (not just 'Submit'). Form inputs need associated <label> elements.",
    "- Keyboard: All interactive elements must be reachable via Tab and activatable via Enter/Space. Focus indicators are provided by @layer components in globals.css.",
    "- Color: Never use color as the sole means of conveying information. Status indicators need text labels or icons alongside color.",
    "- Form elements: Inherit baseline styles from @layer components in globals.css automatically — no custom focus/placeholder/disabled styling needed.",
  );

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

// ─── Context Gathering ──────────────────────────────────────────────────────

/**
 * Gathers existing code context from the sandbox to inform code generation.
 * Reads files that are listed in the build plan's fileStructure, so the LLM
 * has awareness of current patterns before generating/modifying code.
 */
export async function gatherCodeContext(
  containerId: string,
  plan: Record<string, unknown>,
): Promise<string> {
  const MAX_CONTEXT_CHARS = 8000;
  const parts: string[] = [];
  let totalChars = 0;

  // Extract fileStructure from plan (array of {path, action, purpose})
  const fileStructure = Array.isArray(plan.fileStructure) ? plan.fileStructure : [];

  for (const entry of fileStructure) {
    if (totalChars >= MAX_CONTEXT_CHARS) break;

    const filePath = typeof entry === "string" ? entry : entry?.path;
    const action = typeof entry === "string" ? "create" : (entry?.action ?? "create");
    if (!filePath || typeof filePath !== "string") continue;

    // For files being modified, read their current content
    if (action === "modify" || action === "edit" || action === "update") {
      try {
        const content = await execInSandbox(
          containerId,
          `cat "${filePath}" 2>/dev/null || echo "[file not found]"`,
        );
        if (content && !content.includes("[file not found]")) {
          const truncated = content.slice(0, 2000);
          const block = `### EXISTING: ${filePath}\n\`\`\`\n${truncated}\n\`\`\`\n`;
          parts.push(block);
          totalChars += block.length;
        }
      } catch {
        // File doesn't exist or can't be read — skip
      }
    }

    // For new files, try to find a similar existing file for pattern matching
    if (action === "create" || action === "new") {
      try {
        // Extract directory and extension to find similar files
        const dir = filePath.substring(0, filePath.lastIndexOf("/"));
        const ext = filePath.substring(filePath.lastIndexOf("."));
        if (dir && ext) {
          const similar = await execInSandbox(
            containerId,
            `ls "${dir}"/*${ext} 2>/dev/null | head -1`,
          );
          if (similar && similar.trim()) {
            const similarPath = similar.trim().split("\n")[0]!;
            const content = await execInSandbox(
              containerId,
              `head -50 "${similarPath}" 2>/dev/null || true`,
            );
            if (content && content.trim()) {
              const block = `### PATTERN (similar to ${filePath}): ${similarPath}\n\`\`\`\n${content}\n\`\`\`\n`;
              parts.push(block);
              totalChars += block.length;
            }
          }
        }
      } catch {
        // Pattern search failed — skip
      }
    }
  }

  if (parts.length === 0) return "";

  return "\n## Existing Code Context\nThese files are currently in the workspace. Match their patterns and conventions.\n\n" + parts.join("\n");
}

// ─── Test Failure Diagnosis ─────────────────────────────────────────────────

export type TestDiagnosis = {
  failingTests: Array<{
    testFile: string;
    testName: string;
    error: string;
    sourceFile?: string;
  }>;
  summary: string;
};

/**
 * Parses test output and type-check output to produce structured diagnostics.
 * Identifies failing test files, test names, error messages, and likely source files.
 */
export function diagnoseTestFailures(testResult: SandboxTestResult): TestDiagnosis {
  const failingTests: TestDiagnosis["failingTests"] = [];

  // Parse test failures from Jest/Vitest output
  const testFailPattern = /FAIL\s+(.+?)(?:\n|$)/g;
  const testNamePattern = /[x✕×]\s+(.+?)(?:\n|$)/g;
  const errorPattern = /Error:\s*(.+?)(?:\n|$)/g;

  let match;

  // Extract failing test files
  const failingFiles: string[] = [];
  while ((match = testFailPattern.exec(testResult.testOutput)) !== null) {
    failingFiles.push(match[1]!.trim());
  }

  // Extract failing test names
  const failingNames: string[] = [];
  while ((match = testNamePattern.exec(testResult.testOutput)) !== null) {
    failingNames.push(match[1]!.trim());
  }

  // Extract error messages
  const errors: string[] = [];
  while ((match = errorPattern.exec(testResult.testOutput)) !== null) {
    errors.push(match[1]!.trim());
  }

  // Build structured diagnosis
  for (let i = 0; i < Math.max(failingFiles.length, failingNames.length); i++) {
    const testFile = failingFiles[i] ?? failingFiles[0] ?? "unknown";
    const testName = failingNames[i] ?? "unknown test";
    const error = errors[i] ?? errors[0] ?? "unknown error";

    // Infer source file from test file path
    let sourceFile: string | undefined;
    if (testFile !== "unknown") {
      sourceFile = testFile
        .replace(/\.test\.(ts|tsx|js|jsx)$/, ".$1")
        .replace(/\.spec\.(ts|tsx|js|jsx)$/, ".$1")
        .replace(/__tests__\//, "");
    }

    failingTests.push({ testFile, testName, error, sourceFile });
  }

  // Also parse TypeScript errors
  if (!testResult.typeCheckPassed) {
    const tsErrorPattern = /(.+?)\((\d+),\d+\):\s*error TS\d+:\s*(.+?)(?:\n|$)/g;
    while ((match = tsErrorPattern.exec(testResult.typeCheckOutput)) !== null) {
      failingTests.push({
        testFile: match[1]!.trim(),
        testName: `TypeScript error at line ${match[2]}`,
        error: match[3]!.trim(),
        sourceFile: match[1]!.trim(),
      });
    }
  }

  const summary = failingTests.length > 0
    ? `${failingTests.length} failure(s): ${failingTests.map(f => `${f.testFile}: ${f.error}`).join("; ").slice(0, 500)}`
    : "No structured failures found in output.";

  return { failingTests, summary };
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
    typeCheckOutput = await execInSandbox(containerId, "cd /workspace && pnpm exec tsc --noEmit 2>&1 || true");
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

// ─── Auto-Execute Build Plan (DEPRECATED) ──────────────────────────────────
// @deprecated Use the agentic loop path in build-pipeline.ts instead.
// This single-shot code generation is kept as a fallback but the pipeline
// now delegates to runAgenticLoop() which provides iterative tool-use,
// context gathering, and test-fix recovery.

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
    const result = await routeAndCall(
      [{ role: "user", content: prompt }],
      "You are a code generation agent. Output file contents in the specified format. Do not explain — just write code.",
      "internal",
      { taskType: "code_generation" },
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
