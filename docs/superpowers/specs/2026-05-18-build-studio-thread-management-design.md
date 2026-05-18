---
title: Build Studio thread management & scoped task context — design validation
status: post-merge validation (rev 4 — chief-architect pass)
author: Claude (validation pass)
date: 2026-05-18
related:
  - BI-0789AF6B (in-progress)
  - FB-60DCE69A (active build, phase=ideate; advance pending per §12)
  - WC-039DAFE0 (work capsule)
  - PR https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/756 (MERGED as commit 538bc685)
  - 2026-05-17-wwmd-decision-perspective-kernel-design.md
references:
  - reference_cursor_architecture (auto-memory)
  - project_build_studio_token_optimization (auto-memory)
  - apps/web/lib/decision-perspective/build-studio-gate.ts (live WWMD gate)
---

> **Status banner (rev 4).** PR #756 landed as commit `538bc685`. This
> document is now the durable design record, not a pre-merge proposal.
> §6/§7 below are rewritten in **landed / fast-follow** tense rather than
> the original "amend before merge" framing. Rev 4 also incorporates
> chief-architect feedback (2026-05-18) on:
>
> - decisions-ledger persistence (single source of truth via `DecisionInteraction`;
>   regex extractor dropped — see §6 item 1)
> - decisions-slot eviction policy (recency / topic-overlap, not confidence
>   — see §10.3)
> - file-signature extraction (downgraded from "cheap `tsc` step" to its
>   own BI exploring AST vs. specialist-emitted signatures — see §6 item 2)
> - `PhaseHandoff` consumer audit prerequisite (§6 item 5)
> - evidence-not-provenance principle scoped to gate-evidence evaluation,
>   trust-boundary controls still apply (§12.2)
> - caching-friendly slot order promoted from C8 ⚠️ to a concrete §6 item
>   (new item 6)
> - §13 test-coverage audit of the landed commits added
>
> See §12 for the post-merge action plan and the evidence-not-provenance
> governance precedent.

# Build Studio thread management & scoped task context — design validation

## 1. Problem

`runBuildOrchestrator` dispatches every build-phase task into the same growing
context. The composition that lands in each specialist call is:

- system prompt + tool definitions
- all ideate / plan messages
- all prior task results, concatenated verbatim into `priorResultsSummary`
- `buildContext` (the raw lifecycle conversation)

After 14 build tasks the dispatch payload exceeds **125,000 characters** (~31K
tokens). Two failure modes follow:

1. **Codex CLI timeouts.** The 180s adapter ceiling is exceeded because the
   model receives — and must reason over — the full history on every dispatch.
2. **Rate-limit cascades.** Anthropic-sub burns its pool recovering from codex
   timeouts. Subsequent task dispatches inherit a degraded provider pool.

The UI already shows tasks as phase-separated nodes in a dependency graph.
The internal thread does not honour those boundaries — it grows linearly across
the entire lifecycle. The architectural mismatch is real.

External validation: Cursor names this exact failure mode "context rot" and
retired static context-stuffing for the same reasons
([cursor.com/blog/continually-improving-agent-harness](https://cursor.com/blog/continually-improving-agent-harness)).

## 2. State of the art

Three approaches are in use across comparable agentic tools:

| Approach | How | Tradeoff |
|---|---|---|
| **Single growing thread** | Concatenate every turn | Hits the wall (our current bug) |
| **Sliding window** | Keep last N turns verbatim | Loses early goal context |
| **Tail + summary compaction** | Keep last N turns, LLM-summarize older | Anthropic / Claude Code auto-compaction; depends on summarizer fidelity |
| **Per-task scoped threads** | Each task = fresh prompt; structured artefact ledger of prior tasks | Cursor's Composer + the approach PR #756 takes |
| **Hierarchical planner-worker** | Planner thread holds plan + decisions; workers spawn per task with scoped inputs and report structured results | Cursor's multi-agent kernels; future direction |

Per-task scoped threads are the right level for Build Studio because each task
**is** a goal boundary — there's no "earlier turn I might still need verbatim."
The decision is not whether to scope, but **what goes in the scope** so the
specialist can act without rediscovery.

## 3. Current implementation (PR #756)

### 3.1 Scoped context shape

[`buildScopedTaskContext`](apps/web/lib/integrate/build-orchestrator.ts) builds
the dispatch payload from these slots, total capped at
`MAX_SCOPED_TASK_CONTEXT_CHARS = 8000`:

| Slot | Per-slot budget | Source |
|---|---|---|
| Header + policy line | ~200 | Static |
| Current task — `testFirst` / `implement` / `verify` | 900 / 1200 / 900 | `task.task.*`, individually clipped |
| Relevant plan files | up to 12 entries × 240 chars purpose | `task.files`, else keyword-matched from `plan.fileStructure` |
| Dependency context | titles of last 6 prior planned tasks | titles only, no outcome |
| Artifact summary | 2800 | `buildTaskArtifactSummary` over completed entries |

`rawBuildContext` is **explicitly discarded** — the `void` statement at the top
of `buildScopedTaskContext` makes this policy enforceable by future readers.

### 3.2 Artifact summary shape

[`buildTaskArtifactEntry`](apps/web/lib/integrate/build-orchestrator.ts)
produces one entry per completed task with these fields:

- `taskIndex`, `title`, `specialist`, `outcome`
- `files[]` — paths touched
- `summary` — sanitized + whitespace-collapsed prose clipped to 320 chars
- `verification` — regex-extracted hint: "typecheck pass", "5 pass / 0 fail"
- `durationMs`

[`buildTaskArtifactSummary`](apps/web/lib/integrate/build-orchestrator.ts)
renders the entries newest-first into a single text block. Older entries are
dropped from the front when the 2800-char budget is exceeded. The block is
prefixed with `Completed task artifacts (N older omitted to preserve context
budget):` when truncation happened.

### 3.3 Persistence

Two persistence mechanisms are wired:

1. **`featureBuild.taskResults.tasks[]`** — canonical store. Each entry now
   carries `artifactSummary`, `files`, `verification`, `taskIndex` in addition
   to the prior `title`/`specialist`/`outcome`/`durationMs`. Optimistic locking
   on `taskResultsVersion` prevents concurrent overwrites.
2. **`PhaseHandoff` table via `save_phase_handoff`** — `saveTaskPhaseHandoff`
   calls the tool per-task with `agentId="AGT-ORCH-300"`, `routeContext="/build"`,
   `autoAdvance: false`, `toPhase: "build"`.

The second commit on the branch (`e5c9bea9` — *guard task handoff controls*)
added [`resolveSavePhaseHandoffTransition`](apps/web/lib/mcp-tools.ts) which
recognizes that exact `(agentId, routeContext, autoAdvance)` tuple as an
**internal task handoff** and skips the auto-advance gate. Without this guard,
each per-task call would attempt to advance `build → review` and pollute
unrelated downstream verification triggers.

### 3.4 Orchestrator wiring

[`runBuildOrchestrator`](apps/web/lib/integrate/build-orchestrator.ts) now:

1. Hydrates `taskArtifactEntries` from prior `taskResults` at resume time.
2. Builds `artifactSummaryForBatch` once per dispatch batch.
3. For each task in the batch: build scoped context, dispatch, build artifact
   entry, call `saveTaskPhaseHandoff`, push entry into the running list.
4. After all tasks, persists the full `newTaskResults` with carried-forward
   artifact fields via the existing optimistic-locking merge.

## 4. Goldilocks analysis

### 4.1 Where the design is right

- **Hard cap eliminates runaway.** 8K chars (~2K tokens) is well below any
  model window and forces deliberate budgeting.
- **Newest-first eviction.** Older artifacts drop first — correct for a
  workflow where recent decisions are most likely to constrain the next task.
- **Verification regex extraction.** Pulling `typecheck pass` / `N pass / M
  fail` from prose into a structured field is cheap and high-signal.
- **Test/implement/verify get the biggest slot.** 3000 chars combined is the
  largest carve-out. Correct — this is the task contract.
- **Files-touched list is structured.** The next specialist knows which paths
  to Read rather than re-discovering via grep.
- **Discard-by-default policy.** `rawBuildContext` is explicitly voided. The
  policy is visible in the code, not relying on convention.
- **Guard against semantic drift.** The `(AGT-ORCH-300, /build, autoAdvance=false)`
  tuple prevents `save_phase_handoff` from advancing the phase on every task.
  This was a real bug before the second commit and is properly handled now.

### 4.2 Where the design is probably too small

1. **No carry-forward of file shapes.** Task 7 sees `auth.ts` listed under
   task 3's `files=` field but not what's *in* `auth.ts`. The specialist must
   Read it from the sandbox to know the signatures/exports. Wastes
   specialist tool calls every dispatch. Cost: 1-2 extra Read calls × 12+
   tasks per build.
2. **No architectural-decisions ledger.** The 320-char `conciseArtifactText`
   may or may not capture *why* task 3 chose JWT over session cookies. If it
   doesn't, task 9 can drift architecturally without ever seeing the
   constraint. This is the highest-impact gap: "the build works but the design
   is incoherent" is exactly the failure mode this fix is supposed to prevent.
3. **Retry context is lost.** When a task is retried after `BLOCKED`, the
   retry receives the same 320-char summary as everyone else. The prior
   attempt's failure reasoning is dropped. Retries re-walk the same dead end.
4. **Dependency-context slot is title-only.** "Prior planned task: Add auth
   middleware" tells the next specialist nothing about whether it succeeded,
   was skipped, or what shape the middleware ended up as. With artifact
   summaries already covering completed tasks, this slot mostly duplicates
   weaker signal.
5. **Plan-files keyword matcher is fragile.** When `task.files` is empty, the
   matcher falls back to splitting the title on whitespace and keeping words
   `length > 3`. Easy false positives ("user" matches every file with "user"
   in the path). Easy false negatives (a task titled "Wire it up" yields no
   useful keywords).

### 4.3 Where the design is probably too large / wasted

1. **PhaseHandoff rows are duplicate persistence.** Every per-task call writes
   a `PhaseHandoff` record carrying the same summary already saved to
   `taskResults`. 15 tasks ⇒ 15 rows labelled `build → review` that never
   represent a real transition. They also trigger the fire-and-forget
   compression loop on every call — extra DB queries to check
   `compressedSummary IS NULL`, even when there's nothing to compress.
2. **Dependency-titles slot vs. artifact summary.** ~600 chars of titles for
   tasks whose outcome lines already appear under "Artifact Summary."
   Redundancy without new signal.
3. **Plan-files block can eat 36% of the budget** (2880 of 8000 chars). On
   tasks with many file targets, this crowds out the artifact summary
   that carries the actually-novel state.

### 4.4 Concrete numbers — does it hit the criterion?

The BI's acceptance criterion 1: *"After 15 build tasks, the prompt payload
for task 16 is ≤ 8K characters."*

Yes — the `clipText(lines.join("\n"), maxChars)` at the end of
`buildScopedTaskContext` enforces this unconditionally. The criterion is
mechanically met. The remaining question is whether 8K is the **right** size,
which §4.2 frames as "not too small."

## 5. Design criteria

For a Build Studio task dispatch to be right-sized, it should:

| # | Criterion | Status in PR #756 |
|---|---|---|
| C1 | Prompt size bounded (≤ ~2K tokens) regardless of task count | ✅ enforced by 8K char cap |
| C2 | The specialist can identify the task contract without reading external state | ✅ test/implement/verify carried |
| C3 | Decisions made in prior tasks survive across all subsequent tasks | ⚠️ only via 320-char prose; no ledger |
| C4 | The specialist knows file shapes prior tasks created without re-Read | ❌ paths only, no signatures |
| C5 | Retries see the prior failure context, not the post-hoc summary | ❌ retry dispatch identical to fresh dispatch |
| C6 | No semantic drift from repurposed tool calls (e.g., unintended phase advances) | ✅ guarded by `resolveSavePhaseHandoffTransition` |
| C7 | Persistence has a single source of truth | ⚠️ duplicated between `taskResults` and `PhaseHandoff` |
| C8 | Caching-friendly composition (stable prefix, variable suffix) | ⚠️ slot order today defeats cache; **addressed in §6.2 item 6** (FF-PR-1) |

## 6. Options considered and what landed

PR #756 landed as commit `538bc685`. Functionally that is **Option A** below
(ship the runaway fix, defer the gap-closers). The fast-follow plan in §7
executes a narrowed form of **Option B**, with the chief-architect feedback
from rev 4 already folded in. **Option C** (hierarchical planner-worker)
remains the recorded alternative; it was not taken and is not on the active
roadmap.

### 6.1 Option A (landed) — Scoped context as merged

The acceptance criteria of BI-0789AF6B are mechanically met by `538bc685`.
C1, C2, C6 are solid. C3 (decisions survival), C4 (file shapes), C5 (retry
context), C7 (single source of truth), C8 (cache-friendly composition) are
acknowledged gaps that fast-follows address.

**Why this was the right call.** The 125K runaway was actively breaking
builds. Shipping the cap unblocked operators. The gaps named in §4.2 / §4.3
do not cause the build to fail mechanically — they erode design coherence
over long builds. That is a real cost, but a survivable one for the days
between Option A and the fast-follow PRs.

**What it leaves on the table.** C3 in particular: "the build works but the
design is incoherent" is the failure mode this fix is *supposed* to prevent.
Until §7 lands, long builds remain exposed to architectural drift between
early and late tasks.

### 6.2 Option B (fast-follow execution) — Close the gaps

Items below are sized for individual follow-up PRs, in priority order:

1. **Decisions ledger, hydrated from WWMD — single writer, single store.**
   - **Writer:** WWMD only. New tool `ask_decision_perspective` (see §10)
     is the sole path for a specialist to record an architectural choice.
     If a specialist makes a decision without calling it, that is a profile
     coverage gap (captured as a `defer` outcome on the next caller), not
     an extraction problem to paper over with regex. **The rev 3 regex
     extractor for spontaneous "I chose X because Y" prose is dropped** —
     it would create a false sense of coverage and quietly let undocumented
     decisions accumulate.
   - **Authoritative store:** `DecisionInteraction` rows. These already
     exist in the schema and already carry confidence, rationale, and
     audit fields.
   - **Projection into scoped context:** `featureBuild.taskResults.decisions[]`
     holds **`interactionId` references only**, not duplicated rationale.
     Rendering the decisions slot in `buildScopedTaskContext` looks the
     rationale up at dispatch time. This avoids the same dual-persistence
     smell that §4.3 flagged for `PhaseHandoff` rows.
   - **Slot:** dedicated, ~800 chars, separate from artifact summary so
     it does not get LRU-evicted as artifacts accumulate. Eviction policy
     when the slot itself overflows: **recency + topic-overlap with the
     current task**, not confidence (a low-confidence `arbitrate` is
     exactly the fragile commitment subsequent tasks must respect; see
     §10.3 for the rationale).

2. **File signature carry-forward — its own BI, not a "cheap step".**
   The rev 3 framing of `tsc --emitDeclarationOnly` as cheap was wrong:
   it adds a compile step per task, needs a writable sandbox, requires a
   specific tsconfig in a multi-tsconfig monorepo, and only covers
   `.ts`/`.tsx`. The "simpler line-based heuristic" alternative would be
   wrong precisely on re-exports, namespace exports, and generic
   signatures — the cases that matter. **This becomes a scoped BI that
   evaluates three paths:** (a) AST extraction via `ts-morph`,
   (b) on-demand `tsc --emitDeclarationOnly` with workspace-aware
   tsconfig resolution, (c) **asking the specialist to emit a signature
   block in its structured outcome** (likely cheapest and most robust;
   structured output beats post-hoc extraction). The chosen approach
   must work for non-TypeScript file types touched by builds (SQL
   migrations, JSON schemas, `.prisma`).

3. **Retry context preservation.** When `outcome === "BLOCKED"`, the next
   retry of the same task receives the prior raw output (clipped to 1500
   chars) as a `Prior attempt blocked because:` slot, replacing the
   dep-titles slot for that one dispatch only. Unchanged from rev 3.

4. **Drop the dep-titles slot entirely.** Artifact summary already covers
   it. Unchanged from rev 3.

5. **Skip the `PhaseHandoff` write for internal task handoffs — after a
   consumer audit.** Before removal, grep for `PhaseHandoff` readers
   (status views, lifecycle dashboards, audit panels, replay tooling).
   If any consumer relies on internal-handoff rows, the right fix is a
   schema-level `kind: 'internal_task' | 'phase_transition'` discriminator
   with consumers filtering — not silent removal. Resolution lives in the
   fast-follow BI.

6. **Cache-friendly slot order (new — was C8 in rev 3).** Anthropic
   prompt caching rewards stable-prefix / variable-suffix composition.
   Today `buildScopedTaskContext` places the current-task block mid-
   template, defeating the cache. Reorder slots so the stable bits come
   first: header + policy → plan files (stable per build) → decisions
   ledger (append-only, stable within a build) → artifact summary
   (variable, LRU) → current task (always changing). Measure cache hit
   rate before and after via the Anthropic API usage headers. This is a
   real per-dispatch cost lever the prior revision deferred without
   analysis.

### 6.3 Option C (recorded, not taken) — Hierarchical planner-worker

Discard PR #756 and introduce a **build planner** thread that maintains the
mission-constant state (plan + decisions + open issues) and dispatches workers
via `spawnWorkThread` (FB-E6BE8D3B — does not currently exist as a backlog
item; verified). Workers receive scoped context derived by the planner, not
by orchestrator code.

**Why not now.** Strictly larger scope than the BI was written for. The
branch already had a working solution that fixed the reported bug. The
fast-follow plan in §6.2 closes the gaps incrementally without a rewrite.

**Why still on the record.** It maps onto Cursor's multi-agent kernels
direction and is the architecturally cleanest endpoint. The Level-3
EaView-driven orchestrator in §11 is in the same family. If we ever revisit
the orchestrator's structure, this is the option to revisit.

## 7. Fast-follow plan

The §6.2 items become three follow-up PRs against `main`, in priority order:

- **FF-PR-1 — decisions ledger + dep-titles drop + cache-friendly slot
  order.** Items 1, 4, 6. Single review surface; all three are slot-shape
  changes to `buildScopedTaskContext`. Pre-req: `ask_decision_perspective`
  tool exists (work tracked under BI-FOLLOWUP-WWMD-PERTASK; see §12.3).

- **FF-PR-2 — PhaseHandoff consumer audit + duplicate-write removal.**
  Item 5. The audit may invalidate the assumption that the row is purely
  noise; the BI captures both branches (silent removal vs. schema
  discriminator).

- **FF-PR-3 — retry context preservation.** Item 3. Needs new outcome
  plumbing on `BLOCKED` retries; smallest blast radius if shipped last.

- **Separate BI (not a PR yet) — file signature carry-forward.** Item 2.
  Decision-shaped work; the BI's first task is to choose between AST
  extraction, on-demand `tsc`, and specialist-emitted signatures, with
  the non-TS file-type story explicit in the success criteria.

Rationale for the split: FF-PR-1 lands the user-visible quality gain
(decisions survive long builds, fewer cache misses) in one reviewable
diff. FF-PR-2 is gated on the audit. FF-PR-3 and the signature BI are
independent and can land in any order after FF-PR-1.

C7 (single source of truth) is now resolved by §6.2 item 1's
`DecisionInteraction`-only persistence model **plus** item 5's
PhaseHandoff resolution — together rather than separately.

## 8. Acceptance criteria for the chosen design

A measurable definition of "right-sized" for the amended PR:

1. **Size**: After 15 build tasks, the dispatch payload for task 16 is ≤ 8000
   characters. (Already met; codify with a unit test that constructs 15
   stub artefact entries and asserts the rendered context length.)

2. **Decisions survive**: A test where task 3's output contains "Decision:
   chose JWT over sessions" and a `record_build_decision` tool call must
   cause that decision to appear in the scoped context for task 15, even
   when the artifact summary for task 3 has been evicted by LRU truncation.

3. **No semantic drift**: A test asserting that `save_phase_handoff` called
   with the orchestrator's `(AGT-ORCH-300, /build, autoAdvance=false, toPhase=build)`
   tuple does **not** advance the build phase. After FF-PR-2 lands and the
   consumer audit resolves: the call additionally does **not** create a
   `PhaseHandoff` row (silent-removal branch) **or** creates a row with
   `kind: 'internal_task'` that the orchestrator's auto-advance path filters
   out (discriminator branch). Until FF-PR-2 lands, the test asserts only
   the no-advance behaviour and tolerates the row.

4. **No regression on the runaway**: Replay the 14-task fixture that
   originally produced 125K-char payloads; assert task 14's payload size
   is ≤ 8000 characters.

5. **Specialist behaviour**: A behavioural test (mock specialist) where the
   specialist for task 8 receives the scoped context, and the rendered
   prompt visibly includes:
   - the current task's testFirst/implement/verify
   - at least one decision from task ≤ 4
   - file paths from completed tasks
   - **no** raw lifecycle conversation content

## 9. Open questions for the operator

1. **Fast-follow PR ordering.** §7 proposes FF-PR-1 (decisions ledger +
   dep-titles drop + cache-friendly slot order), FF-PR-2 (PhaseHandoff
   audit + duplicate-write resolution), FF-PR-3 (retry context), and a
   separate BI for file signature carry-forward. FF-PR-1 is gated on the
   `ask_decision_perspective` tool existing — should that tool's PR be
   filed inside FF-PR-1, or as its own PR (BI-FOLLOWUP-WWMD-PERTASK)
   landing first? My read: separate PR landing first, since the tool has
   security-surface implications (a new build-phase tool) that deserve
   their own review focus.

2. **Build Studio lifecycle re-entry — answered by §12.2 precedent.**
   FB-60DCE69A advances based on the evidence already on the record
   (vitest 49 ✓, typecheck ✓, CI green on `538bc685`). This question is
   left in place as the historical record of how the precedent was
   established.

3. **WWMD scope expansion.** Current WWMD wiring covers only the plan→build
   advancement gate (`build-studio-gate.ts:planAdvancementQuestion`). §10
   proposes extending it to per-task open-question handling during the build
   phase. Does that fit your roadmap for the WWMD profile, or should this
   spec carry only the integration point and leave WWMD-side changes for a
   separate BI?

4. **EA-process-source ambition level.** §11 sketches three levels (document
   the BS process as an EaView; render the EaView in the BS UI; generate
   orchestrator config from the EaView). Which level is in scope for the
   next reasonable horizon? My read of "a bit ambitious but something to
   consider" is: level 1 now, level 2 next quarter, level 3 as a stated
   north star. Confirm or adjust.

## 10. WWMD integration — open questions during the build phase

**Context.** WWMD ("What Would Mark Do") is the Decision Perspective Kernel
already shipped at [`apps/web/lib/decision-perspective/build-studio-gate.ts`](apps/web/lib/decision-perspective/build-studio-gate.ts).
It is currently wired to a single gate — `plan → build` advancement — and
produces structured outcomes (`recommend` / `arbitrate` / `escalate` /
`defer`) with confidence scores, rationales, and persisted
`DecisionInteraction` records.

The scoped-task-context design as it stands today gives the specialist a
bounded prompt and discards the lifecycle thread. But when a specialist
hits a real open question (an ambiguous requirement, a design fork, a
missing constraint), the bounded prompt is exactly the wrong place to
hallucinate forward. The specialist needs a way to ask, get an
evidence-backed answer, and have that answer become part of the durable
project record.

**WWMD is the right answer.** It already exists, it already produces the
right shape of artefact, and it already has confidence + audit semantics.

### 10.1 Integration shape

Add a tool surface for specialists during the build phase:

- **`ask_decision_perspective`** (new tool) — specialist sends:
  - `question` (the open question, plain language)
  - `domainClass` (e.g., `IMPLEMENTATION_TRADEOFF`, `MISSING_CONSTRAINT`,
    `API_SHAPE_CHOICE`)
  - `options[]` (the choices the specialist has identified)
  - `context` (≤500 chars of why this question came up in the current task)

  Tool returns the `DecisionPerspectiveEvaluationResult` shape that
  `build-studio-gate.ts` already produces: outcome, confidence, rationale,
  `interactionId`. Internally it calls the same `evaluateDecisionPerspective`
  function the plan-advancement gate uses, with the active profile resolved
  the same way.

### 10.2 What the specialist does with each outcome

| WWMD outcome | Specialist behaviour | Persistence |
|---|---|---|
| `recommend` (high confidence, low risk) | Proceed with the recommended option. Record the decision in `taskResults.decisions[]` with the `interactionId`. | Decision row + scoped-context entry |
| `arbitrate` (medium confidence) | Proceed with the recommendation but flag it in the task outcome as `DONE_WITH_CONCERNS`. | Decision row with `requiresReview: true` |
| `escalate` (high risk or low confidence on a high-stakes question) | Stop the task. Return `BLOCKED` with reason `escalated_to_operator`. The build pauses pending a human answer. | Decision row + `EscalationCapture` row + UI surfaces the question |
| `defer` (insufficient profile coverage) | Stop the task. Return `BLOCKED` with reason `wwmd_coverage_gap`. Capture as a profile gap for later WWMD article authoring. | Decision row + profile-gap entry |

### 10.3 How decisions enter the scoped context

The new `decisions[]` projection (§6.2 item 1) is rendered into
`buildScopedTaskContext` as a dedicated slot, ~800 chars. The projection
itself holds `interactionId` references only; the renderer hydrates each
reference from the authoritative `DecisionInteraction` row at dispatch
time. Formatted as:

```
Decisions on record:
- [interactionId WWMD-abc123, confidence 0.78] In task 3: chose JWT over
  session cookies because portal must support cross-origin embed scenarios.
- [interactionId WWMD-def456, confidence 0.92] In task 6: deferred mobile
  layout breakpoint choice to design tokens already defined in
  packages/ui/tokens.ts.
```

This slot is **separate from the artifact summary** so it does not get
LRU-evicted as tasks accumulate.

**Eviction policy when the slot itself overflows: recency + topic-overlap
with the current task, not confidence.** A 0.4-confidence `arbitrate`
outcome with `requiresReview: true` is precisely the fragile commitment
that subsequent tasks must respect or else re-litigate. High-confidence
"obvious" decisions are by definition the ones a fresh specialist could
re-derive without the ledger. Evicting by confidence is therefore
backwards — it sheds the entries most expensive to lose. Preferred
ordering when trimming:

1. Drop decisions whose `interactionId` has not been referenced by the
   current task's `task.files` or title keywords (low topic-overlap).
2. Among remaining, drop oldest first (recency tail).
3. If the slot still overflows, clip rationales (not entries) — keep the
   `interactionId` and one-line summary, drop the long-form rationale.

Never drop a `requiresReview: true` decision unless it is older than the
two prior phase boundaries.

### 10.4 Why this is a win beyond just "carry decisions forward"

1. **Coherence across long builds.** Task 9 cannot architecturally drift
   from task 3 if task 3's WWMD-blessed choice is sitting in its scoped
   context.
2. **Confidence visible at decision time.** A 0.4-confidence
   "recommendation" is treated differently from a 0.95-confidence one. The
   specialist behaviour can branch on it.
3. **Escalation has a real off-ramp.** Right now a specialist that hits an
   open question has no good move — best case, it makes a guess that may
   be wrong; worst case, it hallucinates. WWMD gives it a structured
   "stop and ask" with full audit context.
4. **Profile gaps become a flywheel.** Every `defer` outcome captures a
   coverage gap for WWMD profile authors to address. Build Studio runs
   actively improve the doctrine the platform operates under.
5. **The data already persists.** `DecisionInteraction` rows already exist
   in the schema; we are not adding a new persistence concept, just a new
   caller.

### 10.5 Acceptance criteria for the WWMD integration

In addition to §8:

6. **Tool reachable from build-phase specialists.** The
   `ask_decision_perspective` tool appears in `getAvailableTools` for any
   build-phase specialist with `view_platform`. (Test:
   `mcp-tools.test.ts` shows it in build-phase tool list.)

7. **Decision recorded with a single source of truth.** Calling
   `ask_decision_perspective` from a build-phase specialist creates a
   `DecisionInteraction` row (authoritative). The `interactionId` is
   appended to `featureBuild.taskResults.decisions[]` as a reference
   only — rationale/confidence/outcome are never duplicated into
   `taskResults`. The rendering layer hydrates the reference at dispatch
   time. Test asserts that mutating the `DecisionInteraction` row is
   immediately visible in the next scoped-context dispatch (proves there
   is no shadow copy).

8. **Escalation halts the build.** A WWMD outcome of `escalate` causes
   the calling task to return `BLOCKED` with reason
   `escalated_to_operator`, and the orchestrator does not advance to the
   next task in the dependency graph until the operator answers.

9. **Decisions slot survives LRU.** With 20 completed tasks where
   artifact summaries have been truncated, the decisions slot still
   contains the decision recorded in task 2 (assuming it was a high-
   confidence outcome).

## 11. EA tool as source-of-truth for the BS process — exploration

**Mark's prompt.** "We have the diagram, but a more elaborate business
process should illustrate what that design is, and potentially be a
source to manipulate the process implemented in the build studio."

**Substrate that already exists.** The EA tool
([apps/web/app/(shell)/ea/page.tsx](apps/web/app/(shell)/ea/page.tsx))
supports `EaView` records with layout types `graph`, `swimlane`, `matrix`,
`layered`. Reference models exist via `getReferenceModelsSummary`. The
swimlane layout in particular is the natural fit for a phase-by-phase
business process: rows = specialist roles, columns = phases (ideate /
plan / build / review / ship), cells = tasks and handoffs.

**Three ambition levels.**

### Level 1 — Document the BS lifecycle as an EaView (definitely scope)

A single hand-authored swimlane EaView that captures the Build Studio
lifecycle as a business process:

- Rows: orchestrator, build specialists (software-engineer, data-architect,
  qa, design-reviewer, etc.), human operator
- Columns: ideate, plan, build (with per-task swim-cells), review, ship
- Cells: tasks, gates, decisions
- Handoffs: explicit arrows for phase transitions, with the gate function
  named on the arrow (`checkPhaseGate(ideate → plan)`)
- WWMD interactions: marked at decision points, rendered as decision
  diamonds

**Value.** The document becomes the canonical illustration of how Build
Studio actually works. Useful for onboarding new operators, useful for
auditors, useful for the WWMD profile authors (the doctrine is much
easier to write against a visible process than against code).

**Cost.** Low. One EaView record. ~half a day of authoring time.

### Level 2 — Render the EaView live in the Build Studio UI (next horizon)

When a build is running, the BS UI renders the EaView with the live task
state overlaid: completed tasks shaded green, in-flight tasks animated,
blocked tasks red, pending tasks grey. The arrows show which gates have
fired.

**Value.** Operators get a single view of process state without having to
read activity logs. The "phase-dependency graph shown in the UI" mentioned
in the BI's acceptance criterion #5 becomes literally the EaView. Closes
the gap between the documented process and the executed process.

**Cost.** Medium. Requires a renderer that maps `EaView` nodes to
`FeatureBuild.taskResults` entries and `PhaseHandoff` records. New
component, new query layer, but no schema changes.

### Level 3 — Generate orchestrator config from the EaView (ambitious north star)

The EaView is not just documentation — it is the source of truth that the
orchestrator reads at runtime. Adding a new specialist role means adding
a row to the EaView, not editing TypeScript. Adding a new task type means
adding a swimlane cell with attached metadata (prompt template, tool
allowlist, retry policy). Changing a gate means editing the arrow's
attached predicate.

**Value.** Model-driven Build Studio. The process *is* the diagram. Mark
or a domain expert can edit the lifecycle by editing the EaView, without
shipping code. Aligns with DPF's "configuration as data, not code"
direction.

**Cost.** High. Requires a schema for embedding executable metadata on
EaView nodes/edges, a runtime that interprets it, a migration path off
the current hardcoded specialist/phase definitions, and careful version
management (a running build must keep its EaView snapshot stable). This
is a quarter+ of work, but it is also the thing that would make Build
Studio genuinely composable.

### Recommendation for §11

- **Level 1 now**, as a fast-follow to this PR: file a separate BI
  ("Document Build Studio lifecycle as canonical EaView swimlane") and let
  Build Studio author it. Adopt it as the visual reference in
  `AGENTS.md`.
- **Level 2 next major build window**: file a BI to render the live
  EaView in the BS UI. Depends on the live build state already being
  queryable (it is).
- **Level 3 as stated north star**: capture in a new epic
  (`EP-BUILD-MODEL-DRIVEN` or similar) with the level-1 EaView as its
  concrete first artefact. Implementation deferred but the goal is
  named in the roadmap so subsequent decisions can be measured against
  it.

The Level 1 EaView is the predicate for everything else. Without it,
Level 2 has nothing to render and Level 3 has nothing to interpret. So it
is the single concrete next-step deliverable from §11.

---

*End of original validation. Post-merge addendum follows.*

## 12. Post-merge addendum — governance precedent and follow-up plan

### 12.1 What landed

Commit `538bc685` on `main` (PR #756). Two functional commits:

- `dfc25c56` — scoped task context implementation
- `e5c9bea9` — guard for `save_phase_handoff` controls (the `(AGT-ORCH-300,
  /build, autoAdvance=false)` recogniser)

Plus a `main`-merge commit for fast-forward parity.

### 12.2 Governance precedent — evidence, not provenance

> **Build Studio gate functions (`checkPhaseGate`, `reviewDesignDoc`,
> `reviewBuildPlan`, etc.) evaluate the persisted evidence fields they
> name; they do not require that BS dispatch produced those fields.**
> A draft can advance through phases when the named evidence is present
> and passes review, regardless of whether the specialists that produced
> it ran inside BS, on an external branch, or by an operator's hand.

This is operator-ratified (2026-05-18) and should become a wiki principle
candidate under `docs/founder-kernel/wiki/principles/` with a short title
like `governance-approves-evidence-not-provenance`. It generalises to:

- External branches that satisfy the gate evidence requirements
- Operator-driven hotfixes that bypass BS dispatch
- Hand-coded BIs where the implementer is human

**Scope limit — trust-boundary controls still apply.** This principle
governs only gate-evidence evaluation. It does **not** bypass the
platform's trust-boundary controls:

- **DCO sign-off** is still required on every commit
- **Signed-off-by** identity rules still apply to contributors
- **Contribution-mode rules** (PR provenance, capsule scope, hive
  contribution checks) still apply to anything entering the public
  repository
- **Security review** (secrets scan, backdoor detection, dependency
  vulnerabilities) is not gate-evidence — it is a hard prerequisite that
  runs independently

A contribution that fails any trust-boundary check cannot ride this
precedent past those checks, no matter how clean its gate evidence is.
Evidence-not-provenance is about *who produced the artefact*, not about
*who is allowed to commit it*.

### 12.3 Post-merge action plan

1. **This spec** is committed and PR'd as the design + governance trail.
   It seeds `FB-60DCE69A.designDoc` substance.

2. **`FB-60DCE69A` phase advancement** proceeds based on:
   - **`designDoc`**: this spec
   - **`designReview`**: via `reviewDesignDoc` tool
   - **`buildPlan`**: synthesised from the merged commits' file structure
   - **`planReview`**: via `reviewBuildPlan` tool
   - **`taskResults`**: the existing `FeatureBuild.taskResults` (populated
     by the orchestrator that ran the branch's tests)
   - **`verificationOut`** / **`acceptanceMet`**: the existing evidence
     entry on BI-0789AF6B (vitest 49 ✓, typecheck ✓, build ✓) +
     CI green on commit `538bc685`
   - **`ship`**: the merge itself

3. **Follow-up BIs** to be filed (substrate gap: no
   `create_backlog_item` in current MCP surface — see §12.5):

   - **BI-FOLLOWUP-WWMD-PERTASK** (prerequisite for FF-PR-1): WWMD scope
     expansion — `ask_decision_perspective` tool for build-phase
     specialists; escalate/defer halt semantics on the orchestrator;
     profile material for build-time question classes
     (`IMPLEMENTATION_TRADEOFF`, `API_SHAPE_CHOICE`, `MISSING_CONSTRAINT`).
   - **BI-FOLLOWUP-CONTEXT-FFPR1** (FF-PR-1): decisions-ledger slot wired
     to `DecisionInteraction` (reference-only projection), drop dep-titles
     slot, reorder slots for cache-friendly composition.
   - **BI-FOLLOWUP-CONTEXT-FFPR2** (FF-PR-2): `PhaseHandoff` consumer
     audit; resolve duplicate-write via silent removal *or* schema
     discriminator based on audit outcome.
   - **BI-FOLLOWUP-CONTEXT-FFPR3** (FF-PR-3): retry-context preservation
     for `BLOCKED` retries.
   - **BI-FOLLOWUP-SIGNATURE-EXTRACT**: file signature carry-forward —
     decision-shaped BI evaluating AST extraction, on-demand `tsc`, and
     specialist-emitted signature blocks; must address non-TS file types
     (SQL, JSON schemas, `.prisma`).
   - **BI-FOLLOWUP-EA-PROCESS-L1**: Author the Build Studio lifecycle as
     a single swimlane `EaView` (Level 1 of §11).

4. **New epic** for the Level-3 north star:
   `EP-BUILD-MODEL-DRIVEN` — Build Studio orchestrator reads its process
   definition from an EaView at runtime. Level 1 (the swimlane) is its
   concrete first artefact; Level 2 (live render in BS UI) is its
   second; Level 3 (runtime interpretation) is the destination.

### 12.4 What WWMD validated

Of the four §9 open questions, WWMD-style reasoning produced clean
outcomes for three and correctly escalated the fourth (the governance
question itself, which the operator then answered with the
evidence-not-provenance precedent). This validates the §10 design before
implementation — WWMD applied to its own design questions behaved
correctly. That is exactly the runtime behaviour the integration aims
for.

### 12.5 Known substrate gaps surfaced by this exercise

1. **No `create_backlog_item` in the exposed MCP surface.** Filing the
   three follow-up BIs from a Claude session requires either:
   (a) extending the MCP surface to include backlog mutation;
   (b) creating BIs via a deliberate operator action in the UI;
   (c) routing BI creation through Work Capsules + `record_capsule_evidence`
   with a structured payload that BS / triage picks up.
   Resolution is itself a small BI to file once the surface is unblocked.

2. **No `saveBuildEvidence` in the exposed MCP surface.** Same as above
   for phase-advance mechanics. The `reviewDesignDoc` /
   `reviewBuildPlan` tools are exposed but the underlying evidence
   seeding is not. This forces operator-mediated phase advance for
   external-branch scenarios under the evidence-not-provenance
   precedent.

These gaps are not failures of this design; they are surfaced
substrate questions that should themselves be tracked work.

## 13. Test-coverage audit of the landed commits

The acceptance criteria in §8 / §10.5 describe what "right-sized" looks
like. This section pins which of those criteria the merged commits
(`dfc25c56` + `e5c9bea9` on `538bc685`) actually verify today and which
remain assertions on paper. The point is to prevent a fast-follow PR
from quietly "fixing" a known gap via heuristic without anyone noticing
the regression test never existed.

### 13.1 Audit matrix

| Criterion | Covered by landed test? | Notes / gap |
|---|---|---|
| C1 — 8K cap after 15 tasks (§8 #1) | TBD — audit step 1 below | If absent, FF-PR-1 must add a unit test that constructs 15 stub artefact entries and asserts `clipText` enforces the cap |
| C1 — replay of 14-task fixture (§8 #4) | TBD — audit step 1 | Same |
| C2 — test/implement/verify carried (§8 #5) | TBD — audit step 1 | Behavioural test on `buildScopedTaskContext` output |
| C3 — decisions survive eviction (§8 #2) | ❌ not covered (feature does not exist yet) | Lands with FF-PR-1; pin a regression test that records a decision in synthetic task 3, evicts task 3's artifact summary via LRU, and asserts the decision still renders |
| C4 — file shapes carry forward | ❌ not covered (feature does not exist yet) | Lands with the signature-extract BI |
| C5 — retry context preserved | ❌ not covered (feature does not exist yet) | Lands with FF-PR-3; pin a test that runs a `BLOCKED` task twice and asserts the second dispatch contains the prior failure prose |
| C6 — no semantic drift (§8 #3) | ✅ likely covered by `resolveSavePhaseHandoffTransition` tests | Audit step 2: confirm a test asserts the no-advance behaviour for the `(AGT-ORCH-300, /build, autoAdvance=false)` tuple |
| C7 — single source of truth | ❌ not applicable yet (dual-store smell not introduced) | Pin C7 as a *prohibition test* in FF-PR-1: assert that `taskResults.decisions[]` contains only `interactionId` references, no rationale fields |
| C8 — cache-friendly slot order | ❌ not covered (slot order currently defeats cache) | Lands with FF-PR-1; assert via snapshot test that the stable prefix appears before any variable slot |

### 13.2 Audit steps to run before FF-PR-1 opens

These are not blockers for shipping the fast-follows; they are
preconditions for trusting that the fast-follows do not silently
regress the merged behaviour.

1. **Inventory landed tests.** Grep `apps/web/lib/integrate/__tests__/`
   (or wherever build-orchestrator tests live) for tests that touch
   `buildScopedTaskContext`, `buildTaskArtifactSummary`,
   `buildTaskArtifactEntry`. Catalogue what each asserts. Any of C1, C2
   without a corresponding test becomes a tiny precursor PR that adds
   the regression coverage *before* FF-PR-1 changes the slot shape.

2. **Confirm the C6 guard has a test.** Find the test (if any) that
   exercises `resolveSavePhaseHandoffTransition` with the orchestrator
   tuple. If absent, add it as part of FF-PR-2 (the audit branch will
   touch this code path anyway).

3. **Pin the known gaps as `it.todo` / `xfail` entries.** For C3, C4,
   C5, C7, C8 — add placeholder test stubs in the test file with
   `it.todo("...")` markers naming the criterion. They cost nothing,
   they show up in test output as known gaps, and they prevent the
   "fixed by heuristic without coverage" failure mode. Each fast-follow
   PR replaces its `it.todo` with a real assertion.

### 13.3 Definition of done for this audit

The audit is complete when:

- §13.1 column 2 has ✅ / ❌ in every row (no TBDs)
- §13.2 step 3 has produced `it.todo` entries for every ❌ row
- Any C1 / C2 row that came back ❌ has a precursor PR opened against
  `main` to add the regression coverage *before* FF-PR-1 changes slot
  shape

This audit is a small piece of preparatory work, not a blocker for the
design itself. It is captured here so the fast-follow author has an
explicit checklist rather than discovering missing coverage mid-PR.

---

*End of validation document. This spec is the durable record of the
design choices in PR #756, the chief-architect feedback folded into
rev 4, and the governance precedent established for external-branch
lifecycle re-entry. The fast-follow PR plan (§7) and follow-up BI list
(§12.3) drive subsequent work; filing the BIs depends on §12.5
resolution.*
