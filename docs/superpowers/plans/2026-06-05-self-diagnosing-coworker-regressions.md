# Self-Diagnosing Coworker Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**BI:** `BI-47443B67` under `EP-COST-001`

**Goal:** DPF detects coworker latency and nudge-loop regressions, files a `PlatformIssueReport`, promotes it through the existing PIR-to-BI triage path, and shows operators a structured diagnosis without a human stitching logs.

**Architecture:** Reuse `PlatformIssueReport`, `AdapterRunTelemetry`, `RouteDecisionLog`, and the existing 15-minute issue-report triage function. Add one focused turn-rollup persistence model only for metrics that do not exist durably today, then enrich PIR descriptions with deterministic diagnosis facts. Do not build a parallel incident system.

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL, Inngest cron functions, Vitest, DPF report-kit UI primitives.

---

## Chief Architect Review

This plan is approved with required corrections. The original direction was right, but it had three architecture risks:

1. It named `AdapterRunTelemetry.inferenceMs`, which does not exist. Use `AdapterRunTelemetry.durationMs` for dispatch latency. `TokenUsage.inferenceMs` exists, but it lacks the same `threadId` and `agentMessageId` correlation and should not drive the thread-diagnosis path.
2. It left Phase 2 undecided between extending `AdapterRunTelemetry` and adding `CoworkerTurnMetric`. Choose `CoworkerTurnMetric`. A turn rollup is not a provider dispatch attempt; storing nudge counts on every adapter call would duplicate aggregate state and make nudge-rate windows harder to query.
3. It treated the operator UI as a verification afterthought. The result must be visible in Admin > Issue Reports using report-kit/theme-aware primitives where touched, because the product value is "the platform explains the regression", not merely "a row exists".

## Live Backlog And Repo Grounding

Live MCP state on 2026-06-05:

- `BI-47443B67` exists under `EP-COST-001`, status `triaging`, type `product`, workType `feature`, source `user-request`.
- Related same-epic items exist and should enrich, not block, this work: `BI-AFF0F06F` (routing-decision trace) and `BI-3AFA7A4F` (persisted per-call latency).
- MCP `search_specs_and_plans` did not find another active plan/spec for `BI-47443B67`, so this file is the implementation handoff artifact.

Repo facts verified in the worktree:

| Need | Current substrate | Where |
|---|---|---|
| Auto-detection to backlog pattern | `checkForSpike` creates `BI-PIR-SPIKE-*` bug backlog items from runtime issue volume | `apps/web/lib/operate/issue-report-triage.ts` |
| PIR writer | `createPlatformIssueReport` is the single server-side writer, applies length limits, and links `threadId`, `agentId`, `routeContext`, `triggerKind`, `source` | `apps/web/lib/quality/platform-issue-reports.ts` |
| PIR triage cadence | `quality/issue-report-triage` runs every 15 minutes, processes open PIRs, and runs spike detection | `apps/web/lib/queue/functions/issue-report-triage.ts` |
| Per-dispatch telemetry | `AdapterRunTelemetry` stores `threadId`, `agentMessageId`, `agentId`, `providerId`, `modelId`, `durationMs`, token counts, status, and error fields | `packages/db/prisma/schema.prisma` |
| Route/task attribution | `AdapterRunTelemetry.agentMessageId` joins to `AgentMessage.id`; `AgentMessage` carries `routeContext` and `taskType` | `packages/db/prisma/schema.prisma` |
| Turn summary | `[turn]` log includes `thread`, `agent`, `route`, `provider`, `model`, `dispatches`, `nudges`, `toolsAttached`, `executedTools`, `totalMs`, but is console-only | `apps/web/lib/tak/agentic-loop.ts` |
| Routing-decision enrichment | `RouteDecisionLog` is persisted with `agentMessageId`; use it when present | `apps/web/lib/routing/loader.ts`, `packages/db/prisma/schema.prisma` |
| Operator surface | Admin Issue Reports exists but has local reporting widgets and inline tone styling in touched areas | `apps/web/components/admin/IssueReportPanel.tsx` |

## Standards Adopted

- OpenTelemetry GenAI semantic conventions use operation duration and token-usage metrics for AI calls. DPF does not need to adopt OTel in this slice, but the data names should stay compatible: operation duration = `durationMs`, token usage = input/output/cached tokens.
- OpenTelemetry Metrics guidance treats metrics as runtime measurements consumed by a backend; this plan keeps detector data bounded, numeric, and aggregatable rather than parsing prose logs.
- Google SRE alerting guidance favors symptom-based alerts and anti-flap controls. The detector alerts on user-visible coworker turn latency/nudge symptoms and requires sample thresholds, a trailing baseline, and deduplication.

References:

- OpenTelemetry GenAI metrics: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/
- OpenTelemetry metrics concepts: https://opentelemetry.io/docs/concepts/signals/metrics/
- Google SRE practical alerting: https://sre.google/sre-book/practical-alerting/

## Architectural Rules For Implementation

- **Reuse first:** `PlatformIssueReport` remains the canonical issue record. The detector creates PIRs; the existing triage job promotes open PIRs to bug backlog items.
- **No hidden direct DB write workaround:** if MCP evidence capture or backlog writes need scope escalation, stop and surface the needed scope. Do not bypass write-scope controls with ad hoc SQL.
- **One additive model only:** `CoworkerTurnMetric` is the single new persistence shape, because nudge and dispatch summaries are turn-level facts.
- **No LLM diagnosis in this BI:** deterministic rules first. LLM narratives are a later enhancement only after rule accuracy is proven.
- **Operator-facing UI matters:** any touched Issue Reports reporting UI must use `apps/web/components/ui/report-kit/` and DPF CSS variables. Do not add new local status color maps, inline color styles, or hand-rolled tables/badges.
- **Refactoring budget:** spend about 20% of implementation effort on focused refactoring that reduces future churn: shared detector math, a shared PIR filing helper, and report-kit migration for touched Issue Reports widgets. Do not spend this budget on broad renames or unrelated cleanup.

## File Structure

Create:

- `apps/web/lib/operate/coworker-regression-detector.ts` — pure detector math plus orchestration for latency and nudge-rate checks.
- `apps/web/lib/operate/coworker-regression-diagnosis.ts` — deterministic diagnosis assembly from turn metrics, adapter telemetry, and route decisions.
- `apps/web/lib/operate/coworker-turn-metrics.ts` — fire-and-forget writer and read helpers for turn metrics.
- `apps/web/lib/operate/coworker-regression-detector.test.ts` — detector threshold, p95, dedup, exemplar, and severity tests.
- `apps/web/lib/operate/coworker-regression-diagnosis.test.ts` — deterministic probable-cause tests.
- `apps/web/lib/operate/coworker-turn-metrics.test.ts` — writer shape and fail-open tests.
- `apps/web/lib/queue/functions/coworker-regression-detect.ts` — Inngest cron entry point.
- `packages/db/prisma/migrations/<timestamp>_add_coworker_turn_metric/migration.sql` — additive migration.

Modify:

- `packages/db/prisma/schema.prisma` — add `CoworkerTurnMetric` and indexes.
- `apps/web/lib/tak/agentic-loop.ts` — call `recordCoworkerTurnMetric()` where `logTurnSummary()` fires.
- `apps/web/lib/queue/functions/index.ts` — export/register the new Inngest function.
- `apps/web/lib/queue/functions/issue-report-triage.ts` only if a shared PIR/backlog helper is extracted; otherwise leave the existing triage cadence unchanged.
- `apps/web/components/admin/IssueReportPanel.tsx` — add `triggerKind` to `ReportRow`, show structured diagnosis, and migrate touched reporting widgets to report-kit primitives.
- `apps/web/components/admin/IssueReportPanel.test.tsx` — assert diagnosis visibility and report-kit-safe rendering.

## Task 1: Latency Detector Over Existing Telemetry

**Files:**

- Create: `apps/web/lib/operate/coworker-regression-detector.ts`
- Create: `apps/web/lib/operate/coworker-regression-detector.test.ts`
- Create: `apps/web/lib/queue/functions/coworker-regression-detect.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`

- [ ] **Step 1: Write p95 and baseline tests**

Add tests that use in-memory rows shaped like `AdapterRunTelemetry`:

```ts
import { describe, expect, it } from "vitest";
import {
  computeP95,
  groupDispatchRowsIntoTurns,
  shouldFileLatencyRegression,
} from "./coworker-regression-detector";

describe("coworker latency regression detector", () => {
  it("groups dispatch rows by threadId and agentMessageId and sums durationMs", () => {
    const turns = groupDispatchRowsIntoTurns([
      { threadId: "thr-1", agentMessageId: "msg-1", agentId: "support-specialist", routeContext: "/platform/ai", taskType: "conversation", durationMs: 1200, startedAt: new Date("2026-06-05T10:00:00Z") },
      { threadId: "thr-1", agentMessageId: "msg-1", agentId: "support-specialist", routeContext: "/platform/ai", taskType: "conversation", durationMs: 800, startedAt: new Date("2026-06-05T10:00:02Z") },
      { threadId: null, agentMessageId: "msg-2", agentId: "support-specialist", routeContext: "/platform/ai", taskType: "conversation", durationMs: 999, startedAt: new Date("2026-06-05T10:00:03Z") },
    ]);

    expect(turns).toEqual([
      expect.objectContaining({
        threadId: "thr-1",
        agentMessageId: "msg-1",
        agentId: "support-specialist",
        routeContext: "/platform/ai",
        totalMs: 2000,
      }),
    ]);
  });

  it("files only when sample size and p95 ratio both clear the threshold", () => {
    expect(computeP95([1000, 1100, 1200, 9000])).toBe(9000);
    expect(
      shouldFileLatencyRegression({
        recentP95Ms: 9000,
        baselineP95Ms: 2000,
        recentSampleCount: 12,
        minSamples: 10,
        factor: 3,
      }),
    ).toEqual({ file: true, ratio: 4.5 });
  });
});
```

- [ ] **Step 2: Run the failing detector tests**

Run from the worktree:

```powershell
pnpm --filter web exec vitest run apps/web/lib/operate/coworker-regression-detector.test.ts
```

Expected: fail because the detector module does not exist.

- [ ] **Step 3: Implement pure detector helpers**

Create helpers with these contracts:

```ts
export type AdapterTurnDispatchRow = {
  threadId: string | null;
  agentMessageId: string | null;
  agentId: string | null;
  routeContext: string | null;
  taskType: string | null;
  durationMs: number | null;
  startedAt: Date;
};

export type CoworkerTurnSample = {
  threadId: string;
  agentMessageId: string;
  agentId: string | null;
  routeContext: string | null;
  taskType: string | null;
  totalMs: number;
  startedAt: Date;
};

export function groupDispatchRowsIntoTurns(rows: AdapterTurnDispatchRow[]): CoworkerTurnSample[];
export function computeP95(values: number[]): number | null;
export function shouldFileLatencyRegression(input: {
  recentP95Ms: number | null;
  baselineP95Ms: number | null;
  recentSampleCount: number;
  minSamples: number;
  factor: number;
}): { file: boolean; ratio: number | null };
```

Rules:

- Skip rows missing `threadId`, missing `agentMessageId`, or lacking a positive `durationMs`.
- Group by `threadId::agentMessageId`.
- Use the earliest `startedAt` as the turn timestamp.
- For `(agentId, routeContext)` buckets, treat null values as `"unknown"` only inside grouping keys; do not persist `"unknown"` placeholders.

- [ ] **Step 4: Add detector orchestration**

Add `detectCoworkerLatencyRegressions(deps)` that:

- reads recent rows for the last 60 minutes and baseline rows for the prior 7 days;
- joins `AgentMessage` by `agentMessageId` to recover `routeContext` and `taskType`;
- groups rows into turns;
- buckets by `(agentId, routeContext)`;
- computes p95 for recent and baseline windows;
- requires `MIN_SAMPLES` and `p95 >= baseline * FACTOR`;
- picks the worst recent turn as exemplar;
- checks for an existing open PIR with `source="coworker-regression-detector"`, `triggerKind="latency-regression"`, same `agentId`, and same `routeContext`;
- files a PIR with `createPlatformIssueReport()` if no duplicate exists.

Use conservative defaults:

```ts
const DEFAULT_RECENT_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_BASELINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MIN_SAMPLES = 10;
const DEFAULT_FACTOR = 3;
```

- [ ] **Step 5: Register the Inngest cron**

Create `apps/web/lib/queue/functions/coworker-regression-detect.ts`:

```ts
import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const coworkerRegressionDetect = inngest.createFunction(
  { id: "quality/coworker-regression-detect", retries: 2, triggers: [cron("*/15 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("detect-coworker-regressions", async () => {
      const { detectCoworkerLatencyRegressions } = await import("@/lib/operate/coworker-regression-detector");
      return detectCoworkerLatencyRegressions();
    });
  },
);
```

Export it from `apps/web/lib/queue/functions/index.ts`.

- [ ] **Step 6: Run tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/operate/coworker-regression-detector.test.ts apps/web/lib/queue/functions/index.test.ts
```

Expected: pass in the worktree.

## Task 2: Persist Turn Metrics For Nudge Detection

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_coworker_turn_metric/migration.sql`
- Create: `apps/web/lib/operate/coworker-turn-metrics.ts`
- Create: `apps/web/lib/operate/coworker-turn-metrics.test.ts`
- Modify: `apps/web/lib/tak/agentic-loop.ts`
- Modify: `apps/web/lib/tak/agentic-loop.test.ts`

- [ ] **Step 1: Add the Prisma model**

Add:

```prisma
model CoworkerTurnMetric {
  id              String   @id @default(cuid())
  threadId        String
  agentMessageId  String
  agentId         String?
  routeContext    String?
  taskType        String?
  providerId      String?
  modelId         String?
  dispatches      Int      @default(0)
  nudges          Int      @default(0)
  toolsAttached   Boolean  @default(false)
  executedTools   Int      @default(0)
  totalMs         Int?
  createdAt       DateTime @default(now())

  @@unique([threadId, agentMessageId])
  @@index([agentId, routeContext, createdAt])
  @@index([threadId, createdAt])
}
```

Migration SQL must be additive only. Do not backfill from logs.

- [ ] **Step 2: Write the fail-open writer tests**

Test that `recordCoworkerTurnMetric()` upserts by `(threadId, agentMessageId)`, does not write without either key, and suppresses Prisma errors.

- [ ] **Step 3: Implement the writer**

Create `recordCoworkerTurnMetric(input)` in `apps/web/lib/operate/coworker-turn-metrics.ts`.

Requirements:

- It must be fire-and-forget safe: catch and `console.warn`, never throw.
- It must upsert by `(threadId, agentMessageId)` so duplicate `logTurnSummary()` calls do not duplicate turn rows.
- It must store null for absent provider/model/route/agent values rather than synthetic placeholders.

- [ ] **Step 4: Wire the writer at the existing turn summary point**

In `apps/web/lib/tak/agentic-loop.ts`, update `logTurnSummary(provider, model)` to also call:

```ts
void recordCoworkerTurnMetric({
  threadId,
  agentMessageId: agentMessageId ?? null,
  agentId,
  routeContext,
  taskType: taskType ?? null,
  providerId: provider,
  modelId: model,
  dispatches: inferenceCallCount,
  nudges: continuationNudges,
  toolsAttached: toolsAttachedForTurn,
  executedTools: executedTools.length,
  totalMs: Date.now() - startTime,
});
```

Keep the existing console log for immediate operator debugging until the new PIR flow is proven.

- [ ] **Step 5: Extend detector for nudge-rate regression**

Add a detector path that reads `CoworkerTurnMetric`, buckets by `(agentId, routeContext)`, and files a `triggerKind="nudge-rate-regression"` PIR when sample thresholds pass and either:

- the baseline share is greater than zero and the recent share of turns with `nudges > 0` is at least `DEFAULT_FACTOR` times the baseline share; or
- the baseline share is zero and the recent share is at least `DEFAULT_MIN_NUDGE_RATE`.

Use `DEFAULT_MIN_NUDGE_RATE = 0.2` for the zero-baseline case so one isolated nudge does not alert on a small sample.

Dedup uses the same source/trigger/agent/route/status predicate as latency.

- [ ] **Step 6: Run tests and migration check**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/operate/coworker-turn-metrics.test.ts apps/web/lib/operate/coworker-regression-detector.test.ts apps/web/lib/tak/agentic-loop.test.ts
pnpm --filter @dpf/db exec prisma validate
```

Expected: tests pass and Prisma schema validates in the worktree.

## Task 3: Deterministic Diagnosis Enrichment

**Files:**

- Create: `apps/web/lib/operate/coworker-regression-diagnosis.ts`
- Create: `apps/web/lib/operate/coworker-regression-diagnosis.test.ts`
- Modify: `apps/web/lib/operate/coworker-regression-detector.ts`

- [ ] **Step 1: Write diagnosis tests**

Cover these cause tags:

- `nudge-redispatch-loop` when `nudges > 0` and `dispatches > 1`;
- `full-tool-surface-on-conversational-turn` when `toolsAttached=true`, `executedTools=0`, and `taskType` is `conversation` or missing on a non-`/build` route;
- `slow-provider-dispatch` when one provider/model dominates duration;
- `tool-call-exploration` when `executedTools` is high and dispatch duration is not dominant;
- `insufficient-evidence` when required rows are missing.

- [ ] **Step 2: Implement diagnosis assembly**

`buildCoworkerRegressionDiagnosis(input)` should return:

```ts
export type CoworkerRegressionDiagnosis = {
  probableCause:
    | "nudge-redispatch-loop"
    | "full-tool-surface-on-conversational-turn"
    | "slow-provider-dispatch"
    | "tool-call-exploration"
    | "insufficient-evidence";
  summary: string;
  metrics: {
    dispatches: number | null;
    nudges: number | null;
    toolsAttached: boolean | null;
    executedTools: number | null;
    totalMs: number | null;
    taskType: string | null;
    providerId: string | null;
    modelId: string | null;
  };
};
```

The summary must be deterministic, short, and suitable for `PlatformIssueReport.description`.

- [ ] **Step 3: Enrich PIR filing**

When the detector files a PIR, include:

- report title with trigger and bucket, for example `Coworker latency regression: support-specialist on /platform/ai`;
- description with baseline p95, recent p95, ratio, exemplar thread, agent message, and diagnosis block;
- `source="coworker-regression-detector"`;
- `triggerKind="latency-regression"` or `triggerKind="nudge-rate-regression"`;
- `threadId` of the worst exemplar;
- `agentId` and `routeContext` where available;
- `severity` as `medium`, `high`, or `critical` based on ratio and absolute latency.

- [ ] **Step 4: Run tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/operate/coworker-regression-diagnosis.test.ts apps/web/lib/operate/coworker-regression-detector.test.ts
```

Expected: pass in the worktree.

## Task 4: Operator UI In Admin Issue Reports

**Files:**

- Modify: `apps/web/components/admin/IssueReportPanel.tsx`
- Modify: `apps/web/components/admin/IssueReportPanel.test.tsx`
- Modify if needed: `apps/web/components/ui/report-kit/statusColors.ts`

- [ ] **Step 1: Add a diagnosis rendering test**

Add a report fixture with:

```ts
{
  source: "coworker-regression-detector",
  triggerKind: "latency-regression",
  description: "Diagnosis: slow-provider-dispatch\nRecent p95: 9000ms\nBaseline p95: 2000ms\nDispatches: 3\nNudges: 1\nTools attached: true\nProbable cause: slow-provider-dispatch",
}
```

Assert that the rendered panel shows:

- `Coworker regression`;
- `slow-provider-dispatch`;
- `Recent p95`;
- an action to send the PIR to Build Studio as a fix.

- [ ] **Step 2: Migrate touched reporting widgets to report-kit**

Add `triggerKind: string | null` to the component's `ReportRow` type. `getIssueReports()` already returns full `PlatformIssueReport` rows, so this is a component contract fix, not a query rewrite.

Replace local `StatCard`, local severity chips, and inline tone styles in touched areas with:

- `StatCard` from `@/components/ui/report-kit`;
- `StatusBadge` for severity/status/trigger;
- `resolveIntent` or `STATUS_INTENT` additions in `statusColors.ts` if a new domain mapping is needed.

Do not introduce raw hex, `text-gray-*`, `bg-white`, `text-black`, or inline color styles.

- [ ] **Step 3: Render diagnosis as scannable operator evidence**

Keep the expanded report layout compact:

- title and status row;
- `Coworker regression` badge when `source === "coworker-regression-detector"`;
- diagnosis summary;
- compact metric rows for `recent p95`, `baseline p95`, `ratio`, `dispatches`, `nudges`, `toolsAttached`, `provider`, `model`;
- existing actions preserved.

- [ ] **Step 4: Run UI tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/admin/IssueReportPanel.test.tsx
```

Expected: pass in the worktree.

## Task 5: Functional Evidence And Build Gate

**Files:**

- No new source files unless test utilities need small fixtures.

- [ ] **Step 1: Run source-local tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/operate/coworker-regression-detector.test.ts apps/web/lib/operate/coworker-regression-diagnosis.test.ts apps/web/lib/operate/coworker-turn-metrics.test.ts apps/web/lib/tak/agentic-loop.test.ts apps/web/components/admin/IssueReportPanel.test.tsx
pnpm --filter web typecheck
```

Expected: pass in the worktree. This is source-local evidence only.

- [ ] **Step 2: Run migration apply check on the canonical runtime or shared local-CI sandbox**

Use the canonical local install or `local-integration-ci` lease. Do not treat a worktree-only Prisma check as migration evidence.

Expected: migration applies cleanly and leaves existing PIR/telemetry rows intact.

- [ ] **Step 3: Run production build on the canonical runtime or shared local-CI sandbox**

Run the build gate on the canonical substrate named in `AGENTS.md`.

Expected: production build succeeds with zero errors.

- [ ] **Step 4: Functional UX verification**

On the canonical local install:

1. Create or seed correlated `AdapterRunTelemetry` rows with the same `threadId` and `agentMessageId`, recent p95 above threshold, and baseline rows below threshold.
2. Run `quality/coworker-regression-detect`.
3. Confirm one open PIR exists with `source="coworker-regression-detector"`, `triggerKind="latency-regression"`, exemplar `threadId`, and structured diagnosis in `description`.
4. Run or wait for `quality/issue-report-triage`.
5. Confirm a bug backlog item is created through the existing PIR triage path.
6. Open Admin > Issue Reports and confirm the regression diagnosis is visible, scannable, and action-ready.

Expected: the platform produces the same diagnosis an operator would otherwise assemble manually.

## Definition Of Done

- A slow or nudge-looping coworker turn on the canonical local install causes a deduplicated PIR to be auto-filed.
- The PIR carries structured diagnosis: dispatches, nudges, toolsAttached, executedTools, provider, model, totalMs, baseline, recent p95 or nudge rate, and probable cause.
- The existing issue-report triage path promotes the PIR to a bug backlog item without a parallel incident pipeline.
- Admin > Issue Reports displays the diagnosis with theme-aware report-kit UI and no new hardcoded color/status logic.
- Source-local tests pass in the worktree; production build, UX verification, and migration apply are recorded with their canonical substrate.
