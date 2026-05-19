# Build Studio Progress Visibility Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Build Studio tell the operator what is actually happening by separating DB, chat, sandbox, dispatch, and verification truth sources in both the portal UI and MCP observer surface.

**Architecture:** Add a server-side progress projection under `apps/web/lib/build/` and consume it from both Build Studio UI components and MCP tools. Persist codex dispatch attempts as structured build telemetry so usage limits, auth errors, timeouts, and repeated failures are visible without Docker log access. Keep execution semantics unchanged in this plan; `runBuildPipeline` and `autoExecuteBuild` behavioral fixes are separate backlog work.

**Tech Stack:** Next.js 16 app router, React client components, Prisma 7, Vitest, DPF MCP tool definitions in `apps/web/lib/mcp-tools.ts`, existing Build Studio server actions and event bus.

**Task Dependencies (implement in order):**

```
Task 1 (parsers + types)
  └─ Task 2 (schema + dispatch persistence)
       └─ Task 3 (projection + MCP tools)  ← needs both Task 1 and Task 2
            ├─ Task 4 (operational UI)
            ├─ Task 5 (resume observability)
            └─ Task 6 (stale chat + quiet-agent)
                 └─ Task 7 (E2E verification)
```

Do not start Task 3 before Task 2's migration is applied. Do not start Task 4, 5, or 6 before Task 3's projection is testable.

---

## Operator-Driven Execution Mode

This plan is intended to be started through Build Studio for `BI-0C287A4B` / `FB-B51C3ED4`, then monitored by the operator through the portal and by external agents through MCP. Local repo edits are allowed only when the platform path blocks progress, hides evidence, or would waste the test.

Use this message as the Build Studio kickoff prompt:

```text
Implement the Build Studio progress visibility overhaul for BI-0C287A4B.

Preserve the existing acceptance criteria: progress counter, task list, sticky status, specific failure heading, diagram auto-fit or default task list, and populated details tab.

Add the post-2026-05-18 operator-session requirements:
- every task count, test count, file count, and completion percentage must render a truth-source badge;
- stale coworker self-report snapshots must not be the primary status when newer DB or sandbox truth exists;
- Resume Implementation must show pre-click mode and post-click outcome;
- the default build view must be operational progress, not the React Flow topology;
- sandbox branch state, commit state, source diffstat, and expected plan files must be visible;
- codex-dispatch attempts must persist model, duration, exit code, stdout/stderr excerpts, and root-cause classification;
- verification must distinguish build-scoped failures from workspace-wide noise;
- if the agent says it is working but no dispatch, DB write, or BuildActivity appears for five minutes, the UI must show a quiet-agent warning with an evidence link;
- expose the same progress projection through MCP so an external agent can monitor Build Studio without Docker or raw database access.

Do not change runBuildPipeline or autoExecuteBuild semantics in this effort.
```

## File Structure

- Create `apps/web/lib/build/progress-visibility-types.ts`: shared discriminated types, stale thresholds, truth-source labels, failure-axis enum, and small formatting helpers.
- Create `apps/web/lib/build/task-results.ts`: canonical parser for runtime `FeatureBuild.taskResults`.
- Create `apps/web/lib/build/verification-output.ts`: canonical parser and failure-axis classifier for `FeatureBuild.verificationOut`.
- Create `apps/web/lib/build/progress-visibility.ts`: server query projection that combines DB task state, chat self-report summaries, sandbox state, dispatch attempts, and scoped verification.
- Create `apps/web/lib/build/dispatch-attempts.ts`: persistence/query helpers for codex dispatch attempts.
- Create `apps/web/lib/build/sandbox-state.ts`: sandbox/git projection helper for branch, commits ahead, diffstat, and expected plan files.
- Create `apps/web/lib/build/scoped-verification.ts`: changed-file and code-graph-based verification scope helper.
- Modify `packages/db/prisma/schema.prisma`: add a structured `BuildDispatchAttempt` model related to `FeatureBuild`.
- Add the Prisma-generated migration directory for `build_dispatch_attempts`.
- Modify `apps/web/lib/integrate/codex-dispatch.ts`: capture stdout and stderr separately and persist each attempt.
- Modify `apps/web/lib/integrate/build-orchestrator.ts`: pass `buildId`, task title, specialist, provider, model, and attempt metadata into dispatch persistence.
- Modify `apps/web/lib/actions/build.ts`: return resume action observability metadata while preserving execution semantics.
- Modify `apps/web/components/build/build-studio-workflow-actions.ts`: replace generic recovery headings with operator action plus failure-axis detail.
- Modify `apps/web/components/build/BuildStudioWorkflowActionCard.tsx`: render pre-click mode, post-click outcome, and truth-source-labeled action context.
- Modify `apps/web/components/build/BuildStudio.tsx`: default to operational view and move topology to secondary/collapsible view.
- Create `apps/web/components/build/TruthSourceBadge.tsx`: compact source/age/conflict chip.
- Create `apps/web/components/build/BuildSandboxCard.tsx`: sandbox branch and plan-file reality card.
- Create `apps/web/components/build/BuildDispatchHistoryCard.tsx`: dispatch attempts grouped by repeated root cause.
- Create `apps/web/components/build/BuildVerificationScopedCard.tsx`: build-scoped verification and global-health separation.
- Create `apps/web/components/build/BuildProgressOperationalPanel.tsx`: default main-panel composition.
- Modify `apps/web/components/build/ReviewPanel.tsx` and `apps/web/components/build/WorkflowStageInspector.tsx`: consume shared task/verification parsers instead of parsing JSON inline.
- Modify `apps/web/components/build/ProcessGraph.tsx` and `apps/web/lib/build/process-graph-builder.ts`: keep topology available, auto-fit on build changes, and remove hardcoded colors from touched paths.
- Modify `apps/web/lib/mcp-tools.ts`: add MCP observer tools backed by the same projection.

## Task 1: Shared Truth-Source and Parsing Foundation

**Files:**
- Create: `apps/web/lib/build/progress-visibility-types.ts`
- Create: `apps/web/lib/build/task-results.ts`
- Create: `apps/web/lib/build/verification-output.ts`
- Test: `apps/web/lib/build/progress-visibility-types.test.ts`
- Test: `apps/web/lib/build/task-results.test.ts`
- Test: `apps/web/lib/build/verification-output.test.ts`
- Modify: `apps/web/lib/build/process-graph-builder.ts`
- Modify: `apps/web/components/build/ReviewPanel.tsx`
- Modify: `apps/web/components/build/WorkflowStageInspector.tsx`

- [ ] **Step 1: Write failing tests for truth-source age and conflict rules**

```ts
import { describe, expect, it } from "vitest";
import { getTruthSourceAge, hasStaleTruthConflict } from "./progress-visibility-types";

describe("progress visibility truth sources", () => {
  it("formats fresh and stale source ages", () => {
    const now = new Date("2026-05-18T12:10:00.000Z");
    expect(getTruthSourceAge("2026-05-18T12:09:40.000Z", now)).toEqual({
      ageMs: 20_000,
      label: "20s ago",
      stale: false,
    });
    expect(getTruthSourceAge("2026-05-18T12:00:00.000Z", now)).toEqual({
      ageMs: 600_000,
      label: "10m ago",
      stale: true,
    });
  });

  it("flags stale conflicts when chat progress disagrees with newer DB state", () => {
    expect(hasStaleTruthConflict({
      staleThresholdMs: 5 * 60 * 1000,
      newer: { source: "db-task-results", completed: 0, total: 16, observedAt: "2026-05-18T12:00:00.000Z" },
      older: { source: "chat-self-report", completed: 14, total: 16, observedAt: "2026-05-17T21:00:00.000Z" },
    })).toBe(true);
  });
});
```

- [ ] **Step 2: Implement the shared truth-source types**

```ts
export const BUILD_TRUTH_STALE_THRESHOLD_MS = 5 * 60 * 1000;

export type BuildTruthSource =
  | "db-task-results"
  | "chat-self-report"
  | "sandbox-git"
  | "verification"
  | "dispatch-history"
  | "build-activity";

export type BuildFailureAxis =
  | "rate-limit"
  | "usage-limit"
  | "auth"
  | "timeout"
  | "test-failure"
  | "typecheck-failure"
  | "out-of-scope-noise"
  | "provider-unavailable"
  | "unknown";

export type TruthNumericSnapshot = {
  source: BuildTruthSource;
  completed: number;
  total: number;
  observedAt: string | null;
};
```

- [ ] **Step 3: Write failing tests for task result normalization**

```ts
import { describe, expect, it } from "vitest";
import { normalizeTaskResults } from "./task-results";

describe("normalizeTaskResults", () => {
  it("normalizes canonical orchestrator results", () => {
    const normalized = normalizeTaskResults({
      completedTasks: 1,
      totalTasks: 2,
      timestamp: "2026-05-18T12:00:00.000Z",
      tasks: [
        { title: "Add schema", specialist: "data-architect", outcome: "DONE", durationMs: 1000 },
        { title: "Add UI", specialist: "frontend-engineer", outcome: "BLOCKED", artifactSummary: "Usage limit" },
      ],
    });
    expect(normalized.completedTasks).toBe(1);
    expect(normalized.totalTasks).toBe(2);
    expect(normalized.tasks[1]).toMatchObject({ title: "Add UI", outcome: "BLOCKED" });
  });

  it("treats summary-only writes as a source without inventing task rows", () => {
    const normalized = normalizeTaskResults({ completedTasks: 0, totalTasks: 16, timestamp: "2026-05-18T12:00:00.000Z" });
    expect(normalized.tasks).toEqual([]);
    expect(normalized.source.observedAt).toBe("2026-05-18T12:00:00.000Z");
  });
});
```

- [ ] **Step 4: Implement task and verification parsers**

`normalizeTaskResults` must accept `unknown` and return:

```ts
export type NormalizedTaskResults = {
  completedTasks: number;
  totalTasks: number;
  tasks: Array<{
    taskIndex: number | null;
    title: string;
    specialist: string;
    outcome: string;
    durationMs: number | null;
    summary: string | null;
    files: string[];
  }>;
  source: TruthNumericSnapshot;
};
```

`normalizeVerificationOutput` must accept `unknown` and return:

```ts
export type NormalizedVerificationOutput = {
  typecheckPassed: boolean | null;
  testsPassed: number | null;
  testsFailed: number | null;
  outputExcerpt: string | null;
  observedAt: string | null;
  failureAxis: BuildFailureAxis | null;
};
```

- [ ] **Step 5: Refactor existing inline parsing to use the helpers**

Replace the inline JSON parsing in:

```ts
// apps/web/components/build/ReviewPanel.tsx
const taskResults = normalizeTaskResults(build.taskResults);
const verification = normalizeVerificationOutput(build.verificationOut);
```

and:

```ts
// apps/web/components/build/WorkflowStageInspector.tsx
const taskResults = normalizeTaskResults(build.taskResults);
```

`process-graph-builder.ts` may keep graph-specific node shaping, but it must call `normalizeTaskResults` instead of maintaining a second runtime parser.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/build/progress-visibility-types.test.ts apps/web/lib/build/task-results.test.ts apps/web/lib/build/verification-output.test.ts apps/web/lib/build/process-graph-builder.test.ts
```

Expected: all listed tests pass. Note: `process-graph-builder.test.ts` is included here as a regression guard — if it does not exist yet, skip it from this run command and add a `// TODO: add process-graph-builder tests` comment to `process-graph-builder.ts`. Do not block Task 1 completion on tests for a file that isn't modified in Task 1.

## Task 2: Structured Dispatch Attempt Persistence

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: the Prisma-generated migration directory for `build_dispatch_attempts`
- Create: `apps/web/lib/build/dispatch-attempts.ts`
- Test: `apps/web/lib/build/dispatch-attempts.test.ts`
- Modify: `apps/web/lib/integrate/codex-dispatch.ts`
- Modify: `apps/web/lib/integrate/build-orchestrator.ts`

- [ ] **Step 1: Add the `BuildDispatchAttempt` schema**

Before writing the model: verify that `FeatureBuild` has `buildId String @unique` in the schema. The FK `@relation(references: [buildId])` is only valid when `buildId` carries a `@unique` constraint. If the actual PK is `id` (cuid) and `buildId` is a secondary semantic field, change `references: [buildId]` → `references: [id]` and rename the FK column to `featureBuildId`.

Add this model near `BuildActivity` and add `dispatchAttempts BuildDispatchAttempt[]` to `FeatureBuild`:

```prisma
model BuildDispatchAttempt {
  id                String       @id @default(cuid())
  buildId           String
  taskTitle         String
  specialist        String?
  providerId        String?
  model             String?
  attemptNumber     Int          @default(1)
  startedAt         DateTime     @default(now())
  completedAt       DateTime?
  durationMs        Int?
  exitCode          Int?
  success           Boolean      @default(false)
  failureAxis       String       @default("unknown")
  stdoutExcerpt     String?      @db.Text
  stderrExcerpt     String?      @db.Text
  rootCauseSummary  String?      @db.Text
  rootCauseHash     String?
  build             FeatureBuild @relation(fields: [buildId], references: [buildId], onDelete: Cascade)

  @@index([buildId, startedAt])
  @@index([buildId, taskTitle, startedAt])
  @@index([failureAxis, startedAt])
}
```

`attemptNumber` must be set by `recordBuildDispatchAttempt` — not defaulted to 1. Query `COUNT(*) WHERE buildId = $buildId AND taskTitle = $taskTitle` before insert and use `count + 1`. The `@default(1)` is only a DB-level fallback for direct inserts; the helper owns sequencing.

- [ ] **Step 2: Generate and inspect the migration**

Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name build_dispatch_attempts
```

Expected: Prisma creates one migration adding only the new table, relation, and indexes.

- [ ] **Step 3: Write tests for failure-axis classification**

```ts
import { describe, expect, it } from "vitest";
import { classifyDispatchFailureAxis } from "./dispatch-attempts";

describe("classifyDispatchFailureAxis", () => {
  it("classifies Codex usage limit messages", () => {
    expect(classifyDispatchFailureAxis({
      exitCode: 1,
      stdout: "ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage or try again at 6:06 AM",
      stderr: "",
      timedOut: false,
    })).toBe("usage-limit");
  });

  it("classifies auth and timeout failures", () => {
    expect(classifyDispatchFailureAxis({ exitCode: 1, stdout: "No OAuth token", stderr: "", timedOut: false })).toBe("auth");
    expect(classifyDispatchFailureAxis({ exitCode: null, stdout: "", stderr: "", timedOut: true })).toBe("timeout");
  });
});
```

- [ ] **Step 4: Implement dispatch attempt helpers**

`apps/web/lib/build/dispatch-attempts.ts` exports:

```ts
export function classifyDispatchFailureAxis(args: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}): BuildFailureAxis;

export async function recordBuildDispatchAttempt(args: {
  buildId: string;
  taskTitle: string;
  specialist?: string | null;
  providerId?: string | null;
  model?: string | null;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  exitCode: number | null;
  success: boolean;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}): Promise<void>;

export async function getDispatchHistoryForBuild(buildId: string): Promise<BuildDispatchAttemptView[]>;
```

`recordBuildDispatchAttempt` must:
1. Strip secrets from stdout and stderr before persisting: remove patterns matching `Bearer [A-Za-z0-9_\-\.]+`, `dpfmcp_[A-Z0-9]+`, `sk-[A-Za-z0-9]+`, and `password[=:]\S+` (case-insensitive). Replace each match with `[REDACTED]`.
2. Truncate `stdoutExcerpt` and `stderrExcerpt` to 500 characters after sanitization.
3. Derive `failureAxis` from the sanitized text.
4. Compute `rootCauseHash` from `failureAxis + normalized first excerpt line`. Normalization before hashing: strip timestamps (`\d{4}-\d{2}-\d{2}T[\d:.Z]+`), file paths (`/[a-z/\-_.]+`), session IDs (`\b[a-f0-9]{8,}\b`), and line numbers (`:L?\d+`). This makes the hash stable across runs with the same failure type despite varying details.
5. Set `attemptNumber` by querying the existing count for `(buildId, taskTitle)` and using `count + 1`.

- [ ] **Step 5: Persist successful and failed Codex CLI attempts**

In `dispatchCodexTask`, capture stderr separately:

```ts
let stdout = "";
let stderr = "";
proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
proc.stderr.on("data", (data: Buffer) => {
  const text = data.toString();
  stderr += text;
  // existing progress parsing remains here
});
```

Call `recordBuildDispatchAttempt` on every close/error path. The helper must never throw back into the dispatch path; log persistence failures and preserve the existing `CodexResult` semantics.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/build/dispatch-attempts.test.ts apps/web/lib/integrate/build-orchestrator.test.ts
pnpm --filter @dpf/db exec prisma validate
```

Expected: tests pass and Prisma schema validates.

## Task 3: Progress Projection and MCP Observer Tools

**Files:**
- Create: `apps/web/lib/build/sandbox-state.ts`
- Create: `apps/web/lib/build/scoped-verification.ts`
- Create: `apps/web/lib/build/progress-visibility.ts`
- Test: `apps/web/lib/build/progress-visibility.test.ts`
- Test: `apps/web/lib/build/sandbox-state.test.ts`
- Test: `apps/web/lib/build/scoped-verification.test.ts`
- Modify: `apps/web/lib/mcp-tools.ts`
- Test: `apps/web/lib/mcp-tools-build-observer.test.ts`

- [ ] **Step 1: Write tests for combined projection conflicts**

```ts
import { describe, expect, it, vi } from "vitest";
import { buildProgressProjectionFromParts } from "./progress-visibility";

describe("build progress projection", () => {
  it("keeps DB and stale chat counts separate when they disagree", () => {
    const projection = buildProgressProjectionFromParts({
      now: new Date("2026-05-18T12:00:00.000Z"),
      dbTasks: {
        completedTasks: 0,
        totalTasks: 16,
        tasks: [],
        source: { source: "db-task-results", completed: 0, total: 16, observedAt: "2026-05-18T11:59:00.000Z" },
      },
      chatSnapshots: [
        { completed: 14, total: 16, observedAt: "2026-05-17T21:00:00.000Z", excerpt: "14 of 16 tasks completed" },
      ],
      sandbox: null,
      dispatchHistory: [],
      verification: null,
    });
    expect(projection.progress.primary.source).toBe("db-task-results");
    expect(projection.progress.conflicts).toHaveLength(1);
    expect(projection.progress.conflicts[0]?.source).toBe("chat-self-report");
  });
});
```

- [ ] **Step 2: Implement projection shape**

`getBuildProgressVisibility(buildId)` returns:

```ts
export type BuildProgressVisibility = {
  buildId: string;
  generatedAt: string;
  statusHeading: {
    operatorAction: string;
    failureAxis: BuildFailureAxis | null;
  };
  progress: {
    primary: TruthNumericSnapshot;
    conflicts: TruthNumericSnapshot[];
  };
  tasks: NormalizedTaskResults;
  staleChatSnapshots: Array<{
    observedAt: string | null;
    excerpt: string;
    completed: number | null;
    total: number | null;
  }>;
  sandbox: BuildSandboxState | null;
  dispatchHistory: BuildDispatchAttemptView[];
  verification: ScopedVerificationView | null;
  quietAgent: {
    quiet: boolean;
    minutesQuiet: number;
    lastObservableSignalAt: string | null;
  };
};
```

- [ ] **Step 3: Implement sandbox state query helper**

`getSandboxStateForBuild(buildId)` must return DB-backed sandbox metadata first and mark live git details as unavailable when no sandbox execution surface can be reached:

```ts
export type BuildSandboxState = {
  source: "sandbox-git";
  branch: string | null;
  headSha: string | null;
  headAgeLabel: string | null;
  commitsAhead: number | null;
  sourceDiffstat: Array<{ path: string; additions: number; deletions: number }>;
  ignoredDiffstat: Array<{ path: string; reason: "generated" | "dependency" | "cache" }>;
  expectedPlanFiles: Array<{ path: string; status: "exists" | "missing" | "unknown" }>;
  observedAt: string | null;
  unavailableReason: string | null;
};
```

Exclude `.next/`, `node_modules/`, `.pnpm-store/`, coverage output, and local log files from `sourceDiffstat`.

`expectedPlanFiles` source: parse the plan document associated with the build's `originatingBacklogItemId`. Look for the plan's `## File Structure` section; each `- Create:` and `- Modify:` line is an expected file. Fall back to `FeatureBuild.description` parsed for file path patterns (`apps/`, `packages/`) if no plan document is linked. Mark files as `"unknown"` when no plan document can be resolved rather than showing an empty list.

- [ ] **Step 4: Implement scoped verification helper**

`getScopedVerificationForBuild(buildId)` must classify:

```ts
export type ScopedVerificationView = {
  source: "verification";
  observedAt: string | null;
  buildScoped: {
    typecheckPassed: boolean | null;
    testsPassed: number | null;
    testsFailed: number | null;
    failureAxis: BuildFailureAxis | null;
    affectedFiles: string[];
    affectedTests: string[];
  };
  globalHealth: {
    testsFailed: number | null;
    outputExcerpt: string | null;
  };
};
```

If a failure file is outside the build's changed-file/test set, classify the build-scoped axis as `out-of-scope-noise` and keep the workspace failure under `globalHealth`.

**Changed-file set source (in priority order):**
1. `BuildSandboxState.sourceDiffstat` from Task 3, Step 3 — the authoritative list of files changed in the sandbox branch.
2. `BuildDispatchAttempt.stdoutExcerpt` parsed for file path patterns (`apps/`, `packages/`) — available earlier in the build lifecycle before sandbox state is computed.
3. The plan's `## File Structure` section parsed from the linked plan document — lowest fidelity, use only when both of the above are unavailable.

Mark `buildScoped.affectedFiles` as empty and `failureAxis` as `"unknown"` (not `"out-of-scope-noise"`) when no changed-file set can be established.

- [ ] **Step 5: Add MCP observer tools**

Add tool definitions and handlers in `apps/web/lib/mcp-tools.ts`:

```ts
get_build_progress_visibility({ buildId })
get_build_sandbox_state({ buildId })
get_build_dispatch_history({ buildId })
get_build_scoped_verification({ buildId })
list_build_activity_since({ buildId, cursor })
```

Each tool must resolve the build through existing authorization checks, return semantic IDs only, and never expose raw secrets, bearer tokens, full stdout, or unbounded logs.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/build/progress-visibility.test.ts apps/web/lib/build/sandbox-state.test.ts apps/web/lib/build/scoped-verification.test.ts apps/web/lib/mcp-tools-build-observer.test.ts
```

Expected: projection and MCP observer tests pass.

## Task 4: Operational Build Studio UI

**Files:**
- Create: `apps/web/components/build/TruthSourceBadge.tsx`
- Create: `apps/web/components/build/TruthSourceBadge.test.tsx`
- Create: `apps/web/components/build/BuildSandboxCard.tsx`
- Create: `apps/web/components/build/BuildSandboxCard.test.tsx`
- Create: `apps/web/components/build/BuildDispatchHistoryCard.tsx`
- Create: `apps/web/components/build/BuildDispatchHistoryCard.test.tsx`
- Create: `apps/web/components/build/BuildVerificationScopedCard.tsx`
- Create: `apps/web/components/build/BuildVerificationScopedCard.test.tsx`
- Create: `apps/web/components/build/BuildProgressOperationalPanel.tsx`
- Create: `apps/web/components/build/BuildProgressOperationalPanel.test.tsx`
- Modify: `apps/web/components/build/BuildStudio.tsx`
- Modify: `apps/web/components/build/ProcessGraph.tsx`

- [ ] **Step 1: Write tests for `TruthSourceBadge`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TruthSourceBadge } from "./TruthSourceBadge";

describe("TruthSourceBadge", () => {
  it("renders source, age, and conflict state", () => {
    render(<TruthSourceBadge source="db-task-results" observedAt="2026-05-18T12:00:00.000Z" ageLabel="2m ago" conflict />);
    expect(screen.getByText("DB")).toBeInTheDocument();
    expect(screen.getByText("2m ago")).toBeInTheDocument();
    expect(screen.getByText("conflict")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement theme-aware badge and cards**

Use only DPF theme variables:

```tsx
className="inline-flex items-center gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--dpf-text)]"
```

Do not use `text-gray-*`, `bg-white`, hardcoded hex values, or red/green Tailwind utility colors in new or touched UI.

- [ ] **Step 3: Write tests for operational panel default content**

The panel test must assert:

```tsx
expect(screen.getByText("0 / 16 tasks complete")).toBeInTheDocument();
expect(screen.getByText("DB")).toBeInTheDocument();
expect(screen.getByText("Chat")).toBeInTheDocument();
expect(screen.getByText("Sandbox")).toBeInTheDocument();
expect(screen.getByText("Dispatch")).toBeInTheDocument();
expect(screen.getByText("Verification")).toBeInTheDocument();
```

- [ ] **Step 4: Default the main panel to operational view**

In `BuildStudio.tsx`, change:

```ts
const [buildView, setBuildView] = useState<"preview" | "docs" | "graph">("graph");
```

to:

```ts
const [buildView, setBuildView] = useState<"progress" | "topology" | "preview" | "docs">("progress");
```

Render `BuildProgressOperationalPanel` for `progress`. Render `ProcessGraph` only in `topology`, and label it "Topology".

**Polling:** `BuildProgressOperationalPanel` must refresh its projection data. Grep `BuildStudio.tsx` for the existing polling or SSE pattern (likely `useEffect` + `setInterval` or a server-sent event hook). Reuse that mechanism for `getBuildProgressVisibility` rather than introducing a second polling cycle. If no polling exists today, add a `useInterval` hook polling every 30 seconds when the build status is `IN_PROGRESS` or `BLOCKED`, and stop polling when status is terminal (`SHIPPED`, `FAILED`, `CANCELLED`).

- [ ] **Step 5: Keep the graph useful but secondary**

Update `ProcessGraph.tsx` to call `fitView` when `build.buildId` or task result version changes. Replace hardcoded graph background values in touched code with CSS variables or existing theme classes.

- [ ] **Step 6: Run focused UI tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/build/TruthSourceBadge.test.tsx apps/web/components/build/BuildProgressOperationalPanel.test.tsx apps/web/components/build/BuildSandboxCard.test.tsx apps/web/components/build/BuildDispatchHistoryCard.test.tsx apps/web/components/build/BuildVerificationScopedCard.test.tsx apps/web/components/build/BuildStudioHeaderLayout.test.tsx
```

Expected: tests pass with the progress view as the default operator surface.

## Task 5: Resume Observability and Specific Failure Heading

**Files:**
- Modify: `apps/web/lib/actions/build.ts`
- Modify: `apps/web/components/build/build-studio-workflow-actions.ts`
- Modify: `apps/web/components/build/build-studio-workflow-actions.test.ts`
- Modify: `apps/web/components/build/BuildStudioWorkflowActionCard.tsx`
- Modify: `apps/web/components/build/BuildStudioWorkflowActionCard.test.tsx`

- [ ] **Step 1: Write tests for specific failure headings**

Add cases asserting:

```ts
expect(guidance.title).toBe("Click Resume to re-execute 3 blocked tasks");
expect(guidance.failureAxis).toBe("usage-limit");
expect(guidance.message).toContain("usage-limit");
```

and:

```ts
expect(guidance.title).toBe("Review workspace noise before retrying this build");
expect(guidance.failureAxis).toBe("out-of-scope-noise");
```

- [ ] **Step 2: Extend `BuildStudioWorkflowAction`**

Add fields:

```ts
failureAxis?: BuildFailureAxis | null;
truthSources?: TruthNumericSnapshot[];
resumeMode?: {
  mode: "replan-and-dispatch" | "reset-blocked" | "already-running" | "rerun-verification";
  label: string;
  reason: string;
};
```

Note: `"no-op"` renamed to `"already-running"` — operator-visible label must communicate state, not implementation intent. The `"rerun-verification"` mode should only be offered when build status is `NEEDS_REVIEW`, not `BLOCKED`.

- [ ] **Step 3: Return resume outcome metadata from the server action**

Change `resumeBuildImplementation(buildId): Promise<void>` to:

```ts
export type ResumeBuildImplementationOutcome = {
  mode: "replan-and-dispatch" | "reset-blocked" | "already-running" | "rerun-verification";
  resetTasks: number;
  dispatchQueued: boolean;
  message: string;
};
```

Preserve the existing DB update and fire-and-forget `autoExecuteBuild(buildId).catch(...)` behavior. This task reports what the current action did; it does not change pipeline execution rules.

- [ ] **Step 4: Render pre-click and post-click mode**

In `BuildStudioWorkflowActionCard.tsx`, show the resume mode under the primary message and show a transient result after the click:

```tsx
{lastOutcome ? (
  <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]">
    {lastOutcome.message}
  </div>
) : null}
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/build/build-studio-workflow-actions.test.ts apps/web/components/build/BuildStudioWorkflowActionCard.test.tsx apps/web/lib/actions/build-governed.test.ts
```

Expected: resume behavior remains compatible while the UI can distinguish no-op, reset, queued dispatch, and verification-only recovery.

## Task 6: Stale Chat Snapshot and Quiet-Agent Evidence

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Modify: relevant coworker panel message/status component discovered by `rg "Agent is working|build status|build-progress-update" apps/web/components apps/web/app`
- Test: add or extend the matching coworker component tests
- Modify: `apps/web/lib/build/progress-visibility.ts`

- [ ] **Step 1: Locate the coworker status renderer**

Run:

```powershell
rg "Agent is working|build status|build-progress-update|open-agent-panel" apps/web/components apps/web/app apps/web/lib -n
```

Record the exact component path in this plan before editing the renderer.

Discovered renderer: `apps/web/components/agent/AgentMessageInput.tsx` owns the literal busy placeholder (`Agent is working... type your next message`). The Build Studio-specific quiet evidence warning is rendered in `apps/web/components/build/BuildProgressOperationalPanel.tsx`, backed by `apps/web/lib/build/progress-visibility.ts`.

- [ ] **Step 2: Add stale self-report extraction to the projection**

Extract chat messages that match:

```ts
/(\d+)\s*(?:\/|of)\s*(\d+)\s+tasks?\b/i
```

Validation guards before treating a match as a progress snapshot:
- Numerator must be ≤ denominator (a "14 of 12 tasks" match is malformed — skip it)
- Denominator must be > 0
- The match must appear in a message role of `"assistant"` — skip user messages

Store them as collapsed audit snapshots when newer DB taskResults exist.

- [ ] **Step 3: Add quiet-agent timeout**

The projection marks `quietAgent.quiet = true` when:

```ts
Date.now() - max(lastDispatch.startedAt, lastActivity.createdAt, taskResults.timestamp, verificationOut.timestamp) > 5 * 60 * 1000
```

and the UI is still showing an active working state.

**In-flight dispatch guard:** if the most recent `BuildDispatchAttempt` has `startedAt` set but `completedAt = null`, the dispatch is in progress. Do NOT set `quietAgent.quiet = true` in this case regardless of elapsed time — the agent is working, the process just hasn't completed yet. Only flag quiet when the last completed dispatch was > 5 minutes ago and no new dispatch has started since.

- [ ] **Step 4: Render quiet warning with evidence link**

The UI text must follow this shape:

```text
Agent has been quiet for 7m - view last action
```

The link opens the build's dispatch/activity evidence drawer, not Docker logs.

- [ ] **Step 5: Run focused tests**

Run the component test discovered in Step 1 plus:

```powershell
pnpm --filter web exec vitest run apps/web/lib/build/progress-visibility.test.ts
```

Expected: stale chat status is collapsed and quiet-agent warnings appear only when no observable downstream signal exists.

## Task 7: End-to-End Operator Verification

**Files:**
- Modify: `tests/e2e/platform-qa-plan.md` if the Build Studio phase checklist lacks progress-observability assertions.
- Evidence: capture screenshots or logs in the repo's normal evidence location if an existing Build Studio evidence convention is present.

- [ ] **Step 1: Run typecheck**

```powershell
pnpm --filter web typecheck
```

Expected: no TypeScript errors.

- [ ] **Step 2: Run production build**

```powershell
pnpm --filter web exec next build
```

Expected: production build passes.

- [ ] **Step 3: Exercise the Build Studio path through the portal**

Use the Docker-served install URL from root `.env`. Login as `admin@dpf.local` using `ADMIN_PASSWORD`. Open `/build` and select a build in `BLOCKED` or `NEEDS_REVIEW` status from the live list — do not hardcode `FB-B51C3ED4` as it may not exist in the current install. If no such build exists, trigger one from `BI-0C287A4B` by submitting the Build Studio kickoff prompt above. Verify:

- progress view is the default;
- DB and chat task counts show distinct truth-source badges when they disagree;
- stale chat snapshots collapse into audit history;
- resume pre-click mode is visible;
- resume post-click outcome is visible;
- dispatch failures show stdout/stderr excerpt and failure axis;
- sandbox card reports branch, head SHA, commits ahead, diffstat, and missing expected files;
- scoped verification separates build failures from global workspace noise;
- topology pane remains accessible but is not the default.

- [ ] **Step 4: Exercise MCP observer parity**

Call the MCP tools using the same live build ID from Step 3:

```text
get_build_progress_visibility({ buildId: "<live-build-id>" })
get_build_dispatch_history({ buildId: "<live-build-id>" })
get_build_sandbox_state({ buildId: "<live-build-id>" })
get_build_scoped_verification({ buildId: "<live-build-id>" })
```

Expected: MCP returns the same source-separated facts visible in the portal, without raw secrets or unbounded logs. Confirm `stdoutExcerpt` and `stderrExcerpt` contain no bearer tokens, API keys, or `dpfmcp_` prefixes.

- [ ] **Step 5: Record any platform-path failure as evidence**

If Build Studio, WWMD, dispatch, MCP, or scoped verification stalls during this implementation, record the observed failure with:

- build ID;
- route;
- operator action;
- expected result;
- actual result;
- source of truth used to confirm the failure.

Use `record_functional_failure_evidence` when the failure is UI-observable and reproducible.

## Self-Review Checklist

- [ ] Every original BI acceptance criterion maps to Task 4 or Task 5.
- [ ] Every post-2026-05-18 operator-session requirement maps to Task 2, Task 3, Task 4, Task 5, or Task 6.
- [ ] The plan does not change `runBuildPipeline` or `autoExecuteBuild` semantics.
- [ ] The MCP observer tools consume the same projection as the UI.
- [ ] Dispatch output is excerpted and bounded; raw secrets and full logs are not exposed.
- [ ] Refactoring is part of the work: task parsing and verification parsing are centralized before new UI consumes them.
- [ ] New and touched UI uses DPF theme variables, not hardcoded colors.
