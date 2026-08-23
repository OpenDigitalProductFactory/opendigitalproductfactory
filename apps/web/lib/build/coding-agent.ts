// apps/web/lib/coding-agent.ts
// Orchestrates code generation inside a sandbox container.

import { execInSandbox } from "@/lib/sandbox";
import { getProviderPriority } from "@/lib/ai-provider-priority";
import { routeAndCall } from "@/lib/routed-inference";
import type { FeatureBrief } from "@/lib/feature-build-types";
import type { AgentEvent } from "@/lib/agent-event-bus";
import { getErrorMessage } from "@/lib/shared/get-error-message";

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

export function buildCodeGenPrompt(brief: FeatureBrief | null, plan: Record<string, unknown>, instruction?: string): string {
  // Guard: brief may be null for builds whose ideate phase never completed
  // (e.g. builds created before the brief was saved, or pipeline retries on
  // a build whose brief column is null — FB-71FB3A53).
  const title = brief?.title ?? "(no title)";
  const description = brief?.description ?? "";
  const portfolioContext = brief?.portfolioContext ?? "";
  const targetRoles = brief?.targetRoles;
  const dataNeeds = brief?.dataNeeds ?? "None specified";
  const acceptanceCriteria = brief?.acceptanceCriteria;

  const parts = [
    "You are a code generation agent working inside a Next.js 14 App Router project.",
    "The project uses TypeScript, Prisma 5, and TailwindCSS with a dark theme.",
    "",
    "## Feature Brief",
    `Title: ${title}`,
    `Description: ${description}`,
    `Portfolio: ${portfolioContext}`,
    `Target Roles: ${Array.isArray(targetRoles) ? targetRoles.join(", ") : targetRoles ?? "All"}`,
    `Data Needs: ${dataNeeds}`,
    "",
    "## Acceptance Criteria",
    ...(Array.isArray(acceptanceCriteria) ? acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`) : [String(acceptanceCriteria ?? "Not specified")]),
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
    "## Design Intelligence",
    "- If a design system recommendation is included in the build context (from generate_design_system), follow its style, color palette, typography, and anti-pattern guidance.",
    "- For DPF platform UI: always use DPF design tokens (var(--dpf-*)). For product sandbox UI: apply the design system recommendations.",
    "- UI anti-patterns: no emoji icons (use SVG), cursor-pointer on all clickables, smooth transitions (150-300ms), z-index scale (10/20/30/50).",
  );

  parts.push(
    "",
    "## Rules",
    "- Write all files to /workspace",
    "- Use TypeScript strict mode",
    "- Follow existing project patterns",
    "- Schema changes are allowed. Add new models/fields to the owning packages/db/prisma/schema/<domain>.prisma file as needed.",
    "- After schema changes, use `prisma db push` to apply changes to the sandbox database.",
    "- Do NOT use `prisma migrate dev` — use `prisma db push` for sandbox iteration.",
    "- Do NOT drop existing tables or columns without explicit instruction.",
    "- When a schema change moves or renames existing data (e.g. moving a column to a new model, adding a non-nullable FK), document the required backfill SQL in a comment block at the top of the affected schema file section. Format: '// MIGRATION NOTE: <table> backfill required — <SQL summary>'. This comment is used when promoting the change to production via a proper migration file.",
    "- Do NOT silently discard existing data. If a field is being deprecated in favour of a new model, keep the old column in the sandbox schema until the backfill is verified.",
    "- Do NOT access any external services",
    // The escape sequences here must be REAL newlines, not the literal
    // characters "\\n". Written with double backslashes the model was shown
    // '### FILE: <path>\\ntypescript...' as visible text and emitted that shape
    // back, which the parser regex below (which requires actual newlines) can
    // never match — so every build produced zero file writes and an empty diff.
    "- Output each file exactly in this format, on separate lines:",
    "### FILE: path/to/file.ts",
    "```typescript",
    "<full file contents>",
    "```",
    "- Output the COMPLETE file contents, not a fragment or a diff.",
    "- Do not add commentary before or after the file blocks.",
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
  /** "scoped" when we ran only the build's own feature tests, "full" otherwise. */
  scope?: "scoped" | "full";
  /** Number of feature test files run when scope === "scoped". */
  scopedTestsRun?: number;
};

/**
 * Derive the vitest test files to run for a build, scoped to its changed files.
 * Returns changed test files directly, plus sibling test candidates for changed
 * source files. Candidates may not exist on disk — the runner filters to
 * existing files before invoking vitest.
 */
export function deriveScopedTestFiles(changedFiles: string[]): string[] {
  const tests = new Set<string>();
  for (const raw of changedFiles) {
    const f = raw.trim();
    if (!f) continue;
    if (/\.(test|spec)\.[tj]sx?$/.test(f)) {
      tests.add(f);
      continue;
    }
    if (/\.[tj]sx?$/.test(f)) {
      const base = f.replace(/\.[tj]sx?$/, "");
      tests.add(`${base}.test.ts`);
      tests.add(`${base}.test.tsx`);
      tests.add(`${base}.spec.ts`);
    }
  }
  return [...tests];
}

/** Group test file paths by their workspace package (apps/* or packages/*). */
export function groupTestFilesByPackage(files: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const f of files) {
    const match = f.match(/^(apps\/[^/]+|packages\/[^/]+)\/(.+)$/);
    if (!match) continue;
    const [, pkg, rel] = match;
    const arr = grouped.get(pkg) ?? [];
    arr.push(rel);
    grouped.set(pkg, arr);
  }
  return grouped;
}

/**
 * True when vitest output indicates at least one failed test. Strips ANSI color
 * codes FIRST: vitest colorizes its summary, and a color code's trailing "m"
 * (e.g. the "m" in `\x1b[31m`) sits directly against the count digit, which
 * defeats the `\b` word boundary in `\b[1-9]…` so a colored "3 failed" never
 * matches. (Found running scoped tests against the live install — the raw-ANSI
 * path silently passed a build whose feature tests were red.)
 */
export function outputIndicatesTestFailure(output: string): boolean {
  // eslint-disable-next-line no-control-regex -- ANSI color strip
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  return /\b[1-9]\d*\s+failed/i.test(clean) || /^\s*FAIL\b/m.test(clean);
}

export async function runSandboxTests(
  containerId: string,
  opts?: { changedFiles?: string[]; workdir?: string },
): Promise<SandboxTestResult> {
  // Per-build working dir: the build's worktree when isolation is on, else
  // /workspace (default — byte-identical to prior behaviour). BI-98B723C0 Phase 2c.
  const workdir = opts?.workdir ?? "/workspace";
  // Typecheck is the primary gate — catches real compilation errors in feature code.
  // Run it first via the web workspace's tsconfig (not bare `tsc` which prints help).
  let typeCheckOutput = "";
  let typeCheckPassed = false;
  try {
    typeCheckOutput = await execInSandbox(containerId, `cd ${workdir}/apps/web && npx tsc --noEmit 2>&1 || true`);
    // `tsc` typechecks the whole apps/web project graph (no cheap per-file mode),
    // so a pre-existing type error in an UNRELATED file would block a build whose
    // own changed files are clean. When we know the changed surface, gate only on
    // in-scope errors; with no scope hint, any error fails (legacy behavior).
    const { typecheckPassedForChangedScope } = await import("@/lib/build/scoped-verification");
    typeCheckPassed = typecheckPassedForChangedScope(typeCheckOutput, opts?.changedFiles ?? []).passed;
  } catch (e) {
    typeCheckOutput = getErrorMessage(e);
  }

  // Scoped tests. Historically we gated on typecheck ONLY because "we don't have
  // a way to scope vitest to just the feature's files yet" — so a build whose own
  // feature tests failed still passed. When we know the build's changed files we
  // now run ONLY the feature's test files: (a) the feature's tests actually GATE
  // the build, and (b) the output stays small so a real failure is never
  // truncated behind hundreds of unrelated monorepo tests. With no changed-file
  // hint we fall back to the legacy full-suite run, recorded but typecheck-gated.
  let testOutput = "";
  let testPassed = true;
  let scope: "scoped" | "full" = "full";
  let scopedTestsRun = 0;

  const candidates = deriveScopedTestFiles(opts?.changedFiles ?? []);
  let scopedTestFiles: string[] = [];
  if (candidates.length > 0) {
    const existence = await Promise.all(
      candidates.map(async (p) => {
        try {
          const out = await execInSandbox(containerId, `test -f "${workdir}/${p}" && echo __yes__ || echo __no__`);
          return out.includes("__yes__") ? p : null;
        } catch {
          return null;
        }
      }),
    );
    scopedTestFiles = existence.filter((p): p is string => p !== null);
  }

  if (scopedTestFiles.length > 0) {
    scope = "scoped";
    scopedTestsRun = scopedTestFiles.length;
    const sections: string[] = [];
    let anyFailed = false;
    for (const [pkg, rel] of groupTestFilesByPackage(scopedTestFiles)) {
      const fileArgs = rel.map((r) => `"${r}"`).join(" ");
      const out = await execInSandbox(containerId, `cd ${workdir}/${pkg} && npx vitest run ${fileArgs} 2>&1 || true`);
      sections.push(`# ${pkg}\n${out}`);
      // vitest omits the "failed" segment entirely when zero, so any "N failed"
      // with N>=1 (or a FAIL marker) means the feature's own tests are red.
      // outputIndicatesTestFailure strips ANSI first — a colored digit otherwise
      // defeats the count regex.
      if (outputIndicatesTestFailure(out)) {
        anyFailed = true;
      }
    }
    testOutput = sections.join("\n\n");
    testPassed = !anyFailed;
  } else {
    try {
      testOutput = await execInSandbox(containerId, `cd ${workdir} && pnpm test 2>&1 || true`);
      testPassed = testOutput.includes("Tests  ") && !testOutput.includes("FAIL");
    } catch (e) {
      testOutput = getErrorMessage(e);
      testPassed = false;
    }
  }

  return {
    // Gate on typecheck AND — when feature tests were scoped and run — those
    // tests. The legacy full-suite path stays typecheck-gated (informational).
    passed: typeCheckPassed && (scope === "scoped" ? testPassed : true),
    typeCheckPassed,
    testOutput,
    typeCheckOutput,
    scope,
    scopedTestsRun,
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
      summary: `Code generation failed: ${getErrorMessage(err)}`,
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
