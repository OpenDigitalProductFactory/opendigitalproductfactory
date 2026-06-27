# Governed Adaptive Playbooks Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first testable foundation for Governed Adaptive Playbooks: durable work-pattern metadata, richer context/tool-surface telemetry, systemic capability-need observation, attributable periodic agent reviews, and EA/SysML grounding.

**Architecture:** Start with existing DPF substrates instead of a new WorkPattern table: `TaskRun.a2aMetadata`, `TaskRun.repeatedPatternKey`, `CoworkerTurnMetric`, `ToolExecution`, `CoworkerSelfAssessment`, `CoworkerCapabilityNeed`, `ImprovementSignal`, and the EA/SysML parity engine. Pattern candidates are evidence-backed proposals only; they do not activate skills, prompts, grants, model routes, Work Case state, or code. Case-bound proposals carry Work Case references when available, but consequential case transitions remain blocked behind the Work Case governed Action and receipt-coverage work.

**Tech Stack:** Next.js 16 monorepo, TypeScript, Prisma 7, Vitest, Inngest, DPF TAK runtime, coworker self-assessment substrate, EA/SysML projection helpers.

---

## Scope

This plan implements the first foundation wave from `docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md`.

It covers:

- Typed Work Pattern metadata in `TaskRun.a2aMetadata.workPattern`.
- Pattern query key stamping through existing `TaskRun.repeatedPatternKey`.
- Durable context/tool-surface telemetry on existing `CoworkerTurnMetric`.
- Pure pattern classification for systemic needs.
- A side-effect service that emits `CoworkerSelfAssessment`, `CoworkerCapabilityNeed`, and `ImprovementSignal`.
- A periodic profile-review runner owned by the install superuser and executed by the reviewing agent.
- EA/SysML projection support for `ACT-GAP-*`, `SM-GAP-PROMOTION`, and `VC-GAP-*` using the existing parity engine.

It does not cover:

- A new `WorkPattern` Prisma model.
- A new capability-need kind.
- A new decision ledger, receipt ledger, architecture model, or work surface.
- Operator UI.
- Automatic activation of a candidate playbook.
- Work Case consequential transitions.
- Trust graduation, shadow-ledger comparison, or Ornith model routing.

Live backlog grounding checked 2026-06-27:

- `EP-2984B02B` / `BI-40EE7AFD`: Work Case Wave 0 is in progress and is the dependency for case-bound source/status references.
- `EP-8AF1C996` / `BI-DE4BF92F` and `BI-40CD8ACD`: trust/shadow/autonomy-ceiling work is in progress and must gate later promotion behavior.
- `EP-COWORKER-INTERACTIVITY` has active tool-surface, grant, envelope, and context-overflow items that this observer should learn from rather than bypass.
- `EP-MODEL-TIER-ROUTING` remains the lane for Ornith/model adoption; this plan only records model-mismatch evidence.

## Refactoring Budget

Reserve roughly 20 percent of implementation effort for refactoring that reduces future complexity:

- Extract typed metadata helpers instead of reaching into `a2aMetadata` ad hoc.
- Extend the existing turn-metric writer instead of scraping `[turn]` logs.
- Split pure classification from DB side effects.
- Add one EA/SysML extractor/reconciler in the existing parity-engine style.
- Keep observer wiring as a post-run hook; do not fork a second reflection subsystem.

Do not spend this budget on navigation, AI Workforce UI, Operations Map layout, Work Case UI, or broad schema cleanup.

## File Map

Create:

- `apps/web/lib/tak/work-pattern-types.ts` - pure types, metadata parsing, merge helpers, pattern key/fingerprint helpers, decision-scope mapping.
- `apps/web/lib/tak/work-pattern-types.test.ts` - metadata and fingerprint unit tests.
- `apps/web/lib/tak/pattern-observer.ts` - pure signal classifier that converts evidence windows into capability needs and candidate metadata.
- `apps/web/lib/tak/pattern-observer.test.ts` - classifier tests for grant denial, tool-surface pressure, repeated tool failure, repeated approval, and dedupe.
- `apps/web/lib/tak/pattern-observer-service.ts` - DB-backed observer that loads evidence, stamps `TaskRun`, and emits self-assessment + improvement signal.
- `apps/web/lib/tak/pattern-observer-service.test.ts` - injected-DB tests for side effects and loop guard behavior.
- `apps/web/lib/tak/work-pattern-profile-review.ts` - deterministic periodic agent review runner.
- `apps/web/lib/tak/work-pattern-profile-review.test.ts` - superuser ownership and output tests.
- `apps/web/lib/queue/functions/work-pattern-profile-review.ts` - Inngest cron entry.
- `apps/web/lib/ea/work-pattern-architecture-extract.ts` - pure SysML desired model builder for playbook foundation concepts and observed pattern elements.
- `apps/web/lib/ea/work-pattern-architecture-extract.test.ts` - EA element/relationship tests.
- `apps/web/lib/ea/reconcile-work-pattern-architecture.ts` - idempotent parity-engine reconcile shell.
- `apps/web/lib/ea/reconcile-work-pattern-architecture.test.ts` - apply/reconcile tests with injected DB.

Modify:

- `packages/db/prisma/schema.prisma` - add numeric/boolean context-economy fields to `CoworkerTurnMetric`; do not add string enum columns.
- `packages/db/prisma/migrations/<timestamp>_add_coworker_turn_context_economy/migration.sql` - generated migration for the telemetry fields.
- `apps/web/lib/operate/coworker-turn-metrics.ts` - accept/write the new telemetry fields.
- `apps/web/lib/operate/coworker-turn-metrics.test.ts` - writer coverage for new fields.
- `apps/web/lib/tak/agentic-loop.ts` - pass context/tool-surface metrics into `recordCoworkerTurnMetric`.
- `apps/web/lib/tak/autonomous-work-run.ts` - fire-and-forget pattern observer after the agentic loop.
- `apps/web/lib/tak/autonomous-work-run.test.ts` - verify the observer is called and fail-open.
- `apps/web/lib/queue/functions/index.ts` - register the periodic review cron.
- `apps/web/lib/ea/reconcile-sysml-projections.ts` - add the Work Pattern projection domain.
- `apps/web/lib/ea/architecture-parity-steward.ts` - add a domain label for Work Pattern projection health.
- `apps/web/lib/ea/reconcile-sysml-projections.test.ts` - verify domain isolation still applies.
- `docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md` - link this plan if any implementation detail changes the design summary.

## Chunk 1: Metadata Helpers

### Task 1: Add typed Work Pattern metadata helpers

**Files:**

- Create: `apps/web/lib/tak/work-pattern-types.ts`
- Create: `apps/web/lib/tak/work-pattern-types.test.ts`

- [ ] **Step 1: Write metadata parsing tests**

Add tests for all of these cases:

```ts
import { describe, expect, it } from "vitest";
import {
  mergeWorkPatternMetadata,
  parseWorkPatternMetadata,
  patternDecisionScope,
  workPatternFingerprint,
} from "./work-pattern-types";

describe("work-pattern metadata", () => {
  it("parses valid metadata and rejects malformed status", () => {
    expect(parseWorkPatternMetadata({
      patternKey: "gap:build:review-repeat",
      status: "observed",
      scope: "build-phase",
      version: 1,
      source: "observer",
    })?.patternKey).toBe("gap:build:review-repeat");

    expect(parseWorkPatternMetadata({
      patternKey: "gap:bad",
      status: "auto-activated",
      scope: "agent",
      version: 1,
      source: "observer",
    })).toBeNull();
  });

  it("merges metadata without dropping unrelated TaskRun metadata", () => {
    const next = mergeWorkPatternMetadata(
      { reflectionDepth: 1, sourceRef: { kind: "x", id: "y" } },
      { patternKey: "gap:agent:grant-denial", status: "observed", scope: "agent", version: 1, source: "observer" },
    );
    expect(next.reflectionDepth).toBe(1);
    expect(next.workPattern).toMatchObject({ patternKey: "gap:agent:grant-denial" });
  });

  it("maps decision scope by playbook scope", () => {
    expect(patternDecisionScope("build-phase")).toBe("platform-wwmd");
    expect(patternDecisionScope("case-type")).toBe("company-wwwd");
    expect(patternDecisionScope("activity")).toBe("profession-wsid");
  });

  it("produces stable fingerprints from normalized evidence", () => {
    expect(workPatternFingerprint({
      agentId: "AGT-BUILD",
      routeContext: "/build",
      kind: "grant",
      normalizedNeed: "missing deploy grant",
    })).toBe(workPatternFingerprint({
      agentId: "AGT-BUILD",
      routeContext: "/build",
      kind: "grant",
      normalizedNeed: "  Missing   deploy grant. ",
    }));
  });
});
```

- [ ] **Step 2: Run the failing metadata tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/work-pattern-types.test.ts
```

Expected: fails because `work-pattern-types.ts` does not exist.

- [ ] **Step 3: Implement the pure metadata module**

Include these exported shapes and helpers:

```ts
import type { CoworkerCapabilityNeedKind } from "@/lib/coworker-self-assessment/types";

export const WORK_PATTERN_STATUSES = ["observed", "candidate", "approved", "active", "retired"] as const;
export type WorkPatternStatus = (typeof WORK_PATTERN_STATUSES)[number];

export const WORK_PATTERN_SCOPES = [
  "agent",
  "route",
  "skill",
  "build-phase",
  "activity",
  "risk-class",
  "case-type",
  "case-transition",
] as const;
export type WorkPatternScope = (typeof WORK_PATTERN_SCOPES)[number];

export type WorkPatternDecisionScope = "platform-wwmd" | "company-wwwd" | "profession-wsid";
export type WorkPatternSource = "observer" | "periodic-review" | "human-review" | "shadow-trial";

export type WorkPatternEvidenceRef = {
  taskRunId?: string;
  toolExecutionId?: string;
  improvementSignalId?: string;
  capabilityNeedId?: string;
  backlogItemId?: string;
  workCaseRef?: string;
  receiptId?: string;
  decisionInteractionId?: string;
};

export type WorkCasePatternBinding = {
  caseType?: string;
  transitionKey?: string;
  governedActionKey?: string;
  authorityMode?: "autonomous" | "on-behalf-of" | "authenticated-inbound";
  sponsorPrincipalId?: string;
  receiptPolicy?: "governed-action" | "observed-event";
};

export type WorkPatternMetadata = {
  patternKey: string;
  status: WorkPatternStatus;
  scope: WorkPatternScope;
  version: number;
  source: WorkPatternSource;
  decisionScope?: WorkPatternDecisionScope;
  evidence?: WorkPatternEvidenceRef[];
  candidate?: {
    kind: CoworkerCapabilityNeedKind;
    need: string;
    blocks: string;
    evaluationMethod: string;
    fingerprint: string;
  };
  workCaseBinding?: WorkCasePatternBinding;
  observedAt?: string;
};
```

Implementation notes:

- Use local type guards, not a new runtime validation dependency.
- `parseWorkPatternMetadata(value)` returns `WorkPatternMetadata | null`.
- `mergeWorkPatternMetadata(existing, metadata)` returns a plain JSON-safe object with existing keys preserved and `workPattern` replaced.
- `patternDecisionScope(scope)` returns `company-wwwd` for `case-type` and `case-transition`, `platform-wwmd` for `build-phase`, `skill`, `route`, and `agent`, and `profession-wsid` for `activity` and `risk-class`.
- `normalizePatternText(value)` trims, lowercases, collapses whitespace, strips a trailing period, and is used by `workPatternFingerprint`.
- Do not import Prisma.

- [ ] **Step 4: Re-run the metadata tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/work-pattern-types.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit metadata helpers**

Run:

```powershell
git add apps/web/lib/tak/work-pattern-types.ts apps/web/lib/tak/work-pattern-types.test.ts
git commit -s -m "feat: add work pattern metadata helpers"
```

## Chunk 2: Context And Tool-Surface Telemetry

### Task 2: Extend CoworkerTurnMetric without string enum columns

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/<timestamp>_add_coworker_turn_context_economy/migration.sql`
- Modify: `apps/web/lib/operate/coworker-turn-metrics.ts`
- Modify: `apps/web/lib/operate/coworker-turn-metrics.test.ts`
- Modify: `apps/web/lib/tak/agentic-loop.ts`

- [ ] **Step 1: Write writer tests for new telemetry fields**

Extend `apps/web/lib/operate/coworker-turn-metrics.test.ts`:

```ts
it("persists numeric context and tool-surface telemetry", async () => {
  const { upsert, getDelegate } = makeDelegate();

  await recordCoworkerTurnMetric(
    {
      threadId: "thr-ctx",
      agentMessageId: "msg-ctx",
      ctxPeakTokens: 82000,
      ctxWindowTokens: 128000,
      toolSurfaceCount: 18,
      toolDefinitionTokens: 9500,
      toolSurfaceExceedsLocalCliff: true,
      toolSurfaceWindowShare: 0.074,
      toolSelectionAccuracy: 0.5,
    },
    { getDelegate },
  );

  expect(upsert.mock.calls[0][0].create).toMatchObject({
    ctxPeakTokens: 82000,
    ctxWindowTokens: 128000,
    toolSurfaceCount: 18,
    toolDefinitionTokens: 9500,
    toolSurfaceExceedsLocalCliff: true,
    toolSurfaceWindowShare: 0.074,
    toolSelectionAccuracy: 0.5,
  });
});
```

- [ ] **Step 2: Run the failing writer test**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/operate/coworker-turn-metrics.test.ts
```

Expected: fails because the input type and writer do not include these fields.

- [ ] **Step 3: Add Prisma fields**

Add only numeric/boolean fields to avoid a new DB string enum surface:

```prisma
model CoworkerTurnMetric {
  // existing fields...
  ctxPeakTokens                Int?
  ctxWindowTokens              Int?
  toolSurfaceCount             Int?
  toolDefinitionTokens         Int?
  toolSurfaceExceedsLocalCliff Boolean @default(false)
  toolSurfaceWindowShare       Float?
  toolSelectionAccuracy        Float?
  createdAt                    DateTime @default(now())

  @@unique([threadId, agentMessageId])
  @@index([createdAt])
  @@index([agentId, routeContext, createdAt])
  @@index([threadId, createdAt])
}
```

- [ ] **Step 4: Generate the migration**

Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name add_coworker_turn_context_economy
```

Expected: a migration directory is created under `packages/db/prisma/migrations/` and Prisma completes without drift errors.

- [ ] **Step 5: Update the turn-metric writer**

Add optional fields to `RecordCoworkerTurnMetricInput`, normalize numbers with `intOrNull` or a new `floatOrNull`, and include the fields in the `data` object. Keep the writer fail-open.

- [ ] **Step 6: Pass context-economy metrics from `agentic-loop.ts`**

At the existing `logTurnSummary()` point, compute once and pass to the writer:

```ts
const ctxPressure = classifyContextPressure(ctxPeakTokens, resolvedMaxContextTokens);
const surface = assessToolSurface({ tools: toolsForProvider, windowTokens: resolvedMaxContextTokens });
const turnToolAccuracy = computeToolSelectionAccuracy(
  executedTools.map((t) => ({ toolName: t.name, success: t.result.success })),
);

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
  ctxPeakTokens: ctxPressure.estimatedTokens,
  ctxWindowTokens: resolvedMaxContextTokens,
  toolSurfaceCount: surface.toolCount,
  toolDefinitionTokens: surface.estDefinitionTokens,
  toolSurfaceExceedsLocalCliff: surface.exceedsLocalCliff,
  toolSurfaceWindowShare: surface.windowShare,
  toolSelectionAccuracy: turnToolAccuracy.total === 0 ? null : turnToolAccuracy.accuracy,
});
```

Keep the existing console line, but do not make the observer parse it.

- [ ] **Step 7: Re-run telemetry tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/operate/coworker-turn-metrics.test.ts apps/web/lib/tak/context-economy-metrics.test.ts apps/web/lib/tak/context-pressure.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit telemetry foundation**

Run:

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/web/lib/operate/coworker-turn-metrics.ts apps/web/lib/operate/coworker-turn-metrics.test.ts apps/web/lib/tak/agentic-loop.ts
git commit -s -m "feat: persist coworker context economy telemetry"
```

## Chunk 3: Pattern Observer

### Task 3: Add pure pattern classification

**Files:**

- Create: `apps/web/lib/tak/pattern-observer.ts`
- Create: `apps/web/lib/tak/pattern-observer.test.ts`

- [ ] **Step 1: Write classifier tests**

Cover at least these cases:

```ts
describe("classifyPatternSignals", () => {
  it("classifies repeated grant denial as a grant need", () => {
    const out = classifyPatternSignals({
      agentId: "AGT-OPS",
      routeContext: "/ops",
      since: new Date("2026-06-27T00:00:00Z"),
      toolExecutions: [
        failedTool({ toolName: "export_archimate", summary: "forbidden_grant: ea_graph_read required" }),
        failedTool({ toolName: "export_archimate", summary: "forbidden_grant: ea_graph_read required" }),
      ],
      turnMetrics: [],
      taskRuns: [],
      envelopes: [],
      priorNeedFingerprints: new Set(),
    });

    expect(out.needs[0]).toMatchObject({ kind: "grant", severity: "important" });
    expect(out.needs[0].evidenceJson.toolName).toBe("export_archimate");
  });

  it("classifies tool-surface overload as a tool or prompt need", () => {
    const out = classifyPatternSignals({
      agentId: "AGT-BUILD",
      routeContext: "/build",
      since: new Date("2026-06-27T00:00:00Z"),
      toolExecutions: [],
      taskRuns: [],
      envelopes: [],
      turnMetrics: [
        metric({ toolSurfaceCount: 18, toolSurfaceExceedsLocalCliff: true, toolDefinitionTokens: 12000 }),
        metric({ toolSurfaceCount: 17, toolSurfaceExceedsLocalCliff: true, toolDefinitionTokens: 11800 }),
      ],
      priorNeedFingerprints: new Set(),
    });

    expect(out.needs[0]?.kind).toBe("tool");
    expect(out.patterns[0]?.metadata.patternKey).toContain("tool-surface");
  });

  it("does not emit duplicate needs already seen in the window", () => {
    const prior = new Set(["AGT-OPS|/ops|grant|missing export_archimate authority"]);
    const out = classifyPatternSignals({ ...grantDeniedFixture(), priorNeedFingerprints: prior });
    expect(out.needs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the failing classifier tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/pattern-observer.test.ts
```

Expected: fails because the module does not exist.

- [ ] **Step 3: Implement classifier input/output types**

Use narrow row types so tests do not need Prisma:

```ts
export type PatternObserverToolExecution = {
  id?: string;
  toolName: string;
  success: boolean;
  summary?: string | null;
  result?: unknown;
  taskRunId?: string | null;
  createdAt?: Date;
};

export type PatternObserverTurnMetric = {
  threadId?: string | null;
  agentMessageId?: string | null;
  ctxPeakTokens?: number | null;
  ctxWindowTokens?: number | null;
  toolSurfaceCount?: number | null;
  toolDefinitionTokens?: number | null;
  toolSurfaceExceedsLocalCliff?: boolean | null;
  toolSurfaceWindowShare?: number | null;
  toolSelectionAccuracy?: number | null;
  createdAt?: Date;
};

export type ClassifiedPatternNeed = {
  kind: CoworkerCapabilityNeedKind;
  severity: "blocker" | "important" | "minor";
  need: string;
  blocks: string;
  evidenceJson: Record<string, unknown>;
  readinessJson: Record<string, unknown>;
  fingerprint: string;
};
```

- [ ] **Step 4: Implement initial trigger rules**

Implement deterministic rules only:

- Two or more failed executions of the same tool with `forbidden_grant`, `forbidden grant`, or `insufficient_token_scope` produce a `grant` need.
- Two or more failed executions of the same tool with the same normalized summary/result error produce a `tool` need.
- Two or more turn metrics exceeding `LOCAL_TOOL_SELECTION_CLIFF` produce a `tool` need with `toolSurfaceCount` evidence.
- Two or more turn metrics with low `toolSelectionAccuracy` below `0.7` and at least one attempted tool produce a `tool` need.
- Two or more approved envelopes with the same proposed action key produce a `code` or `convention` need for proceduralization, but only as evidence; do not change envelope behavior.

Each output pattern should include `WorkPatternMetadata` with:

- `status: "observed"`.
- `source: "observer"`.
- `decisionScope` from `patternDecisionScope`.
- evidence refs where known.
- optional `workCaseBinding` only when input supplies case references.

- [ ] **Step 5: Re-run classifier tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/pattern-observer.test.ts
```

Expected: pass.

### Task 4: Add DB-backed observer service and post-run hook

**Files:**

- Create: `apps/web/lib/tak/pattern-observer-service.ts`
- Create: `apps/web/lib/tak/pattern-observer-service.test.ts`
- Modify: `apps/web/lib/tak/autonomous-work-run.ts`
- Modify: `apps/web/lib/tak/autonomous-work-run.test.ts`

- [ ] **Step 1: Write service tests with injected dependencies**

Tests must prove:

- The service loads evidence for the just-finished TaskRun plus a bounded recent window.
- It updates the parent `TaskRun` with `repeatedPatternKey` and merged `a2aMetadata.workPattern`.
- It calls `submitCoworkerSelfAssessment` with `trigger: "work-pattern-observer"`.
- It calls `createOrTouchImprovementSignal` with a stable `sourceType/sourceId`.
- It skips parent runs that are reflection runs or have `reflectionDepth >= 1`.
- All failures are logged and do not throw to the caller.

- [ ] **Step 2: Run the failing service tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/pattern-observer-service.test.ts
```

Expected: fails because the service does not exist.

- [ ] **Step 3: Implement `observeWorkPatternsAfterRun`**

Shape:

```ts
export async function observeWorkPatternsAfterRun(input: {
  taskRunId: string | null;
  userId: string;
  agentId: string;
  threadId: string | null;
  routeContext: string;
  since: Date;
}, deps?: PatternObserverServiceDeps): Promise<{
  processed: number;
  skippedReason?: "missing-task-run" | "reflection-loop-guard" | "no-signals";
}> {
  // load parent TaskRun, guard reflection loops, load evidence, classify,
  // stamp TaskRun, submit self-assessment, touch improvement signal
}
```

Important constraints:

- Reuse `getReflectionDepth` and `isReflectionRun` from `apps/web/lib/tak/reflection-triggers.ts`.
- Reuse `submitCoworkerSelfAssessment` instead of writing `CoworkerCapabilityNeed` directly.
- Reuse `createOrTouchImprovementSignal` instead of inserting signal rows directly.
- Query recent `CoworkerTurnMetric` by `threadId` or `(agentId, routeContext, createdAt >= since - window)`.
- Query recent `ToolExecution` by `taskRunId` first, then by `(agentId, routeContext, createdAt >= since)`.
- Query prior needs for the same agent/route from `CoworkerCapabilityNeed.evidenceJson.fingerprint` where present; if JSON querying is awkward, load a bounded recent set and filter in TypeScript.
- Update `TaskRun.a2aMetadata` with `mergeWorkPatternMetadata`; do not overwrite `reflectionDepth`, `sourceRef`, or other metadata.

- [ ] **Step 4: Wire the post-run hook**

In `executeAutonomousAgenticLoop`, after the existing runtime-issue reflection hook, add a second fire-and-forget hook:

```ts
void (async () => {
  try {
    const { observeWorkPatternsAfterRun } = await import("@/lib/tak/pattern-observer-service");
    await observeWorkPatternsAfterRun({
      taskRunId: input.taskRunId ?? null,
      userId: input.userId,
      agentId: input.agentId,
      threadId: input.threadId,
      routeContext: input.routeContext,
      since: startedAt,
    });
  } catch (err) {
    console.warn(
      "[pattern-observer] post-run hook failed:",
      err instanceof Error ? err.message : err,
    );
  }
})();
```

- [ ] **Step 5: Re-run observer tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/pattern-observer.test.ts apps/web/lib/tak/pattern-observer-service.test.ts apps/web/lib/tak/autonomous-work-run.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit observer foundation**

Run:

```powershell
git add apps/web/lib/tak/pattern-observer.ts apps/web/lib/tak/pattern-observer.test.ts apps/web/lib/tak/pattern-observer-service.ts apps/web/lib/tak/pattern-observer-service.test.ts apps/web/lib/tak/autonomous-work-run.ts apps/web/lib/tak/autonomous-work-run.test.ts
git commit -s -m "feat: observe systemic coworker work patterns"
```

## Chunk 4: Periodic Agent Reviews

### Task 5: Add attributable profile-review runner and cron

**Files:**

- Create: `apps/web/lib/tak/work-pattern-profile-review.ts`
- Create: `apps/web/lib/tak/work-pattern-profile-review.test.ts`
- Create: `apps/web/lib/queue/functions/work-pattern-profile-review.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`

- [ ] **Step 1: Write periodic review tests**

Tests must prove:

- Owner is resolved through `resolveScheduledOwnerUserId`.
- The created `TaskRun.userId` is the superuser owner.
- `initiatingAgentId` and `currentAgentId` are the reviewed agent.
- The review emits needs through the same self-assessment path.
- The review marks the TaskRun completed even when it finds no needs.

- [ ] **Step 2: Run failing review tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/work-pattern-profile-review.test.ts
```

Expected: fails because the module does not exist.

- [ ] **Step 3: Implement deterministic review runner**

Add:

```ts
export async function runWorkPatternProfileReview(input: {
  agentId: string;
  routeContext?: string | null;
  now?: Date;
}, deps?: WorkPatternProfileReviewDeps): Promise<{
  taskRunId: string;
  observedPatterns: number;
  needsFiled: number;
}> {
  // resolve owner via resolveScheduledOwnerUserId
  // create proactive/scheduled TaskRun with reviewed agent as executor
  // inspect last 7 days or last N completed TaskRuns
  // classify with classifyPatternSignals
  // submit self-assessment if needs exist
  // update TaskRun completed with progressPayload summary
}
```

Use existing `createAutonomousWorkRun` if it can express `trigger: "scheduled"`, `userId`, `agentId`, `routeContext`, title, objective, and metadata cleanly. If direct Prisma create is simpler for tests, keep the row shape identical to `createAutonomousWorkRun`.

The review `progressPayload` should contain a compact summary:

```ts
{
  type: "work-pattern-profile-review",
  agentId,
  routeContext,
  windowDays: 7,
  observedPatterns,
  needsFiled,
}
```

- [ ] **Step 4: Add Inngest cron**

Create `apps/web/lib/queue/functions/work-pattern-profile-review.ts` in the same style as `skill-curator.ts`:

```ts
import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const workPatternProfileReview = inngest.createFunction(
  {
    id: "quality/work-pattern-profile-review",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("17 7 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("review-agent-work-patterns", async () => {
      const { runDueWorkPatternProfileReviews } = await import("@/lib/tak/work-pattern-profile-review");
      return runDueWorkPatternProfileReviews();
    });
  },
);
```

`runDueWorkPatternProfileReviews()` should select agents due by either N completed TaskRuns or seven days since the last `work-pattern-profile-review` TaskRun. Keep N as a local constant in the runner for this slice.

- [ ] **Step 5: Register the cron**

Add the import and array entry in `apps/web/lib/queue/functions/index.ts`.

- [ ] **Step 6: Re-run periodic review tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/work-pattern-profile-review.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit periodic review**

Run:

```powershell
git add apps/web/lib/tak/work-pattern-profile-review.ts apps/web/lib/tak/work-pattern-profile-review.test.ts apps/web/lib/queue/functions/work-pattern-profile-review.ts apps/web/lib/queue/functions/index.ts
git commit -s -m "feat: add periodic work pattern profile reviews"
```

## Chunk 5: EA/SysML Grounding

### Task 6: Add Work Pattern architecture extractor and reconciler

**Files:**

- Create: `apps/web/lib/ea/work-pattern-architecture-extract.ts`
- Create: `apps/web/lib/ea/work-pattern-architecture-extract.test.ts`
- Create: `apps/web/lib/ea/reconcile-work-pattern-architecture.ts`
- Create: `apps/web/lib/ea/reconcile-work-pattern-architecture.test.ts`
- Modify: `apps/web/lib/ea/reconcile-sysml-projections.ts`
- Modify: `apps/web/lib/ea/architecture-parity-steward.ts`
- Modify: `apps/web/lib/ea/reconcile-sysml-projections.test.ts`

- [ ] **Step 1: Write pure extractor tests**

Tests must prove:

- The model emits a package for Governed Adaptive Playbooks.
- `ACT-GAP-*` pattern elements are SysML `action` elements.
- `SM-GAP-PROMOTION` is represented as a `part_definition` containing `state` elements because the seeded SysML2 notation supports `part_definition -> state`.
- `VC-GAP-*` elements are `verification_case` elements and verify requirements.
- Relationships use existing SysML2 slugs: `contains`, `satisfies`, `verifies`, `allocates`, and `traces`.
- No new EA notation, relationship type, or table is required.

- [ ] **Step 2: Run failing extractor tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/ea/work-pattern-architecture-extract.test.ts
```

Expected: fails because the extractor does not exist.

- [ ] **Step 3: Implement `buildWorkPatternArchitectureModel`**

Build a `SysmlDesiredModel` in the same style as `process-extract.ts` and `mcp-authority-extract.ts`.

Required stable keys:

- `gap:pkg`
- `gap:req:no-self-activation`
- `gap:req:evidence-backed-proposal`
- `gap:req:case-bound-governed-action`
- `gap:part:metadata`
- `gap:part:observer`
- `gap:part:profile-review`
- `gap:part:promotion-ladder`
- `gap:state:observed`
- `gap:state:candidate`
- `gap:state:approved`
- `gap:state:active`
- `gap:state:retired`
- `gap:vc:metadata`
- `gap:vc:observer`
- `gap:vc:profile-review`

For each observed pattern passed to the extractor, emit:

- `gap:act:<safePatternKey>` as an `action`.
- `gap:vc:<safePatternKey>` as a `verification_case`.
- `traces` relationships to source evidence where represented as properties.
- `allocates` relationships from the action to realizing `part_definition` elements when a code allocation is known.

Use properties for code/source references:

```ts
properties: {
  sourceKey: "apps/web/lib/tak/pattern-observer.ts",
  stableId: "ACT-GAP-tool-surface-overload",
  semantic: "sysml_allocates",
}
```

Do not invent a relationship slug named `sysml_allocates`; DPF's seeded SysML2 relationship slug is `allocates`.

- [ ] **Step 4: Implement reconcile shell**

`reconcileWorkPatternArchitecture({ db })` should call `applySysmlModel(buildWorkPatternArchitectureModel(...), { db, notationSlug: "sysml2" })`, log a compact result, and return `SysmlSeedResult`.

- [ ] **Step 5: Register the projection domain**

Add `workPatternArchitecture` to:

- `SysmlProjectionsResult` in `apps/web/lib/ea/reconcile-sysml-projections.ts`.
- The isolated domain run list in `reconcileSysmlProjections`.
- `DOMAIN_LABELS` in `apps/web/lib/ea/architecture-parity-steward.ts`.

- [ ] **Step 6: Re-run EA tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/ea/work-pattern-architecture-extract.test.ts apps/web/lib/ea/reconcile-work-pattern-architecture.test.ts apps/web/lib/ea/reconcile-sysml-projections.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit EA grounding**

Run:

```powershell
git add apps/web/lib/ea/work-pattern-architecture-extract.ts apps/web/lib/ea/work-pattern-architecture-extract.test.ts apps/web/lib/ea/reconcile-work-pattern-architecture.ts apps/web/lib/ea/reconcile-work-pattern-architecture.test.ts apps/web/lib/ea/reconcile-sysml-projections.ts apps/web/lib/ea/architecture-parity-steward.ts apps/web/lib/ea/reconcile-sysml-projections.test.ts
git commit -s -m "feat: ground adaptive playbooks in sysml projection"
```

## Chunk 6: Governance Guardrails And Documentation

### Task 7: Encode no-activation and Work Case dependency guardrails

**Files:**

- Modify: `apps/web/lib/tak/work-pattern-types.ts`
- Modify: `apps/web/lib/tak/pattern-observer.ts`
- Modify: `apps/web/lib/tak/pattern-observer.test.ts`
- Modify: `docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md`

- [ ] **Step 1: Add tests for candidate guardrails**

Tests must prove:

- A classified candidate includes `decisionScope`.
- A `case-type` or `case-transition` candidate includes `workCaseBinding` when available.
- A case-bound candidate without `receiptPolicy`, `governedActionKey`, or source reference is marked `readinessJson.readyForCaseActivation = false`.
- No classifier output contains an activation command, prompt mutation, skill mutation, grant mutation, model-route mutation, or Work Case state mutation.

- [ ] **Step 2: Implement readiness metadata**

Add a helper:

```ts
export function evaluatePatternReadiness(metadata: WorkPatternMetadata): {
  readyForReview: boolean;
  readyForCaseActivation: boolean;
  blockers: string[];
} {
  // review requires evidence and decisionScope
  // case activation requires workCaseBinding.governedActionKey plus receiptPolicy
  // activation is always false unless status is approved/active; this slice never sets those statuses
}
```

The observer should include readiness in `readinessJson`, not as a new table.

- [ ] **Step 3: Update the spec with the plan pointer**

In the spec implementation summary, add a link to this plan as the foundation plan. If implementation revealed any discrepancy, update the spec in the same commit.

- [ ] **Step 4: Re-run guardrail tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/work-pattern-types.test.ts apps/web/lib/tak/pattern-observer.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit guardrails and docs**

Run:

```powershell
git add apps/web/lib/tak/work-pattern-types.ts apps/web/lib/tak/work-pattern-types.test.ts apps/web/lib/tak/pattern-observer.ts apps/web/lib/tak/pattern-observer.test.ts docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md
git commit -s -m "docs: link adaptive playbooks foundation plan"
```

## Chunk 7: Verification And Evidence

### Task 8: Run source-local gates

**Files:** all touched files.

- [ ] **Step 1: Run targeted unit tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/work-pattern-types.test.ts apps/web/lib/operate/coworker-turn-metrics.test.ts apps/web/lib/tak/context-economy-metrics.test.ts apps/web/lib/tak/context-pressure.test.ts apps/web/lib/tak/pattern-observer.test.ts apps/web/lib/tak/pattern-observer-service.test.ts apps/web/lib/tak/autonomous-work-run.test.ts apps/web/lib/tak/work-pattern-profile-review.test.ts apps/web/lib/ea/work-pattern-architecture-extract.test.ts apps/web/lib/ea/reconcile-work-pattern-architecture.test.ts apps/web/lib/ea/reconcile-sysml-projections.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: zero TypeScript errors.

- [ ] **Step 3: Run migration apply verification**

If the migration was added, verify it applies through the appropriate canonical runtime or shared local-CI convergence sandbox. Do not claim migration evidence from an unproven worktree-only database.

Expected: migration applies cleanly.

- [ ] **Step 4: Run production build through the governed gate**

Run the production build where AGENTS.md allows runtime-bound gates: canonical local install after governed self-upgrade or the shared local-CI convergence sandbox.

Command:

```powershell
pnpm --filter web build
```

Expected: zero build errors.

- [ ] **Step 5: Record evidence**

Record the command outputs against the implementation BI through MCP evidence tooling if available. If MCP evidence tooling is unavailable, include exact command/result evidence in the PR body and reconcile MCP evidence later.

- [ ] **Step 6: Final commit and push**

Run:

```powershell
git status --short
git push origin HEAD
```

Expected: branch is pushed. Do not open a PR until the relevant gates are green and the branch is believed ready for review.

## Rollback

Rollback is straightforward:

- Revert the migration and telemetry writer changes if the schema extension causes issues.
- Remove the observer post-run hook from `autonomous-work-run.ts`; the existing runtime-issue reflection path remains intact.
- Remove the periodic cron registration from `apps/web/lib/queue/functions/index.ts`.
- Remove the Work Pattern EA projection domain from `reconcile-sysml-projections.ts` and `architecture-parity-steward.ts`.
- Keep pure tests that characterize existing behavior if they still pass and document useful invariants.

No rollback should touch Work Case source/status projection, trust-state rows, skills, prompts, grants, model routing, or Work Case state because this foundation must not mutate those surfaces.

## Definition Of Done

- Work Pattern metadata is typed and stamped into `TaskRun.a2aMetadata.workPattern`.
- `TaskRun.repeatedPatternKey` is used for observed pattern queryability.
- Context/tool-surface telemetry is durably persisted without string enum columns.
- The observer emits evidence-backed capability needs through existing self-assessment and improvement-signal paths.
- Periodic reviews create attributable TaskRuns owned by the install superuser and executed by the reviewed agent.
- EA/SysML projection includes Work Pattern, promotion ladder, and verification-case elements in the existing parity engine.
- Case-bound candidates remain proposals only and cannot mutate Work Case state.
- All source-local tests, typecheck, production build, and migration apply evidence are green or explicitly documented if blocked by a pre-existing issue.
