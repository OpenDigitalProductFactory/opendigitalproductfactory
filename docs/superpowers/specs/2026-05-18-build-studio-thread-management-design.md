---
title: Build Studio thread management & scoped task context — design validation
status: post-merge validation (rev 3)
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

> **Status banner (rev 3).** PR #756 merged to `main` as commit `538bc685`
> while this validation was in progress. The §6 Option B amendments are
> therefore no longer executable as "in PR #756" — items 1 (decisions
> ledger), 4 (drop dep-titles), and 5 (skip duplicate PhaseHandoff write)
> become **fast-follow PRs**. Items 2 (file signatures) and 3 (retry
> context) remain as originally scoped. The recommendation in §7 is
> unchanged in substance; only the delivery vehicle shifts from "amend"
> to "follow-up." See §12 for the post-merge action plan and the
> evidence-not-provenance governance precedent.

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
| C8 | Caching-friendly composition (stable prefix, variable suffix) | ⚠️ artifact summary is always variable; could be structured to maximise cache hit |

## 6. Options

### Option A — Ratify PR #756 as-is; file follow-up BI

Merge the PR. The acceptance criteria of BI-0789AF6B are mechanically met. C1,
C2, C6 are solid. C3-C5, C7-C8 become a follow-up BI: *"Build Studio scoped
context — decisions ledger, file-signature carry-forward, retry context."*

**Pro.** Ships the 125K runaway fix today. Iterative; the follow-up has a
clear scope.
**Con.** C3 (decisions survival) is the most user-visible quality gap and
will surface as "the build works but the design is incoherent" exactly when
this fix is supposed to prevent that.

### Option B — Amend PR #756 before merge

Add to the existing PR:
1. **Decisions ledger, hydrated from WWMD.** A separate `decisions[]` field on
   `taskResults`, append-only across tasks. **The primary writer is the WWMD
   Decision Perspective gate** (see §10). When a specialist hits an open
   question during execution, it calls WWMD; WWMD's outcome (`recommend` /
   `arbitrate` / `escalate` / `defer`) along with the `interactionId`,
   confidence score, and rationale gets recorded into `decisions[]`. A
   secondary regex extractor (like `verification` hints today) catches
   spontaneous "I chose X over Y because…" prose. Rendered into scoped
   context as its own slot, ~800 chars, separate from artifact summary so it
   doesn't get LRU-evicted.
2. **File signature carry-forward.** When a task writes a file, the
   orchestrator runs a cheap signature extractor (TypeScript `tsc --emitDeclarationOnly`
   on the touched files, or a simpler line-based heuristic) and stores the
   exported symbol list. Subsequent tasks see `auth.ts → exports
   { signJwt, verifyJwt, AuthError }` instead of just the path.
3. **Retry context preservation.** When `outcome === "BLOCKED"`, the next
   retry of that same task gets the prior raw output (clipped to 1500 chars)
   as a `Prior attempt blocked because:` slot, replacing the dep-titles slot
   for that one dispatch.
4. **Drop the dep-titles slot** entirely. Artifact summary already covers it.
5. **Skip the `PhaseHandoff` write for internal task handoffs.** The
   `taskResults` field is canonical; the duplicate row is noise.

**Pro.** All 8 criteria addressed in one merge. Single review surface.
**Con.** Doubles the PR size. Decisions extraction is heuristic and could
miss real decisions; needs an explicit tool surface for the specialist to
record decisions deliberately.

### Option C — Reject; redesign as hierarchical planner-worker

Discard PR #756. Introduce a **build planner** thread that maintains the
mission-constant state (plan + decisions + open issues) and dispatches workers
via `spawnWorkThread` (FB-E6BE8D3B — not yet implemented, may not exist).
Workers receive scoped context derived by the planner, not by orchestrator
code. The planner sees worker artefacts and decides what to carry forward.

**Pro.** Architecturally cleanest. Maps onto Cursor's multi-agent kernels
direction.
**Con.** Strictly larger scope than the BI was written for. FB-E6BE8D3B
doesn't currently exist as a backlog item (verified). Pushes the 125K fix out
weeks. The branch already has a working solution that fixes the reported bug.

## 7. Recommendation

**Option B — amend PR #756 before merge** — with the following narrowing:

- **In this PR**: add the decisions ledger (item 1) and drop the dep-titles
  slot (item 4). Skip the duplicate `PhaseHandoff` write (item 5).
- **In a fast-follow PR after this one merges**: file signature
  carry-forward (item 2) and retry-context preservation (item 3).

Rationale: C3 (decisions survival) is the gap most likely to materially
degrade user-visible build quality. Adding it now is small (one new field on
`taskResults`, one new context slot, one tool definition for the specialist to
record decisions explicitly). C4 and C5 are wins but mechanically larger —
signature extraction touches the sandbox tooling boundary; retry context
needs new outcome plumbing. Splitting them out keeps this PR reviewable.

C7 (single source of truth) becomes free if we accept item 5 — the
`PhaseHandoff` row is genuinely redundant for internal handoffs.

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
   tuple does **not** create a `PhaseHandoff` row and does **not** advance
   the build phase. (After item 5; before item 5 it must continue to skip
   advance but may still write the row.)

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

1. **Per-PR vs. follow-up split.** Is the proposed split (decisions ledger
   wired to WWMD + drop dep-titles + drop duplicate handoff write in this PR;
   signatures + retry context in a fast-follow) acceptable, or would you
   prefer everything in one PR / everything as follow-ups?

2. **Build Studio lifecycle re-entry.** The active build `FB-60DCE69A` is
   still in `phase: ideate` despite the implementation existing. If we amend
   PR #756 directly, do we mark the BS draft `complete` retroactively, or
   run it through review/ship gates against this design doc as the spec?

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

The new `decisions[]` ledger (§6 Option B item 1) is rendered into
`buildScopedTaskContext` as a dedicated slot, ~800 chars, formatted as:

```
Decisions on record:
- [interactionId WWMD-abc123, confidence 0.78] In task 3: chose JWT over
  session cookies because portal must support cross-origin embed scenarios.
- [interactionId WWMD-def456, confidence 0.92] In task 6: deferred mobile
  layout breakpoint choice to design tokens already defined in
  packages/ui/tokens.ts.
```

This slot is **separate from the artifact summary** so it does not get
LRU-evicted as tasks accumulate. The decisions slot only evicts when its
own budget is exceeded, and even then it evicts the lowest-confidence
entries first (high-confidence decisions are by definition the
load-bearing ones).

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

7. **Decision recorded in both stores.** Calling
   `ask_decision_perspective` from a build-phase specialist creates a
   `DecisionInteraction` row AND appends to
   `featureBuild.taskResults.decisions[]`, with matching `interactionId`.

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

> **A Build Studio draft can advance through phases when the evidence
> required by `checkPhaseGate` is present and passes review, regardless of
> whether BS dispatched the specialists that produced it.** Governance
> approves the evidence and the gate result, not the path that produced
> the evidence.

This is operator-ratified (2026-05-18) and should become a wiki principle
candidate under `docs/founder-kernel/wiki/principles/` with a short title
like `governance-approves-evidence-not-provenance`. It generalises to:

- External branches that satisfy the gate evidence requirements
- Operator-driven hotfixes that bypass BS dispatch
- Hand-coded BIs where the implementer is human

The principle constrains *what* governance evaluates (evidence) without
constraining *who* produced it.

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

3. **Three follow-up BIs** to be filed (substrate gap: no
   `create_backlog_item` in current MCP surface — see §12.5):

   - **BI-FOLLOWUP-CONTEXT-AMEND**: PR #756 fast-follow amendments —
     decisions ledger hydrated from WWMD; drop dep-titles slot from
     `buildScopedTaskContext`; skip duplicate PhaseHandoff write for
     internal task handoffs.
   - **BI-FOLLOWUP-WWMD-PERTASK**: WWMD scope expansion —
     `ask_decision_perspective` tool for build-phase specialists;
     escalate/defer halt semantics on the orchestrator; profile material
     for build-time question classes (`IMPLEMENTATION_TRADEOFF`,
     `API_SHAPE_CHOICE`, `MISSING_CONSTRAINT`).
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

---

*End of validation document. This spec is now the durable record of the
design choices in PR #756 and the governance precedent established for
external-branch lifecycle re-entry. Two follow-up BIs (FOLLOWUP-CONTEXT-AMEND,
FOLLOWUP-WWMD-PERTASK) and one new epic (EP-BUILD-MODEL-DRIVEN) are seeded
here; filing them depends on §12.5 resolution.*
