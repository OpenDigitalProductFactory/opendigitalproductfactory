# Governed Adaptive Playbooks — Slice 1: Systemic Capability-Needs Observer

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broaden DPF's narrow reactive reflection path into a reusable, evidence-driven **pattern observer** that emits richer capability needs from more than one failure shape — using existing models, kinds, and the existing backlog intake. No new tables. No model self-modification.

**Architecture:** Extract a reusable observer core from the current `agent_stuck`-only reflection, add pure signal classifiers and a centralized fingerprint/dedupe helper, then wire the observer into both the existing per-turn post-run hook (event-triggered) and a new periodic sweep. Everything routes through the existing `submitCoworkerSelfAssessment` → backlog intake. Pure domain logic first; trigger wiring last.

**Tech Stack:** Next.js 16 monorepo, TypeScript, Vitest, Prisma models, existing TAK reflection + coworker-self-assessment + improvement-flywheel libraries.

---

## Context And Constraints

- Epic: `EP-8AF1C996` — Progressive Autonomy & Trust Graduation (the spec composes directly with it). Focused BI: `BI-fb968f39-1851-49c8-914b-5c525322bf73`.
- Spec: `docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md` (§7 Slice 1, §6.1/§6.2 triggers, §8 refactoring budget, §9 governance).
- Models may **propose** improvements; they may not activate them. Slice 1 only observes and files reviewable needs — it changes no skills, prompts, grants, policies, routes, or code.
- Use the existing capability-need kinds (`tool`, `skill`, `grant`, `model`, `memory`, `data`, `ui_surface`, `boundary`, `prompt`, `convention`, `code`, `other`) — a closed string set in `apps/web/lib/coworker-self-assessment/types.ts`, not a Prisma enum. Do not widen it in this slice.
- No new tables. Reuse `CoworkerSelfAssessment`, `CoworkerCapabilityNeed`, `ImprovementSignal`, `TaskRun`, `ToolExecution`, `PlatformIssueReport`.
- Preserve the existing reflection loop guards (depth guard + dedupe). A broadened observer must not create self-trigger cascades.
- Reserve ~20% of effort for the structural refactor named in spec §8 (extract shared observer primitives; centralize fingerprinting) — not unrelated cleanup.
- Defer the phase-review-failure classifier: build/phase review outcomes do not live in a runtime store (`ReviewInstance` is the HR review cycle), so that signal source needs confirmation in a later slice. Slice 1 classifiers are grant-denial, tool-surface/context overload, and repeated-success.

## Parallel Effort Coordination

The Work Case program (`EP-2984B02B`, Wave 1 seam owner `BI-D633F7AF`) runs in parallel. This slice is on the parallel-safe side of that contract.

- **No dependency:** Slice 1 only reads runtime evidence and emits needs/assessments. It changes no Work Case state and does not require Work Case Wave 0 or Wave 1.
- **Later slices depend on Work Case (state, do not weaken):** Case-bound Pattern Candidates (this effort's Slice 4 and promotion-ladder step "Case-staged") consume Work Case Wave 1's governed Actions, policy envelope, and `ReceiptEnvelope`, and Wave 2's sponsor/authority-mode. Slice 1 builds none of that.
- **Collision ownership:** Do not edit `apps/web/lib/mcp-governed-execute.ts` — the `context.workCase` / `work-case-governed-action` receipt seam is owned by Work Case Wave 1 (`BI-D633F7AF`). Slice 1 does not touch it.
- **AI Readiness Console (parallel):** The [AI Readiness Console](../specs/2026-06-28-ai-readiness-console-design.md) owns provider/model/routing calibration queueing (discovery, profiling, eval, probe, stale-calibration jobs). The observer must not run a second provider-calibration sweep — for a future model-tier-mismatch / stale-routing signal it composes the readiness summary + `provider-routing-eligibility` and emits a capability need, sharing one background-job mechanism. Slice 1's three classifiers (grant-denial, tool-surface overload, repeated-success) do not overlap; this guard is for the later model-tier-mismatch classifier.

## File Structure

- Create `apps/web/lib/tak/pattern-observer/core.ts`
  - Reusable reflection envelope extracted from `reflection-triggers.ts`: depth-guarded proactive `TaskRun` creation, assessment+need emission, and `ImprovementSignal` touch — parameterized by reflection `title`, need `kind`, `severity`, and `suspectedRootCause` instead of hard-coding "Skill reflection"/"skill"/"repeated-tool-call".
- Create `apps/web/lib/tak/pattern-observer/core.test.ts`
- Create `apps/web/lib/tak/pattern-observer/fingerprint.ts`
  - One place that builds the dedupe keys: capability-need origin key (wrapping the existing `capabilityNeedOriginId`) and the `ImprovementSignal (sourceType, sourceId)` key, plus an evidence fingerprint (agent + route + kind + normalized-need + evidence digest) so runtime reflection, periodic review, and manual assessment converge on one dedupe contract.
- Create `apps/web/lib/tak/pattern-observer/fingerprint.test.ts`
- Create `apps/web/lib/tak/pattern-observer/classifiers.ts`
  - Pure functions that turn observed evidence into a `CoworkerCapabilityNeedInput` (kind + severity + need + blocks + evidenceJson), or null when below threshold:
    - `classifyGrantDenial` → `grant`
    - `classifyToolSurfaceOverload` → `tool` or `prompt` or `data` with token/zone evidence
    - `classifyRepeatedSuccess` → `code` or `convention` (proceduralization candidate)
- Create `apps/web/lib/tak/pattern-observer/classifiers.test.ts`
- Create `apps/web/lib/tak/pattern-observer/observer.ts`
  - `observeCoworkerPatterns(input, deps?)`: loads recent `TaskRun`/`ToolExecution` for an agent (+ optional route/time window), computes context-economy evidence, runs the classifiers, dedupes via the fingerprint helper, and emits one `CoworkerSelfAssessment` (rich `rawPayload`) with the surviving needs through `submitCoworkerSelfAssessment`.
- Create `apps/web/lib/tak/pattern-observer/observer.test.ts`
- Create `apps/web/lib/tak/pattern-observer/periodic-review.ts`
  - `runPeriodicPatternReview(input, deps?)`: the genuinely-periodic sweep (every N completed runs or 7 days, whichever first). Resolves the spawned `TaskRun` to `userId = superuser` and `executor = Agent` (proactive-job owner resolution), then calls `observeCoworkerPatterns`.
- Create `apps/web/lib/tak/pattern-observer/periodic-review.test.ts`
- Create `apps/web/lib/tak/pattern-observer/index.ts`
- Modify `apps/web/lib/tak/reflection-triggers.ts`
  - Re-implement `processRuntimeIssueReflection` on top of `pattern-observer/core.ts` so the `agent_stuck` path keeps identical behavior (same title, `skill` need, root cause) while the envelope is shared. Preserve `getReflectionDepth`/`isReflectionRun` and the depth/dedup guards.
- Modify `apps/web/lib/tak/reflection-triggers.test.ts`
  - Keep the existing assertions green against the refactored implementation.
- Modify `apps/web/lib/tak/autonomous-work-run.ts`
  - In the existing fire-and-forget post-run hook, after the current runtime-issue reflection, also invoke `observeCoworkerPatterns` for the just-finished agent/route, guarded by the same loop guards (do not observe a reflection run; respect depth). Event-triggered observation inherits the existing per-turn user context.
- Create `apps/web/lib/playbooks/architecture-grounding.ts` and `.test.ts`
  - A small EA/SysML grounding manifest mirroring the Work Case pattern: register `ACT-GAP-observe`, `VC-GAP-observer`, and the Slice 1 requirement(s) with `sysml_allocates` edges to the new files. `SM-GAP-PROMOTION` and the full promotion-ladder elements land in later slices.

---

## Task 1: Extract The Reusable Observer Core

**Files:**
- Create: `apps/web/lib/tak/pattern-observer/core.test.ts`
- Create: `apps/web/lib/tak/pattern-observer/core.ts`
- Modify: `apps/web/lib/tak/reflection-triggers.ts`
- Modify: `apps/web/lib/tak/reflection-triggers.test.ts`
- Create: `apps/web/lib/tak/pattern-observer/index.ts`

This is the spec §8 refactor: share one envelope instead of growing a second reflection subsystem.

- [ ] **Step 1: Write failing core tests**

Assert the parameterized envelope:

- `runObservation` creates a proactive `TaskRun` with the supplied `title`, `a2aMetadata.reflectionDepth = parentDepth + 1`, and `a2aMetadata.trigger`.
- It returns `{ processed: 0, skippedReason: "reflection-loop-guard" }` when the parent is a reflection run or has `reflectionDepth >= 1` (depth guard preserved).
- It emits a `CoworkerSelfAssessment` with the supplied verdict/confidence and the supplied needs (kind/severity passed through, not hard-coded).
- It touches an `ImprovementSignal` with the supplied `sourceType`/`sourceId`/`suspectedRootCause`.

Use the deps-injection + mocked-Prisma style from `reflection-triggers.test.ts`.

- [ ] **Step 2: Run and verify failure**

```powershell
pnpm --filter web exec vitest run lib/tak/pattern-observer/core.test.ts
```

Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the core**

Move the reusable parts of `reflection-triggers.ts` (`getReflectionDepth`, `isReflectionRun`, the depth-guard short-circuit, the proactive `TaskRun` envelope, the assessment/need emission, the `createOrTouchImprovementSignal` call) into `core.ts`, parameterized by an `ObservationSpec { title; trigger; verdict; confidence; needs; sourceType; sourceId; suspectedRootCause }`. Re-export `getReflectionDepth`/`isReflectionRun` from `reflection-triggers.ts` for backward compatibility.

- [ ] **Step 4: Re-implement `processRuntimeIssueReflection` on the core**

Rewrite the `agent_stuck` path to call the core with the existing constants (`title = "Skill reflection: repeated tool use"`, `kind = "skill"`, `suspectedRootCause = "repeated-tool-call"`). The existing `reflection-triggers.test.ts` must pass unchanged.

- [ ] **Step 5: Run both suites**

```powershell
pnpm --filter web exec vitest run lib/tak/pattern-observer/core.test.ts lib/tak/reflection-triggers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/tak/pattern-observer/core.ts apps/web/lib/tak/pattern-observer/core.test.ts apps/web/lib/tak/pattern-observer/index.ts apps/web/lib/tak/reflection-triggers.ts apps/web/lib/tak/reflection-triggers.test.ts
git commit -s -m "refactor: extract reusable pattern-observer core from reflection triggers"
```

---

## Task 2: Centralized Fingerprint And Dedupe

**Files:**
- Create: `apps/web/lib/tak/pattern-observer/fingerprint.test.ts`
- Create: `apps/web/lib/tak/pattern-observer/fingerprint.ts`
- Modify: `apps/web/lib/tak/pattern-observer/index.ts`

- [ ] **Step 1: Write failing fingerprint tests**

- `capabilityNeedKey(agentId, kind, need)` matches the existing `capabilityNeedOriginId` output (same normalization: trim, lowercase, collapse whitespace, 120-char slice) so the observer and the existing intake dedupe identically.
- `improvementSignalKey(sourceType, sourceId)` returns the `(sourceType, sourceId)` pair used by `createOrTouchImprovementSignal`.
- `evidenceFingerprint({ agentId, routeContext, kind, need, evidence })` is stable across reordered evidence keys and changes when the normalized need changes.

- [ ] **Step 2: Run and verify failure**

```powershell
pnpm --filter web exec vitest run lib/tak/pattern-observer/fingerprint.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Wrap `capabilityNeedOriginId` (do not duplicate its normalization) and add the signal key + a deterministic evidence digest (stable JSON stringify of sorted keys). Keep it pure.

- [ ] **Step 4: Run**

```powershell
pnpm --filter web exec vitest run lib/tak/pattern-observer/fingerprint.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/tak/pattern-observer/fingerprint.ts apps/web/lib/tak/pattern-observer/fingerprint.test.ts apps/web/lib/tak/pattern-observer/index.ts
git commit -s -m "feat: centralize pattern-observer fingerprint and dedupe keys"
```

---

## Task 3: Pure Signal Classifiers

**Files:**
- Create: `apps/web/lib/tak/pattern-observer/classifiers.test.ts`
- Create: `apps/web/lib/tak/pattern-observer/classifiers.ts`
- Modify: `apps/web/lib/tak/pattern-observer/index.ts`

- [ ] **Step 1: Write failing classifier tests**

Each classifier takes observed evidence and returns a `CoworkerCapabilityNeedInput | null`:

- `classifyGrantDenial`: repeated tool denials by grant/missing capability (over a threshold) → `{ kind: "grant", severity: "important", evidenceJson: { deniedTool, count } }`. Below threshold → null.
- `classifyToolSurfaceOverload`: an `assessToolSurface` result with `zone === "overload"` (or `exceedsLocalCliff`) → `{ kind: "tool" | "prompt" | "data", evidenceJson: { toolCount, estDefinitionTokens, windowShare, zone } }` with the token evidence required by spec acceptance. `zone === "caution"` → minor or null per threshold; `lean` → null.
- `classifyRepeatedSuccess`: a `computeToolSelectionAccuracy` + repetition signal showing a high-ceremony successful workflow repeated N times → `{ kind: "code" | "convention", severity: "minor", need: "proceduralize ..." }`.

- [ ] **Step 2: Run and verify failure**

```powershell
pnpm --filter web exec vitest run lib/tak/pattern-observer/classifiers.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Pure functions only — they consume already-computed `assessToolSurface` / `computeToolSelectionAccuracy` results and counts, and return need inputs. No DB, no I/O. Reuse `apps/web/lib/tak/context-economy-metrics.ts` types (`ToolSurfaceAssessment`, `ToolSelectionAccuracy`, `LOCAL_TOOL_SELECTION_CLIFF`).

- [ ] **Step 4: Run**

```powershell
pnpm --filter web exec vitest run lib/tak/pattern-observer/classifiers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/tak/pattern-observer/classifiers.ts apps/web/lib/tak/pattern-observer/classifiers.test.ts apps/web/lib/tak/pattern-observer/index.ts
git commit -s -m "feat: add pattern-observer signal classifiers"
```

---

## Task 4: The Systemic Observer

**Files:**
- Create: `apps/web/lib/tak/pattern-observer/observer.test.ts`
- Create: `apps/web/lib/tak/pattern-observer/observer.ts`
- Modify: `apps/web/lib/tak/pattern-observer/index.ts`

- [ ] **Step 1: Write failing observer tests** (deps-injection style)

- Loads recent `ToolExecution` for an agent (mock), computes surface/accuracy, runs classifiers, and calls `submitCoworkerSelfAssessment` once with all surviving needs and a rich `rawPayload` (evidence digests, window).
- A repeated grant denial produces a `grant` need (not a generic `skill` need).
- A repeated context-overload window produces a `prompt`/`tool`/`data` need with token evidence.
- A repeated successful manual workflow produces a `code`/`convention` need.
- Duplicate needs within one sweep collapse via the fingerprint helper (one need per key).
- When no classifier fires, no assessment is submitted.

- [ ] **Step 2: Run and verify failure**

```powershell
pnpm --filter web exec vitest run lib/tak/pattern-observer/observer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `observeCoworkerPatterns`**

Inject deps `{ db, assessToolSurface, computeToolSelectionAccuracy, submitCoworkerSelfAssessment, now }`. Query recent `ToolExecution` (use the `@@index([agentId, createdAt])`) and recent `TaskRun` outcomes, group by route, run classifiers, dedupe, and submit one assessment with `trigger: "pattern-observer"`. Keep the existing backlog projection by delegating filing to `submitCoworkerSelfAssessment` (do not file directly).

- [ ] **Step 4: Run**

```powershell
pnpm --filter web exec vitest run lib/tak/pattern-observer/observer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/tak/pattern-observer/observer.ts apps/web/lib/tak/pattern-observer/observer.test.ts apps/web/lib/tak/pattern-observer/index.ts
git commit -s -m "feat: add systemic coworker pattern observer"
```

---

## Task 5: Trigger Wiring (Event + Periodic)

**Files:**
- Create: `apps/web/lib/tak/pattern-observer/periodic-review.test.ts`
- Create: `apps/web/lib/tak/pattern-observer/periodic-review.ts`
- Modify: `apps/web/lib/tak/autonomous-work-run.ts`
- Modify: `apps/web/lib/tak/pattern-observer/index.ts`

- [ ] **Step 1: Write failing periodic-review tests**

- `runPeriodicPatternReview` resolves the spawned `TaskRun` owner to `userId = superuser` and `executor = Agent` (never a synthetic "system" actor), then calls `observeCoworkerPatterns`.
- It honors the cadence guard (skips an agent reviewed within the window / below the run count).
- It respects the reflection loop guards (does not run for reflection-spawned runs).

- [ ] **Step 2: Write failing post-run-hook test**

In `autonomous-work-run.ts` coverage: after a normal turn, the post-run hook also invokes `observeCoworkerPatterns` for the finished agent/route, and is skipped for reflection runs and at depth >= 1.

- [ ] **Step 3: Run and verify failure**

```powershell
pnpm --filter web exec vitest run lib/tak/pattern-observer/periodic-review.test.ts lib/tak/autonomous-work-run.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement**

- `periodic-review.ts`: resolve superuser via the existing proactive-job owner resolution; cadence from a small constant (N runs or 7 days). Keep scheduling registration out of scope if cron infra is not already present — note the registration site to confirm; the function must be invocable and tested regardless.
- `autonomous-work-run.ts`: add the observer call inside the existing fire-and-forget block next to `processRuntimeIssueReflection`, behind the same guard checks. Non-fatal try/catch like the existing reflection call.

- [ ] **Step 5: Run**

```powershell
pnpm --filter web exec vitest run lib/tak/pattern-observer/periodic-review.test.ts lib/tak/autonomous-work-run.test.ts lib/tak/reflection-triggers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/tak/pattern-observer/periodic-review.ts apps/web/lib/tak/pattern-observer/periodic-review.test.ts apps/web/lib/tak/autonomous-work-run.ts apps/web/lib/tak/pattern-observer/index.ts
git commit -s -m "feat: wire pattern observer into per-turn and periodic triggers"
```

---

## Task 6: EA/SysML Grounding And Plan Evidence

**Files:**
- Create: `apps/web/lib/playbooks/architecture-grounding.ts`
- Create: `apps/web/lib/playbooks/architecture-grounding.test.ts`

- [ ] **Step 1: Write failing grounding tests**

- The manifest registers `ACT-GAP-observe` (the observer action) and `VC-GAP-observer` (verification case) with `sysml_allocates` allocations to `observer.ts`, `classifiers.ts`, and `core.ts`.
- The Slice 1 requirement is marked `implemented` only for behavior covered by tests; promotion-ladder elements remain `planned`.

- [ ] **Step 2: Run and verify failure**

```powershell
pnpm --filter web exec vitest run lib/playbooks/architecture-grounding.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Mirror the Work Case `architecture-grounding.ts` shape (`elementId`, `elementType`, `name`, `description`, `implementationStatus`, `itValueStreams`, `verificationCaseId`, and `sysml_allocates` allocations). Do not invent a parallel manifest shape; reuse the same field names so both efforts ground in one substrate. Anchor to IT4IT `operate` value stream.

- [ ] **Step 4: Run**

```powershell
pnpm --filter web exec vitest run lib/playbooks/architecture-grounding.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/playbooks/architecture-grounding.ts apps/web/lib/playbooks/architecture-grounding.test.ts
git commit -s -m "doc: ground governed-playbooks observer in EA/SysML substrate"
```

---

## Task 7: Full Verification And Evidence

- [ ] **Step 1: Focused suite**

```powershell
pnpm --filter web exec vitest run lib/tak/pattern-observer/*.test.ts lib/tak/reflection-triggers.test.ts lib/tak/autonomous-work-run.test.ts lib/coworker-self-assessment/assessment-service.test.ts lib/improvement-flywheel/signals.test.ts lib/playbooks/architecture-grounding.test.ts
```

Expected: PASS.

- [ ] **Step 2: Typecheck**

```powershell
pnpm --filter web typecheck
```

- [ ] **Step 3: Whitespace check**

```powershell
git diff --check
```

- [ ] **Step 4: Production build**

```powershell
pnpm --filter web build
```

Expected: PASS (pre-existing Turbopack warnings acceptable if unchanged).

- [ ] **Step 5: Record MCP evidence on the BI** — focused suite, typecheck, build results, and notes on any deferred classifier (phase-review) or scheduling-registration follow-up.

- [ ] **Step 6: Mark BI status** only when gates are green and the branch is pushed / PR opened.

---

## Rollback

- Revert the new `apps/web/lib/tak/pattern-observer/*` and `apps/web/lib/playbooks/*` modules.
- Restore `reflection-triggers.ts` and `autonomous-work-run.ts` to pre-slice behavior (the `agent_stuck` path is unchanged in behavior, so reverting the refactor is safe).
- No migration rollback — this slice adds no schema.

## Definition Of Done

- The `agent_stuck` reflection path behaves identically, now built on the shared observer core (existing `reflection-triggers.test.ts` green).
- The observer emits correctly-kinded needs from grant-denial, tool-surface/context overload, and repeated-success evidence, with token/zone evidence where the spec requires it.
- Fingerprinting/dedupe is centralized; runtime reflection, periodic review, and manual assessment converge on one key contract; no duplicate needs within a sweep.
- Reflection loop guards (depth + dedupe) are preserved and tested.
- The periodic sweep resolves owner to superuser + executor Agent; the per-turn hook inherits user context.
- No skills, prompts, grants, policies, routes, or code are mutated by the observer.
- `mcp-governed-execute.ts` is untouched (owned by Work Case Wave 1).
- EA grounding is added by extending the shared manifest shape, no new modeling tables.
- Branch pushed and opened as a regular ready-for-review PR only after gates are green.
