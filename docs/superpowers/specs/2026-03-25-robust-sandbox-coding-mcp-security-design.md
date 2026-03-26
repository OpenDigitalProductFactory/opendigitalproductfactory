# EP-CODEGEN-001: Robust Sandbox Coding & MCP Security

**Status:** Implemented (2026-03-25)
**Predecessor:** EP-SELF-DEV-003 (Sandbox Execution & DB Isolation), EP-SELF-DEV-001A (Self-Dev Sandbox Design), Unified MCP Coworker Design (2026-03-16)

## Problem Statement

The Build Studio code generation pipeline has two disconnected paths that weaken both code quality and user interaction:

1. **Single-shot code generation** -- `executeBuildPlan()` in `coding-agent.ts` calls the LLM once, parses markdown file blocks via regex, and writes them to the sandbox. No iteration, no context gathering, no test-fix recovery. Test failures are silently swallowed ("Tests are informational").

2. **Disconnected coworker** -- The AI coworker already has rich sandbox tools (`read_sandbox_file`, `edit_sandbox_file`, `generate_code`, `search_sandbox`, `run_sandbox_tests`) and a detailed build-phase prompt with read-edit-test-fix workflows. But when `advanceBuildPhase("build")` fires, it calls `autoExecuteBuild` which runs the single-shot pipeline path, bypassing the coworker entirely. Users cannot interact with the build in progress.

3. **Broken tools** -- `iterate_sandbox` is a stub that writes to `/tmp/codegen-prompt.txt` (nothing reads it). `BUILD_TOOL_NAMES` in the fabrication detector is missing `edit_sandbox_file` and other sandbox tools, causing false positives.

4. **MCP security gap** -- Adding stdio-transport MCP servers (Filesystem, PostgreSQL) to the platform would spawn them as child processes of the portal (production) container, inheriting production credentials and file access. No enforcement mechanism prevents MCP tools from bypassing sandbox isolation.

### What Already Exists

- **`build-pipeline.ts`** -- Checkpoint-based pipeline: pending > sandbox_created > workspace_initialized > db_ready > deps_installed > code_generated > tests_run > complete
- **`coding-agent.ts`** -- `executeBuildPlan()` (single-shot), `buildCodeGenPrompt()`, `runSandboxTests()`
- **`agentic-loop.ts`** -- Iterative LLM+tool loop (100 max iterations, 10 min for builds), fabrication detection, narration detection
- **`mcp-tools.ts`** -- Platform tool registry with sandbox tools (`read_sandbox_file`, `edit_sandbox_file`, `generate_code`, etc.)
- **`mcp-server-tools.ts`** -- MCP server tool discovery and execution; stdio execution blocked at runtime ("not yet supported")
- **`build-agent-prompts.ts`** -- Phase-specific system prompts for the coworker
- **`agent-event-bus.ts`** -- Typed SSE event emitter for real-time progress
- **`agent-coworker.ts`** -- Unified coworker with build context injection
- **`sandbox-promotion.ts`** -- Promotion flow: backup > extract diff > scan destructive ops > apply patch

---

## Design

### Section 1: Unify Pipeline with Agentic Loop

Replace the single-shot `executeBuildPlan()` call in the pipeline with the coworker's `runAgenticLoop()`. This gives code generation iterative tool-use, context awareness, and test-fix recovery for free.

**Change in `build-pipeline.ts` -- `stepGenerateCode()`:**

Previous behavior:
```
stepGenerateCode -> executeBuildPlan() -> single LLM call -> regex parse -> write files -> done
```

New behavior:
```
stepGenerateCode -> runAgenticLoop() -> iterative tool calls:
  1. search_sandbox (find existing patterns)
  2. read_sandbox_file (understand current code)
  3. generate_code (create new files with context)
  4. edit_sandbox_file (surgical modifications)
  5. run_sandbox_command (typecheck: pnpm tsc --noEmit)
  6. run_sandbox_tests (verify)
  7. [if tests fail] read failing files -> edit -> re-test (up to 3 attempts)
  8. saveBuildEvidence (persist results)
```

The agentic loop uses the same system prompt the coworker uses (`getBuildPhasePrompt("build")`), the same tools, and the same 10-minute timeout. Results (tools executed, files changed, test output) are persisted to `taskResults` on the `FeatureBuild` record.

**`executeBuildPlan()` is deprecated** but retained as a fallback. A comment in `coding-agent.ts` directs to the agentic loop path.

**Modified file:** `apps/web/lib/build-pipeline.ts`

### Section 2: Context-Aware Code Generation

Add a `gatherCodeContext()` function that reads existing files from the sandbox before generating code. The LLM sees current patterns instead of generating into a void.

**Function signature:**
```typescript
export async function gatherCodeContext(
  containerId: string,
  plan: Record<string, unknown>,
): Promise<string>
```

**Behavior:**
- Reads the plan's `fileStructure` array (from the Plan phase)
- For files with action `"modify"`: reads current content from sandbox (up to 2000 chars each)
- For files with action `"create"`: finds a similar existing file in the same directory with the same extension, reads first 50 lines to show patterns
- Returns concatenated context string capped at 8000 characters total
- Returns empty string if plan has no fileStructure or no files can be read

**Integration points:**
- `generate_code` tool handler in `mcp-tools.ts` calls `gatherCodeContext()` before LLM inference, appends result to the codegen prompt
- `iterate_sandbox` tool handler (Section 3) also calls it for refinement context

**New function in:** `apps/web/lib/coding-agent.ts`

### Section 3: Fix `iterate_sandbox` Tool

Replace the non-functional stub with a real implementation.

**Previous behavior (stub):**
```typescript
// Writes instruction to /tmp/codegen-prompt.txt — nothing reads this file
await execInSandbox(build.sandboxId, `echo ${encodedInstruction} | base64 -d > /tmp/codegen-prompt.txt`);
```

**New behavior:**
1. Gather code context from sandbox (same as Section 2)
2. Get current `git diff --stat` to show what's already been changed
3. Build prompt combining: brief + plan + refinement instruction + existing code context + current diff
4. Call LLM with full context
5. Parse output using `### FILE:` format (same regex as `generate_code`)
6. Write refined files to sandbox
7. Log activity via `logBuildActivity()`
8. Return structured result with files changed

**Modified file:** `apps/web/lib/mcp-tools.ts` (case `"iterate_sandbox"`)

### Section 4: Test-Failure Diagnosis and Auto-Fix

#### 4a. Structured Test Diagnostics

Add `diagnoseTestFailures()` that parses test and typecheck output into structured data.

**Type definition:**
```typescript
export type TestDiagnosis = {
  failingTests: Array<{
    testFile: string;
    testName: string;
    error: string;
    sourceFile?: string;  // inferred from test file path
  }>;
  summary: string;
};
```

**Parsing logic:**
- Jest/Vitest: `FAIL <file>` pattern for failing files, `x/cross <name>` for test names, `Error: <msg>` for errors
- TypeScript: `<file>(<line>,<col>): error TS<code>: <msg>` pattern
- Source file inference: strips `.test.ts` / `.spec.ts` suffix and `__tests__/` directory

**New function in:** `apps/web/lib/coding-agent.ts`

#### 4b. Auto-Fix Loop in `run_sandbox_tests`

Add optional `auto_fix` boolean parameter to the `run_sandbox_tests` tool.

**When `auto_fix: true` and tests fail:**
1. Call `diagnoseTestFailures()` to get structured failure data
2. Read failing source files from sandbox (max 3 failures, 100 lines each)
3. Build a fix prompt with: test output + type errors + diagnosis + file contents
4. Call LLM asking for fixed files in `### FILE:` format
5. Parse and write fixed files to sandbox
6. Re-run tests
7. Repeat up to 3 times (MAX_FIX_ATTEMPTS)
8. Persist `autoFixAttempts` and `autoFixEnabled` in `verificationOut`

**When `auto_fix: false` (default):** Behavior unchanged from current implementation.

**Modified file:** `apps/web/lib/mcp-tools.ts` (tool definition + case `"run_sandbox_tests"`)

#### 4c. Pipeline Test Step Persistence

`stepRunTests` in `build-pipeline.ts` previously swallowed all test failures:
```typescript
try { await runSandboxTests(state.containerId!); } catch { /* ignored */ }
```

Now persists structured results to `verificationOut` on the `FeatureBuild` record, including diagnosis summary if tests failed. Failures are recorded but do not fail the pipeline step -- the review phase evaluates whether failures are acceptable.

**Modified file:** `apps/web/lib/build-pipeline.ts`

### Section 5: Fabrication Detection Fix

`BUILD_TOOL_NAMES` in `agentic-loop.ts` was missing sandbox tools. When the agent used `edit_sandbox_file` (surgical edit) instead of `generate_code` (whole-file generation), the fabrication detector flagged it as narration.

**Added to `BUILD_TOOL_NAMES`:**
- `edit_sandbox_file`
- `read_sandbox_file`
- `run_sandbox_command`
- `search_sandbox`
- `list_sandbox_files`

**Modified file:** `apps/web/lib/agentic-loop.ts`

### Section 6: Build Progress in Coworker Context

When a build is in progress (phase = "build"), inject the live pipeline state into the coworker's system prompt so users can interact mid-build.

**Injected context (when `buildExecState` exists):**
```
--- Build Execution Progress ---
Pipeline step: deps_installed
Sandbox: dpf-sandbox-1
Tools executed: generate_code, edit_sandbox_file, run_sandbox_tests
Tests: FAIL. Typecheck: PASS.
Last error: [if any]
```

This enables conversational interactions like:
- "What's happening with the build?"
- "The import is wrong -- fix the Button import to use @/components/ui/button"
- "Skip the tests and move to review"

**Modified file:** `apps/web/lib/actions/agent-coworker.ts`

### Section 7: Build Agent Prompt Enhancements

Added two structured workflow sections to the `build` phase prompt:

**WHEN TESTS FAIL (recovery workflow):**
1. Read test output -- identify which test failed and exact error
2. Run `pnpm tsc --noEmit` first (type errors cause most test failures)
3. Read failing test file to understand expectations
4. Read source file under test to see actual implementation
5. Identify root cause (wrong import, missing export, type mismatch, etc.)
6. Fix the SOURCE file (tests define correct behavior -- do not modify tests)
7. Re-run tests to verify
8. After 3 failed attempts: stop and ask user for guidance

**CONTEXT GATHERING (before writing any code):**
- Always search and list files before creating new ones
- Always read files before editing them
- When creating a new component/page/API, read a similar existing one first
- After generating files, always run `pnpm tsc --noEmit` immediately

**IMMEDIATE TYPE-CHECK rule:**
After generating or editing files, always run typecheck before proceeding. Fix type errors immediately -- do not accumulate them.

**Modified file:** `apps/web/lib/build-agent-prompts.ts`

### Section 8: Coding Event Types

New event types for real-time progress streaming during sandbox code generation:

```typescript
| { type: "coding:file_written"; buildId: string; path: string; action: "create" | "modify" }
| { type: "coding:context_gathered"; buildId: string; filesRead: number }
| { type: "coding:test_fix_attempt"; buildId: string; attempt: number; maxAttempts: number }
| { type: "coding:build_check"; buildId: string; passed: boolean; errorCount?: number }
```

These emit through the existing `agentEventBus` SSE mechanism. Frontend components (`SandboxPreview`, `BuildActivityLog`) can subscribe to show real-time coding progress.

**Modified file:** `apps/web/lib/agent-event-bus.ts`

### Section 9: Default MCP Servers

Four free, open-source MCP servers are seeded as platform defaults via `seedMcpServers()` in `seed.ts`. All start as `"unconfigured"` -- admin activates through Platform > Integrations.

| Server ID | Package | License | Cost | Execution Scope |
|-----------|---------|---------|------|-----------------|
| `codex-agent` | `codex` | MIT | Free | sandbox |
| `mcp-filesystem` | `@modelcontextprotocol/server-filesystem` | MIT | Free | sandbox |
| `mcp-postgres` | `@modelcontextprotocol/server-postgres` | MIT | Free | sandbox |
| `mcp-github` | `@modelcontextprotocol/server-github` | MIT | Free | external |

**Playwright is not seeded** -- the platform already has a dedicated Playwright Docker container (`mcr.microsoft.com/playwright:v1.52.0-noble`) with built-in tools (`generate_ux_test`, `run_ux_test`).

**Modified file:** `packages/db/src/seed.ts`

### Section 10: MCP Security -- Sandbox Isolation Enforcement

**Threat model:**

All four seeded MCP servers use stdio transport. Stdio MCP servers spawn as child processes of whichever container invokes them. In the portal (production) container:
- They inherit `process.env` (production `DATABASE_URL`, `AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, API keys)
- They have read/write access to the production filesystem
- They run with the same OS-level privileges as the Node.js runtime

If an MCP server like `@modelcontextprotocol/server-filesystem` or `@modelcontextprotocol/server-postgres` executes in the portal container, it bypasses sandbox isolation entirely. The AI coworker could read/write production files or query/mutate the production database without going through the approved promotion flow.

**Mitigation -- `executionScope` field:**

Each MCP server config includes an `executionScope` field:

| Scope | Meaning | Where it runs | Production access |
|-------|---------|---------------|-------------------|
| `sandbox` | Must execute inside the sandbox container | `docker exec {sandboxId}` | None -- isolated filesystem, isolated DB |
| `external` | Communicates with external APIs only | Portal container (safe) | None -- no local file/DB access |

**Enforcement in `executeMcpServerTool()` (`mcp-server-tools.ts`):**

Before any stdio tool execution, the function checks `executionScope`:
- `sandbox` scope: **Blocked** with explicit error message directing to platform sandbox tools. Future implementation will route through `docker exec {sandboxId}` to spawn the MCP server process inside the sandbox container.
- `external` scope: Blocked by existing "stdio not yet supported" runtime guard. Safe when implemented because external servers only communicate with remote APIs.
- No scope / unknown: Blocked by existing runtime guard.

**PostgreSQL connection string:**

The `mcp-postgres` server config uses the sandbox-isolated database connection (`postgresql://dpf:dpf_sandbox@localhost:5432/dpf`), not the production `${DATABASE_URL}`. Even if the execution scope guard is bypassed, the connection string does not point to production.

**GitHub server safety:**

The `mcp-github` server is marked `executionScope: "external"` because it only communicates with the GitHub API (`api.github.com`). It has no local file or database access. A GitHub Personal Access Token is required but is free.

**Defense in depth layers:**

| Layer | What it prevents | Status |
|-------|-----------------|--------|
| `executionScope: "sandbox"` in config | Marks server as sandbox-only | Implemented |
| Guard in `executeMcpServerTool()` | Rejects sandbox-scoped servers in portal | Implemented |
| `"stdio not yet supported"` runtime block | Blocks all stdio execution (pre-existing) | Exists |
| Sandbox DB connection string | Points to sandbox DB, not production | Implemented |
| `externalAccessEnabled` flag | Gates all MCP tool availability | Exists |
| `requiredCapability: null` | **Gap** -- MCP tools have no per-tool capability check | Known limitation |

**Known limitation -- per-tool capability gating:**

All MCP server tools have `requiredCapability: null`. Once `externalAccessEnabled` is toggled on, any active MCP tool can be invoked. There is no granular permission model for individual MCP tools (e.g., allowing `list_tables` but blocking `query`). This is an acceptable risk because:
1. Only admin (HR-000) can activate MCP servers
2. The `externalAccessEnabled` flag is a per-session toggle controlled by the user
3. Sandbox-scoped servers are blocked from portal execution regardless

Future mitigation (not in scope): Add `requiredCapability` to `McpServerTool` records during discovery, mapped from server category to capability.

**Modified files:** `packages/db/src/seed.ts`, `apps/web/lib/mcp-server-tools.ts`

---

## New & Modified Files

### New Functions

| Function | File | Purpose |
|----------|------|---------|
| `gatherCodeContext()` | `apps/web/lib/coding-agent.ts` | Read existing files from sandbox before generating code |
| `diagnoseTestFailures()` | `apps/web/lib/coding-agent.ts` | Parse test/typecheck output into structured diagnostics |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/lib/build-pipeline.ts` | `stepGenerateCode` delegates to `runAgenticLoop()`; `stepRunTests` persists results |
| `apps/web/lib/coding-agent.ts` | Added `gatherCodeContext()`, `diagnoseTestFailures()`; deprecated `executeBuildPlan()` |
| `apps/web/lib/mcp-tools.ts` | Fixed `iterate_sandbox` stub; enhanced `generate_code` with context; added `auto_fix` to `run_sandbox_tests` |
| `apps/web/lib/agentic-loop.ts` | Added 5 sandbox tools to `BUILD_TOOL_NAMES` |
| `apps/web/lib/build-agent-prompts.ts` | Added test-recovery workflow, context-gathering, immediate typecheck rules |
| `apps/web/lib/agent-event-bus.ts` | Added 4 `coding:*` event types |
| `apps/web/lib/actions/agent-coworker.ts` | Inject live build execution progress into coworker system prompt |
| `apps/web/lib/mcp-server-tools.ts` | Added `executionScope` enforcement guard for sandbox-scoped MCP servers |
| `packages/db/src/seed.ts` | Expanded `seedMcpServers()` with 4 default servers (Filesystem, PostgreSQL, GitHub, Codex) |

---

## Epic Placeholders (Future Work)

- **EP-MCP-SANDBOX-EXEC** -- Implement stdio MCP server execution routed through `docker exec {sandboxId}` so sandbox-scoped servers (Filesystem, PostgreSQL) actually work inside the sandbox. Currently blocked with clear error message.
- **EP-MCP-TOOL-PERMS** -- Add per-MCP-tool capability gating. Map server category to `requiredCapability` during tool discovery. Currently all MCP tools have `requiredCapability: null`.
- **EP-PROMOTE-ENFORCE** -- Enforce destructive operation blocking in `sandbox-promotion.ts`. Currently `scanForDestructiveOps()` only warns; destructive SQL can still be promoted.

---

## Acceptance Criteria

1. `BUILD_TOOL_NAMES` includes all sandbox tools -- fabrication detector does not false-positive on `edit_sandbox_file` usage
2. Build phase prompt includes structured test-recovery workflow and context-gathering instructions
3. `gatherCodeContext()` reads existing files from plan's `fileStructure` and returns formatted context string (capped at 8000 chars)
4. `diagnoseTestFailures()` parses Jest/Vitest and TypeScript errors into structured `TestDiagnosis` objects
5. `iterate_sandbox` calls LLM with instruction + gathered context + current diff, writes parsed files to sandbox
6. `generate_code` appends gathered code context to the codegen prompt before LLM call
7. `run_sandbox_tests` with `auto_fix: true` retries up to 3 times with LLM-generated fixes
8. `stepGenerateCode` calls `runAgenticLoop()` with build phase prompt and sandbox tools (not `executeBuildPlan()`)
9. `stepRunTests` persists test results to `verificationOut` (not silently swallowed)
10. Coworker system prompt includes build execution progress when a build is in phase "build"
11. Agent event bus includes `coding:file_written`, `coding:context_gathered`, `coding:test_fix_attempt`, `coding:build_check` event types
12. MCP servers seeded: `mcp-filesystem`, `mcp-postgres`, `mcp-github`, `codex-agent` -- all `status: "unconfigured"`
13. Sandbox-scoped MCP servers blocked from portal execution with explicit error message
14. PostgreSQL MCP server config points to sandbox DB connection, not production `DATABASE_URL`
15. TypeScript compilation passes (`tsc --noEmit`)
16. Production build passes (`next build`)
17. All existing tests pass for modified files

---

## End-to-End Flow

### Build Phase (with robust coding)

```
User clicks "Build" in Build Studio
  |
advanceBuildPhase("build") fires autoExecuteBuild()
  |
runBuildPipeline() starts checkpoint execution:
  1. sandbox_created     -- Verify persistent sandbox container running
  2. workspace_initialized -- Copy source, git baseline
  3. db_ready            -- Postgres healthcheck, migrate, seed
  4. deps_installed      -- pnpm install, Prisma generate, dev server
  5. code_generated      -- NEW: runAgenticLoop() with sandbox tools
     |                      - Agent searches existing code patterns
     |                      - Reads files before modifying
     |                      - Generates new files with context
     |                      - Edits existing files surgically
     |                      - Runs typecheck after each change
     |                      - Runs tests, diagnoses failures, applies fixes
     |                      - Persists results to FeatureBuild.taskResults
  6. tests_run           -- Final verification, results persisted to verificationOut
  7. complete            -- Build ready for review
  |
User interacts via coworker chat (sees live progress):
  "What's the build status?" -- Agent sees pipeline step + test results
  "Fix the Button import"   -- Agent calls read_sandbox_file + edit_sandbox_file
  "Run the tests again"     -- Agent calls run_sandbox_tests
  |
Review phase evaluates acceptance criteria
  |
Ship phase promotes via sandbox-promotion.ts (backup -> diff -> apply)
```

### MCP Server Security Flow

```
Admin activates mcp-filesystem in Platform > Integrations
  |
McpServer status set to "active"
  |
Agent invokes filesystem___read_file tool
  |
executeMcpServerTool("mcp-filesystem", "read_file", params)
  |
Checks config.executionScope = "sandbox"
  |
BLOCKED: "Sandbox-scoped MCP servers cannot run in the portal container"
  |
Agent falls back to platform tool: read_sandbox_file
  (executes via docker exec inside sandbox container -- isolated)
```
