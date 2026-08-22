// Sandbox (Build Studio sandbox execution) tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the sandbox tool cluster out of the mcp-tools.ts executeTool switch:
// the tools a Build Studio session uses to inspect, recover, and drive the
// isolated sandbox container — check/start the container, diagnose and recover
// readiness, read/write/edit/search/list files, run commands and tests, and
// read the source-bounded sandbox state. Each handler reproduces the former
// switch case verbatim (same lazy `await import(...)` calls, same branches, same
// return shapes), so behaviour is identical when a tool is invoked over MCP.
//
// The shared Build Studio helpers (resolveActiveBuildId, extractBuildIdHint,
// logBuildActivity) are imported from the shared build-tool-helpers module
// rather than replicated. Definitions moved verbatim out of the inline
// PLATFORM_TOOLS array; grants mirror agent-grants.ts TOOL_TO_GRANTS, which
// stays the gating source.

import { prisma } from "@dpf/db";

import { SANDBOX_RECOVERY_ACTIONS, isSandboxRecoveryAction } from "@/lib/build/sandbox/sandbox-admin-types";
import { lazyFsPromises, lazyPath, lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";
import { resolveActiveBuildId, extractBuildIdHint, logBuildActivity } from "@/lib/mcp/build-tool-helpers";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const definitions: ToolDefinition[] = [
  {
    name: "get_build_sandbox_state",
    description: "Read the source-bounded sandbox/git state for a Build Studio build, including branch, head SHA, source diffstat, ignored generated/dependency paths, and expected plan files.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "diagnose_sandbox",
    description: "Diagnose Build Studio sandbox readiness for the active build. Returns the authoritative state, failed checks, and governed recovery actions; use this instead of asking the operator to run Docker commands.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
        expectedWorkspaceRoot: { type: "string", description: "Optional host worktree path expected to own the sandbox Compose project." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build", "review", "ship"],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "recover_sandbox",
    description: "Run a governed Build Studio sandbox recovery action for the active build. Requires structured confirmation for destructive actions and records recovery activity instead of sending Docker instructions to the operator.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
        action: {
          type: "string",
          enum: [...SANDBOX_RECOVERY_ACTIONS],
          description: "Governed sandbox recovery action to run.",
        },
        confirmation: {
          type: "object",
          description: "Structured confirmation for destructive actions, e.g. { discardSandboxChanges: true, acknowledgeReset: true, reason: '...' }.",
          properties: {
            discardSandboxChanges: { type: "boolean" },
            acknowledgeReset: { type: "boolean" },
            reason: { type: "string" },
          },
        },
      },
      required: ["action"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    // destroys state → consult-gated (TAK §8.4.1).
    consequence: "irreversible",
    buildPhases: ["build", "review", "ship"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    name: "check_sandbox",
    description: "Check whether the sandbox container (dpf-sandbox-1) is running. Returns status: 'running', 'stopped', or 'not_found'. If the result is not_found or detached, call diagnose_sandbox for governed recovery guidance.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  {
    name: "start_sandbox",
    description: "Start the sandbox container if it is stopped. If status is 'stopped', this will start it and wait up to 20 seconds for it to become ready. If status is 'not_found', call diagnose_sandbox because sandbox creation or rebinding is a platform-owned recovery action.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  {
    name: "run_sandbox_tests",
    description: "Run unit tests and typecheck inside the sandbox container. Set auto_fix to true to automatically diagnose and fix failures (up to 3 attempts).",
    inputSchema: {
      type: "object",
      properties: {
        auto_fix: { type: "boolean", description: "When true, automatically diagnose test failures and attempt fixes (max 3 retries). Default: false." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build", "review"],
  },
  {
    name: "read_sandbox_file",
    description: "Read a file from the sandbox working copy (post-build/edit state). For reading pristine source during planning, prefer read_project_file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root, e.g. apps/web/lib/actions/crm.ts" },
        offset: { type: "number", description: "Start reading from this line number (1-based). Omit to read from beginning." },
        limit: { type: "number", description: "Maximum number of lines to read. Omit to read entire file. Use for large files." },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    // Intentionally NOT in "plan" — read_project_file covers planning reads
    // from the source tree without requiring the portal→sandbox volume
    // round-trip, and having both tools in the same phase caused codex to
    // split file reads across them and stall (FB-21EEA510 2026-04-20).
    buildPhases: ["build", "review"],
  },
  {
    name: "write_sandbox_file",
    description: "Create or overwrite a file in the sandbox workspace. Use this to create new files. For modifying existing files, prefer edit_sandbox_file for surgical edits.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root, e.g. apps/web/app/(shell)/complaints/page.tsx" },
        content: { type: "string", description: "The full file content to write" },
      },
      required: ["path", "content"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Sandbox only
    buildPhases: ["build", "review"],
  },
  {
    name: "edit_sandbox_file",
    description: "Edit an existing file in the sandbox. Two modes: (1) String mode: old_text + new_text for exact find-and-replace. (2) Line mode: start_line + end_line + new_content to replace a line range by number. Use line mode when string matching fails — line numbers from read_sandbox_file are reliable.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace root" },
        old_text: { type: "string", description: "String mode: the exact text to find and replace" },
        new_text: { type: "string", description: "String mode: the replacement text" },
        replace_all: { type: "boolean", description: "String mode: replace all occurrences. Default: false." },
        start_line: { type: "number", description: "Line mode: first line to replace (1-indexed, from read_sandbox_file)" },
        end_line: { type: "number", description: "Line mode: last line to replace (inclusive)" },
        new_content: { type: "string", description: "Line mode: replacement content for the line range" },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Sandbox only
    buildPhases: ["build", "review"],
  },
  {
    name: "search_sandbox",
    description: "Search the sandbox working copy (post-build/edit state). For searching pristine source during planning, prefer search_project_files.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text or regex pattern to search for" },
        glob: { type: "string", description: "File glob filter, e.g. '*.ts' or '*.tsx'" },
        maxResults: { type: "number", description: "Maximum results (default 20)" },
      },
      required: ["pattern"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    // Not in "plan" — search_project_files covers planning search.
    buildPhases: ["build"],
  },
  {
    name: "list_sandbox_files",
    description: "List files in the sandbox working copy (post-build/edit state). For listing pristine source during planning, prefer list_project_directory.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern, e.g. 'apps/web/lib/actions/*.ts' or '**/*.tsx'" },
      },
      required: ["pattern"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    // Not in "plan" — list_project_directory covers planning listing.
    buildPhases: ["build"],
  },
  {
    name: "run_sandbox_command",
    description: "Run a shell command inside the sandbox container. Use for build, test, lint, git diff, or any other verification. Returns stdout and stderr.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute in the sandbox, e.g. 'pnpm --filter web build' or 'git diff'" },
      },
      required: ["command"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // Sandbox is isolated from production — safe in any mode
    buildPhases: ["build", "review"],
  },
];

async function getBuildSandboxState(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
  const { getSandboxStateForBuild } = await import("@/lib/build/sandbox-state");
  const state = await getSandboxStateForBuild(buildId);
  if (!state) return { success: false, error: "Build not found", message: `Build ${buildId} was not found.` };
  return {
    success: true,
    entityId: buildId,
    message: `Sandbox state loaded for ${buildId}: branch ${state.branch ?? "unknown"}, ${state.sourceDiffstat.length} source file(s) changed.`,
    data: state as unknown as Record<string, unknown>,
  };
}

async function diagnoseSandbox(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

  const { diagnoseSandboxReadiness } = await import("@/lib/build/sandbox/sandbox-admin");
  const snapshot = await diagnoseSandboxReadiness({
    buildId,
    expectedWorkspaceRoot: optionalString(params["expectedWorkspaceRoot"]),
  });

  return {
    success: true,
    message: `Sandbox readiness: ${snapshot.state}. ${snapshot.summary}`,
    data: {
      ...snapshot,
    },
  };
}

async function recoverSandboxTool(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

  const action = params["action"];
  if (!isSandboxRecoveryAction(action)) {
    return {
      success: false,
      error: "invalid_action",
      message: "Invalid sandbox recovery action.",
    };
  }

  const confirmation = params["confirmation"] && typeof params["confirmation"] === "object"
    ? params["confirmation"] as { discardSandboxChanges?: boolean; acknowledgeReset?: boolean; reason?: string }
    : null;
  const { recoverSandbox } = await import("@/lib/build/sandbox/sandbox-recovery");
  const result = await recoverSandbox({
    buildId,
    action,
    confirmation,
  });

  return {
    success: result.success,
    error: result.error,
    message: result.message,
    entityId: buildId,
    data: result.snapshot ? { ...result.snapshot } : undefined,
  };
}

async function checkSandbox(): Promise<ToolResult> {
  const sandboxId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
  try {
    const { exec: execCb } = lazyChildProcess();
    const { promisify } = lazyUtil();
    const execAsync = promisify(execCb);
    const { stdout } = await execAsync(`docker inspect -f "{{.State.Status}}" ${sandboxId}`, { timeout: 5_000 });
    const status = stdout.trim(); // "running", "exited", "paused", etc.
    const isRunning = status === "running";
    return {
      success: true,
      message: isRunning
        ? `Sandbox (${sandboxId}) is running and ready.`
        : `Sandbox (${sandboxId}) exists but is ${status}. Call start_sandbox to start it.`,
      data: { status: isRunning ? "running" : "stopped", containerId: sandboxId },
    };
  } catch {
    return {
      success: true,
      message: `Sandbox container (${sandboxId}) does not exist. Call diagnose_sandbox for the authoritative Build Studio recovery actions.`,
      data: { status: "not_found", containerId: sandboxId },
    };
  }
}

async function startSandbox(_params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const sandboxId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
  try {
    const { exec: execCb } = lazyChildProcess();
    const { promisify } = lazyUtil();
    const execAsync = promisify(execCb);

    // First check current status
    let currentStatus: string;
    try {
      const { stdout } = await execAsync(`docker inspect -f "{{.State.Status}}" ${sandboxId}`, { timeout: 5_000 });
      currentStatus = stdout.trim();
    } catch {
      return {
        success: false,
        error: "Sandbox container not found.",
        message: `The sandbox container (${sandboxId}) has never been created or is not registered. Call diagnose_sandbox so Build Studio can classify the sandbox and surface governed recovery actions.`,
      };
    }

    if (currentStatus === "running") {
      return { success: true, message: `Sandbox (${sandboxId}) is already running.`, data: { status: "running" } };
    }

    // Start the container
    await execAsync(`docker start ${sandboxId}`, { timeout: 15_000 });

    // Wait up to 20s for it to become running
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1_500));
      try {
        const { stdout } = await execAsync(`docker inspect -f "{{.State.Status}}" ${sandboxId}`, { timeout: 3_000 });
        if (stdout.trim() === "running") {
          // Auto-replay (EP-2D477458 Phase 3): a freshly (re)started sandbox
          // may have lost any on-demand-provisioned engine. Restore desired,
          // previously-provisioned, now-absent engines in the background —
          // a no-op for fresh or baked-only sandboxes.
          void import("@/lib/build/build-engine-reconcile")
            .then((m) => m.reconcileBuildEngines({ actorUserId: userId }))
            .catch(() => undefined);
          return { success: true, message: `Sandbox (${sandboxId}) started successfully and is ready.`, data: { status: "running" } };
        }
      } catch { /* keep waiting */ }
    }

    return {
      success: false,
      error: "Sandbox start timed out.",
      message: `The sandbox container (${sandboxId}) was started but did not become ready within 20 seconds. It may still be initialising — try check_sandbox again in a moment.`,
    };
  } catch (err) {
    return {
      success: false,
      error: "Failed to start sandbox.",
      message: `Could not start sandbox (${sandboxId}): ${(err as Error).message?.slice(0, 200)}`,
    };
  }
}

async function runSandboxTestsTool(
  params: Record<string, unknown>,
  userId: string,
  context?: { threadId?: string },
): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

  const { isSandboxAvailable: rstAvail } = await import("@/lib/build/sandbox/build-branch");
  if (!(await rstAvail())) {
    return { success: false, error: "Sandbox not running.", message: "The sandbox (dpf-sandbox-1) is not running. Call start_build first." };
  }
  const rstSandboxId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
  const { runSandboxTests, diagnoseTestFailures } = await import("@/lib/coding-agent");
  const autoFix = params.auto_fix === true;
  const MAX_FIX_ATTEMPTS = 3;

  // Scope verification to the build's changed files so the feature's OWN
  // tests gate the build (not just typecheck) and their output isn't
  // truncated behind the full monorepo suite.
  let rstChangedFiles: string[] = [];
  try {
    const { getSandboxStateForBuild } = await import("@/lib/build/sandbox-state");
    const rstState = await getSandboxStateForBuild(buildId);
    rstChangedFiles = rstState?.sourceDiffstat.map((entry) => entry.path) ?? [];
  } catch (err) {
    console.warn("[run_sandbox_tests] could not resolve changed files for scoping:", (err as Error)?.message);
  }

  let results = await runSandboxTests(rstSandboxId, { changedFiles: rstChangedFiles });
  let fixAttempts = 0;

  // Auto-fix loop: diagnose failures, apply fixes via LLM, re-test
  if (autoFix && !results.passed) {
    const { execInSandbox } = await import("@/lib/sandbox");
    const { routeAndCall } = await import("@/lib/routed-inference");
    const { agentEventBus } = await import("@/lib/agent-event-bus");

    while (!results.passed && fixAttempts < MAX_FIX_ATTEMPTS) {
      fixAttempts++;
      if (context?.threadId) {
        agentEventBus.emit(context.threadId, {
          type: "coding:test_fix_attempt" as "evidence:update",
          buildId,
          field: `attempt_${fixAttempts}_of_${MAX_FIX_ATTEMPTS}`,
        });
      }

      const diagnosis = diagnoseTestFailures(results);
      if (diagnosis.failingTests.length === 0) break;

      // Read failing source files for context
      const fileContents: string[] = [];
      const readFiles = new Set<string>();
      for (const failure of diagnosis.failingTests.slice(0, 3)) {
        for (const filePath of [failure.testFile, failure.sourceFile].filter(Boolean)) {
          if (readFiles.has(filePath!)) continue;
          readFiles.add(filePath!);
          try {
            const content = await execInSandbox(
              rstSandboxId,
              `cat "/workspace/${filePath}" 2>/dev/null | head -100 || echo "[not found]"`,
            );
            if (!content.includes("[not found]")) {
              fileContents.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
            }
          } catch { /* skip */ }
        }
      }

      // On retry attempts, gather deeper context: follow imports and find
      // codebase patterns. The first attempt has the error + source file.
      // If that wasn't enough, the LLM needs to see HOW the imported modules
      // work and how other files solve similar problems.
      const deepContext: string[] = [];
      if (fixAttempts >= 2) {
        // 1. Follow imports: extract import paths from failing files, read their exports
        for (const filePath of readFiles) {
          try {
            const importLines = await execInSandbox(
              rstSandboxId,
              `grep -n "^import" "/workspace/${filePath}" 2>/dev/null || true`,
            );
            for (const line of importLines.split("\n")) {
              // Match package imports like @dpf/db, @/lib/foo
              const pkgMatch = line.match(/from\s+["'](@dpf\/[^"']+|@\/[^"']+)["']/);
              if (!pkgMatch) continue;
              const importPath = pkgMatch[1]!;
              // Resolve to a file path
              let resolvedPath = "";
              if (importPath.startsWith("@dpf/db")) {
                resolvedPath = "packages/db/src/index.ts";
              } else if (importPath.startsWith("@/")) {
                resolvedPath = `apps/web/${importPath.replace("@/", "lib/")}.ts`;
              }
              if (resolvedPath && !readFiles.has(resolvedPath)) {
                readFiles.add(resolvedPath);
                const modContent = await execInSandbox(
                  rstSandboxId,
                  `cat "/workspace/${resolvedPath}" 2>/dev/null | head -50 || echo "[not found]"`,
                );
                if (!modContent.includes("[not found]")) {
                  deepContext.push(`### ${resolvedPath} (imported by ${filePath})\n\`\`\`\n${modContent}\n\`\`\``);
                }
              }
            }
          } catch { /* skip */ }
        }

        // 2. Find codebase patterns: how do other files handle similar imports?
        if (!results.typeCheckPassed && results.typeCheckOutput) {
          // Extract the problematic symbol from the error (e.g. "'Prisma'")
          const symbolMatch = results.typeCheckOutput.match(/['"](\w+)['"]\s+cannot be used as a value/);
          if (symbolMatch) {
            try {
              const grepResult = await execInSandbox(
                rstSandboxId,
                `grep -rn "import.*${symbolMatch[1]}" /workspace/apps/web/lib/ 2>/dev/null | grep -v node_modules | head -10 || true`,
              );
              if (grepResult.trim()) {
                deepContext.push(`### How other files import "${symbolMatch[1]}"\n\`\`\`\n${grepResult}\n\`\`\``);
              }
            } catch { /* skip */ }
          }
        }
      }

      // Ask LLM to produce a fix
      const fixPrompt = [
        "The following tests are failing. Diagnose and fix the SOURCE files (not the tests).",
        "",
        "## Test Output",
        "```",
        results.testOutput.slice(0, 3000),
        "```",
        "",
        results.typeCheckPassed ? "" : `## Type Check Errors\n\`\`\`\n${results.typeCheckOutput.slice(0, 2000)}\n\`\`\`\n`,
        "## Diagnosis",
        diagnosis.summary,
        "",
        "## Relevant Files",
        ...fileContents,
        ...(deepContext.length > 0 ? [
          "",
          "## Import Chain & Codebase Patterns (follow these — they show how the project actually works)",
          ...deepContext,
        ] : []),
        "",
        "IMPORTANT: If an import is type-only (export type) but used as a value, find an alternative approach.",
        "Look at how other files in this codebase solve the same problem.",
        "",
        "Output ONLY the fixed files in this format:",
        "### FILE: <path>",
        "```typescript",
        "<full file content>",
        "```",
      ].join("\n");

      try {
        const fixResult = await routeAndCall(
          [{ role: "user", content: fixPrompt }],
          "You are a debugging agent. Fix the failing code. Output only changed files.",
          "internal",
          { taskType: "code_generation" },
        );

        // Parse and write fixed files
        const filePattern = /### FILE: (.+?)\n```(?:typescript|tsx|ts|prisma|sql)?\n([\s\S]*?)```/g;
        let fixMatch;
        let filesFixed = 0;
        while ((fixMatch = filePattern.exec(fixResult.content)) !== null) {
          const cleanPath = fixMatch[1]!.trim().replace(/^\/?workspace\//, "");
          const dir = cleanPath.includes("/") ? cleanPath.substring(0, cleanPath.lastIndexOf("/")) : "";
          if (dir) await execInSandbox(rstSandboxId, `mkdir -p '/workspace/${dir}'`);
          const encoded = Buffer.from(fixMatch[2]!).toString("base64");
          await execInSandbox(rstSandboxId, `echo ${encoded} | base64 -d > '/workspace/${cleanPath}'`);
          filesFixed++;
        }

        if (filesFixed === 0) break; // LLM couldn't produce a fix

        logBuildActivity(buildId, "run_sandbox_tests", `Auto-fix attempt ${fixAttempts}: applied fixes to ${filesFixed} file(s).`);
      } catch {
        break; // LLM call failed — stop retrying
      }

      // Re-run tests (same scoping as the initial run)
      results = await runSandboxTests(rstSandboxId, { changedFiles: rstChangedFiles });
    }
  }

  const verificationData = {
    testsPassed: results.passed ? 1 : 0,
    testsFailed: results.passed ? 0 : 1,
    typecheckPassed: results.typeCheckPassed,
    testOutput: results.testOutput.slice(0, 5000),
    typeCheckOutput: results.typeCheckOutput.slice(0, 5000),
    autoFixAttempts: fixAttempts,
    autoFixEnabled: autoFix,
  };
  await prisma.featureBuild.update({
    where: { buildId },
    data: { verificationOut: verificationData as unknown as import("@dpf/db").Prisma.InputJsonValue },
  });
  const { agentEventBus: eventBus } = await import("@/lib/agent-event-bus");
  if (context?.threadId) eventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "verificationOut" });
  const statusMsg = results.typeCheckPassed
    ? `Verification recorded: typecheck clean, unit test output captured for review.${fixAttempts > 0 ? ` Fixed after ${fixAttempts} attempt(s).` : ""}`
    : `Verification recorded: typecheck failed, unit test output captured for review.${fixAttempts > 0 ? ` Auto-fix attempted ${fixAttempts} time(s).` : ""}`;
  logBuildActivity(buildId, "run_sandbox_tests", statusMsg);

  return {
    success: true,
    message: statusMsg,
    data: {
      ...verificationData,
      buildId,
    },
  };
}

// Shared body for the sandbox file/command tools. Previously a single
// fall-through switch arm (read/write/edit/search/list/run_sandbox_command) that
// dispatched internally on `toolName`; kept verbatim here and driven by the six
// handlers below so behaviour is byte-identical.
async function runSandboxFileTool(
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

  // Simple availability check — no slot management, no pool acquisition.
  // If the sandbox container is running, it is available. Period.
  const { isSandboxAvailable } = await import("@/lib/build/sandbox/build-branch");
  const { execInSandbox: sbExec } = await import("@/lib/sandbox");
  const available = await isSandboxAvailable();
  if (!available) {
    return {
      success: false,
      error: "Sandbox container is not running.",
      message: "The sandbox (dpf-sandbox-1) is not running. Call diagnose_sandbox and use the returned recovery action before retrying this file tool.",
    };
  }

  const execInSandbox = sbExec;
  const sandboxId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

  // ── Dispatch to specific tool ──
  // ── Direct filesystem tools (via shared Docker volume at /sandbox-workspace) ──
  // These use Node.js fs operations — no docker exec, no shell escaping.
  const { readFile, writeFile, mkdir } = lazyFsPromises();
  const { join, dirname } = lazyPath();
  const SANDBOX_MOUNT = "/sandbox-workspace";

  const resolveSandboxPath = (p: string) => {
    const cleaned = p.replace(/^\/?workspace\//, "");
    const resolved = join(SANDBOX_MOUNT, cleaned);
    // Prevent path traversal
    if (!resolved.startsWith(SANDBOX_MOUNT)) throw new Error("Path traversal blocked");
    return { resolved, relative: cleaned };
  };

  if (toolName === "read_sandbox_file") {
    const { resolved, relative } = resolveSandboxPath(String(params.path ?? ""));
    const offset = params.offset ? Number(params.offset) : undefined;
    const limit = params.limit ? Number(params.limit) : undefined;
    try {
      const raw = await readFile(resolved, "utf-8");
      const allLines = raw.split("\n");
      const startLine = (offset ?? 1) - 1;
      const endLine = limit ? startLine + limit : allLines.length;
      const slice = allLines.slice(startLine, endLine);
      const numbered = slice.map((line: string, i: number) => `${String(startLine + i + 1).padStart(6)}\t${line}`).join("\n");
      const rangeMsg = offset || limit ? ` (lines ${startLine + 1}–${startLine + slice.length})` : "";
      return { success: true, message: `File: ${relative}${rangeMsg}`, data: { path: relative, content: numbered } };
    } catch {
      return { success: false, error: `File not found: ${relative}`, message: `Could not read ${relative}` };
    }
  }

  if (toolName === "write_sandbox_file") {
    const { resolved, relative } = resolveSandboxPath(String(params.path ?? ""));
    const content = String(params.content ?? "");
    if (!content) return { success: false, error: "content is required.", message: "Provide the file content." };
    try {
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf-8");
      logBuildActivity(buildId, "write_sandbox_file", `Created ${relative} (${content.length} chars)`);
      return { success: true, message: `Created ${relative} (${content.length} chars).`, data: { path: relative } };
    } catch (err) {
      return { success: false, error: `Write failed: ${(err as Error).message?.slice(0, 200)}`, message: `Could not write ${relative}` };
    }
  }

  if (toolName === "edit_sandbox_file") {
    const { resolved, relative } = resolveSandboxPath(String(params.path ?? ""));

    // Line-based edit mode: replace a range of lines by number
    // More reliable than string matching for AI-generated edits
    const startLine = params.start_line ? Number(params.start_line) : undefined;
    const endLine = params.end_line ? Number(params.end_line) : undefined;
    const newContent = params.new_content ? String(params.new_content) : undefined;

    if (startLine && endLine && newContent !== undefined) {
      try {
        const current = await readFile(resolved, "utf-8");
        const lines = current.split("\n");
        if (startLine < 1 || endLine > lines.length || startLine > endLine) {
          return { success: false, error: `Invalid line range ${startLine}-${endLine} (file has ${lines.length} lines).`, message: `Line range out of bounds.` };
        }
        const before = lines.slice(0, startLine - 1);
        const after = lines.slice(endLine);
        const newLines = newContent.split("\n");
        const updated = [...before, ...newLines, ...after].join("\n");
        await writeFile(resolved, updated, "utf-8");
        logBuildActivity(buildId, "edit_sandbox_file", `Edited ${relative} lines ${startLine}-${endLine} (${endLine - startLine + 1} -> ${newLines.length} lines)`);
        return { success: true, message: `Edited ${relative}: replaced lines ${startLine}-${endLine} with ${newLines.length} lines.`, data: { path: relative, linesReplaced: endLine - startLine + 1, newLines: newLines.length } };
      } catch (err) {
        return { success: false, error: `Edit failed: ${(err as Error).message?.slice(0, 200)}`, message: `Could not edit ${relative}` };
      }
    }

    // String-matching edit mode (original)
    const oldText = String(params.old_text ?? "");
    const newText = String(params.new_text ?? "");
    const replaceAll = params.replace_all === true;
    if (!oldText) return { success: false, error: "old_text is required (or use start_line/end_line/new_content for line-based edit).", message: "Provide old_text to replace, or use line-based mode." };
    try {
      const current = await readFile(resolved, "utf-8");
      const occurrences = current.split(oldText).length - 1;
      if (occurrences === 0) return { success: false, error: `old_text not found in ${relative}. Use read_sandbox_file to see exact content, or use line-based edit (start_line, end_line, new_content).`, message: `Text not found. Try line-based edit instead.` };
      if (occurrences > 1 && !replaceAll) return { success: false, error: `old_text matches ${occurrences} locations in ${relative}. Provide more context to make it unique, or set replace_all: true.`, message: `Ambiguous match — ${occurrences} occurrences found. Add surrounding lines to make the match unique, or use replace_all.` };
      const updated = replaceAll ? current.split(oldText).join(newText) : current.replace(oldText, newText);
      await writeFile(resolved, updated, "utf-8");
      const countMsg = replaceAll ? ` (${occurrences} occurrences)` : "";
      logBuildActivity(buildId, "edit_sandbox_file", `Edited ${relative}${countMsg}`);
      return { success: true, message: `Edited ${relative}: replaced ${oldText.length} chars with ${newText.length} chars${countMsg}.`, data: { path: relative, replacements: replaceAll ? occurrences : 1 } };
    } catch (err) {
      return { success: false, error: `Edit failed: ${(err as Error).message?.slice(0, 200)}`, message: `Could not edit ${relative}` };
    }
  }

  if (toolName === "search_sandbox") {
    const pattern = String(params.pattern ?? "");
    const globFilter = params.glob ? String(params.glob) : "*.{ts,tsx,js,jsx}";
    const max = Number(params.maxResults) || 20;
    try {
      // Use grep on the mounted volume — runs in portal, not sandbox container
      const { exec: execCb } = lazyChildProcess();
      const { promisify } = lazyUtil();
      const execAsync = promisify(execCb);
      const { stdout } = await execAsync(
        `grep -rn --include='${globFilter}' '${pattern.replace(/'/g, "'\\''")}' ${SANDBOX_MOUNT}/apps/ ${SANDBOX_MOUNT}/packages/ 2>/dev/null | head -${max}`,
        { timeout: 15_000 },
      );
      const cleaned = stdout.replace(new RegExp(SANDBOX_MOUNT + "/", "g"), "");
      return { success: true, message: `Search results for "${pattern}"`, data: { pattern, results: cleaned } };
    } catch (err) {
      // grep exits with code 1 when no matches are found — this is NOT an error.
      // Distinguish "no matches" from actual sandbox failures.
      const execErr = err as { code?: number; killed?: boolean; signal?: string };
      if (execErr.code === 1) {
        return {
          success: true,
          message: `No matches found for "${pattern}" in ${globFilter} files. The sandbox is working — this search term simply doesn't exist in the codebase. Try a different keyword or check spelling.`,
          data: { pattern, results: "", matchCount: 0 },
        };
      }
      // Actual failure (timeout, mount not accessible, etc.)
      const errMsg = (err as Error).message?.slice(0, 200) ?? "Search failed";
      return { success: false, error: `Sandbox search error: ${errMsg}`, message: `Search failed — the sandbox may not be accessible. Error: ${errMsg}` };
    }
  }

  if (toolName === "list_sandbox_files") {
    const pattern = String(params.pattern ?? "**/*");
    try {
      const { exec: execCb } = lazyChildProcess();
      const { promisify } = lazyUtil();
      const execAsync = promisify(execCb);
      const findPattern = pattern.startsWith("/") ? pattern : `${SANDBOX_MOUNT}/${pattern}`;
      const { stdout } = await execAsync(
        `find ${SANDBOX_MOUNT} -path '${SANDBOX_MOUNT}/node_modules' -prune -o -path '${SANDBOX_MOUNT}/.pnpm-store' -prune -o -path '${SANDBOX_MOUNT}/.next' -prune -o -path '${findPattern}' -print 2>/dev/null | head -50`,
        { timeout: 10_000 },
      );
      const cleaned = stdout.split("\n").map((l: string) => l.replace(`${SANDBOX_MOUNT}/`, "")).filter(Boolean).join("\n");
      if (!cleaned) {
        return { success: true, message: `No files matching "${pattern}". The sandbox is working — this path pattern has no matches. Try a broader pattern like "apps/web/app/**/*.tsx".`, data: { pattern, files: "" } };
      }
      return { success: true, message: `Files matching "${pattern}"`, data: { pattern, files: cleaned } };
    } catch (err) {
      const errMsg = (err as Error).message?.slice(0, 200) ?? "List failed";
      return { success: false, error: `Sandbox file listing error: ${errMsg}`, message: `File listing failed — the sandbox may not be accessible. Error: ${errMsg}` };
    }
  }

  if (toolName === "run_sandbox_command") {
    const command = String(params.command ?? "");
    if (!command) return { success: false, error: "command is required.", message: "Provide a command to run." };

    // ── Command safety blocklist ─────────────────────────────────────────
    // Commands run inside the sandbox container (docker exec), not the host OS.
    // The container is isolated, but we still block commands that could:
    //   - Destroy the workspace beyond git recovery
    //   - Exfiltrate files to the internet
    //   - Escape the container or affect the host Docker daemon
    //   - Execute arbitrary code piped from the network
    const BLOCKED_PATTERNS = [
      /rm\s+-rf\s+\/(?!workspace)/i,       // rm -rf outside /workspace
      /rm\s+-rf\s+\/workspace\s*$/i,        // rm -rf /workspace itself
      /curl\s+.*\|\s*(ba)?sh/i,             // curl | sh (remote code exec)
      /wget\s+.*\|\s*(ba)?sh/i,             // wget | sh
      /curl\s+.*\|\s*node/i,                // curl | node
      /docker\s+(run|exec|build|rm|rmi)/i,  // docker escape attempts
      /--privileged/i,                       // container privilege escalation
      /\/proc\/\d+\/fd/i,                   // procfs fd access
      /nsenter/i,                            // namespace escape
      /chroot/i,                             // chroot escape
      /mount\b/i,                            // mount syscall
      /chmod\s+[0-7]*7[0-7]*\s+\/(?!workspace)/i, // chmod outside workspace
    ];
    const blocked = BLOCKED_PATTERNS.find(p => p.test(command));
    if (blocked) {
      console.warn(`[run_sandbox_command] BLOCKED: ${JSON.stringify(command.slice(0, 200))}`);
      return {
        success: false,
        error: "Command blocked by safety policy.",
        message: `This command is not permitted: "${command.slice(0, 100)}". Commands must operate within /workspace. Destructive operations outside the workspace, remote code execution, and container escape attempts are blocked.`,
      };
    }
    // ─────────────────────────────────────────────────────────────────────

    // Smart output truncation: keep errors (at the end) rather than progress noise (at the start)
    const truncateOutput = (raw: string, limit: number = 15000): string => {
      if (raw.length <= limit) return raw;
      // For build/typecheck output, extract error lines first
      const errorLines = raw.split("\n").filter((l) =>
        /error\s+TS\d|ERROR|FAIL|Error:|Cannot find|not assignable|does not exist|Module.*not found/i.test(l)
      );
      if (errorLines.length > 0 && errorLines.length < 200) {
        const errorSummary = errorLines.join("\n");
        if (errorSummary.length <= limit) {
          return `[${raw.split("\n").length} total lines, showing ${errorLines.length} error lines]\n${errorSummary}`;
        }
      }
      // Fall back to keeping the tail (where errors typically appear)
      return `[output truncated — showing last ${limit} chars of ${raw.length}]\n...${raw.slice(-limit)}`;
    };

    try {
      const output = await execInSandbox(sandboxId, `cd /workspace && ${command} 2>&1`);
      logBuildActivity(buildId, "run_sandbox_command", `Ran: ${command.slice(0, 100)}`);
      return {
        success: true,
        message: "Command completed.",
        data: { buildId, command, output: truncateOutput(output) },
      };
    } catch (err) {
      // Commands like tsc, prisma validate return non-zero exit codes when they
      // find errors. This is NOT a sandbox failure — it's useful output.
      const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: number };
      const output = (execErr.stdout ?? "") + (execErr.stderr ?? "");
      const exitCode = execErr.code;

      // If we got output, the command ran — return the output so the AI can act on it
      if (output.trim()) {
        logBuildActivity(buildId, "run_sandbox_command", `Ran (exit ${exitCode}): ${command.slice(0, 100)}`);
        return {
          success: true,
          message: `Command exited with code ${exitCode}. Review the output for errors to fix.`,
          data: { buildId, command, output: truncateOutput(output), exitCode },
        };
      }

      // No output — actual sandbox connectivity issue
      const errMsg = execErr.message?.slice(0, 2000) || "Command failed";
      console.error(`[run_sandbox_command] FAILED (no output): ${JSON.stringify(command.slice(0, 100))} -> ${JSON.stringify(errMsg.slice(0, 200))}`);
      return { success: false, error: errMsg, message: `Command failed: ${command.slice(0, 100)}`, data: { command, output: errMsg } };
    }
  }

  return { success: false, error: "Unknown sandbox tool", message: "Internal error." };
}

// Removed: generate_code and iterate_sandbox caused runaway loops by spawning
// nested LLM calls. Use write_sandbox_file / edit_sandbox_file /
// run_sandbox_command directly. (generate_code stays inline in mcp-tools.ts;
// iterate_sandbox's removed-guard moves here so the inline switch can drop it.)
async function iterateSandbox(): Promise<ToolResult> {
  return { success: false, error: "Tool removed.", message: "generate_code and iterate_sandbox have been removed. Use write_sandbox_file, edit_sandbox_file, and run_sandbox_command directly to build the feature." };
}

const handlers: Record<string, ToolPackHandler> = {
  get_build_sandbox_state: (params, userId) => getBuildSandboxState(params, userId),
  diagnose_sandbox: (params, userId) => diagnoseSandbox(params, userId),
  recover_sandbox: (params, userId) => recoverSandboxTool(params, userId),
  check_sandbox: () => checkSandbox(),
  start_sandbox: (params, userId) => startSandbox(params, userId),
  run_sandbox_tests: (params, userId, context) => runSandboxTestsTool(params, userId, context),
  read_sandbox_file: (params, userId) => runSandboxFileTool("read_sandbox_file", params, userId),
  write_sandbox_file: (params, userId) => runSandboxFileTool("write_sandbox_file", params, userId),
  edit_sandbox_file: (params, userId) => runSandboxFileTool("edit_sandbox_file", params, userId),
  search_sandbox: (params, userId) => runSandboxFileTool("search_sandbox", params, userId),
  list_sandbox_files: (params, userId) => runSandboxFileTool("list_sandbox_files", params, userId),
  run_sandbox_command: (params, userId) => runSandboxFileTool("run_sandbox_command", params, userId),
  iterate_sandbox: () => iterateSandbox(),
};

export const sandboxPack: ToolPack = {
  packId: "sandbox",
  definitions,
  handlers,
  grants: {
    get_build_sandbox_state: ["work_capsule_read"],
    diagnose_sandbox: ["sandbox_execute", "work_capsule_read"],
    recover_sandbox: ["sandbox_execute"],
    check_sandbox: ["sandbox_execute"],
    start_sandbox: ["sandbox_execute"],
    run_sandbox_tests: ["sandbox_execute"],
    read_sandbox_file: ["sandbox_execute"],
    write_sandbox_file: ["sandbox_execute"],
    edit_sandbox_file: ["sandbox_execute"],
    search_sandbox: ["sandbox_execute"],
    list_sandbox_files: ["sandbox_execute"],
    run_sandbox_command: ["sandbox_execute"],
    iterate_sandbox: ["sandbox_execute"],
  },
};
