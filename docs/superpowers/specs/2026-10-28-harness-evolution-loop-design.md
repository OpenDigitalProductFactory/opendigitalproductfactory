---
status: draft
---

# Harness evolution loop — Slice 6 "Evolution lab" of the Governed Hermes learning loop

| Field | Value |
| --- | --- |
| Date | 2026-10-28 |
| Backlog | BI-49BC21C1 (epic EP-C00F61F4, improvement is a platform facility) |
| Extends | [Governed Hermes learning loop](2026-05-15-governed-hermes-learning-loop-design.md) §6.5, §8.4, Slice 6 |
| WWMD decision | DI-E6FA02FCC221: platform-only, not a client cron |
| Source pattern | Harness² (Google Research, arXiv 2610.14224; github.com/google-research/harness2) |

This design delivers the Hermes spec's Slice 6. It does not supersede that
spec; it fixes the shape Slice 6 takes. The Hermes spec described a
sandboxed experiment flow for skills. This design keeps that and widens the
artifact to any *harness* text an agent runs inside: skills, tool
descriptions, hooks, gates and scripts. That is the set Harness² edits around
a frozen model.

## Why

Detectors already exist. On 2026-10-28 they had filed about 1,370 improvement
items (MCP efficiency 117, tool stabilization 110, convention 28, crash/PIR
1,112), and about 28 were done. Detection works; closure does not. Mining 86
Claude sessions (12,614 tool calls, 668 errors) found about 15 recurring
plumbing failures. They are filed as siblings under EP-C00F61F4 and form this
loop's first queue.

Harness² shows what closes the gap. Editing the files around a frozen model
lifted GLM5 from 64.2 to 75.7 on WorkBuddy. The probe is the load-bearing
step: without probes the ablation fell from 73.4 to 63.2, below baseline. The
experience library was worth 3.1 points. The edits that won were plumbing:
make the tool call instead of narrating it, reopen and verify outputs, put
files where the grader looks.

DPF's own first attempt shows the same thing. A cheap candidate edit, adding
trigger lines to 49 skills, was rejected (KEEP_BASE) after a probe found zero
invocations, a shrink-only instruction-plane ratchet and an invariant coupling
two invocation fields. The loop must do that check every time, automatically.

## Why a typed job

The prompt-only daily review `mcp-efficiency-aiops-YYYYMMDD` has ended `error`
on most days since 2026-09-02: "required governed tool create_backlog_item
executed zero times" (BI-A8679D84). The coworker describes the call instead
of making it. The typed kinds `decision-engine-review`,
`demand-scoring-steward` and `acceptance-sweep` run `ok`. So the loop is a
typed `ScheduledAgentTask` kind whose orchestration is deterministic code.
Model judgement enters only inside the bounded editor and composer steps of
slice 2, each with its own budget.

## Objectives

**OBJ-1:** A typed scheduled job runs the loop daily on the platform with no client installed, and every run records its budget, its spend and what it decided on a TaskRun.

**OBJ-2:** The loop only considers changes it can trace to recorded evidence: each candidate names the recurring signal or backlog item it targets and the trajectory moments (tool executions or recorded pattern keys) behind it, and a candidate without them is rejected before any spend.

**OBJ-3:** A harness edit is adopted only when a hermetic probe shows it beating the unmodified baseline on the same recorded traces; KEEP_BASE is recorded as a first-class outcome.

**OBJ-4:** Adopted edits land only through the governed seed-PR path and are written to an experience library that later runs read.

**OBJ-5:** A weekly rollup shows, for each targeted signal, its recurrence before and after adoption.

## Acceptance

| ID | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | `harness-evolution-loop` is a member of `SCHEDULED_AGENT_TASK_KINDS`, the scheduler's deterministic dispatcher runs it with no model call, and every install's seed creates the daily task with an accountable owner. |
| AC-2 | OBJ-1 | Each run writes one proactive TaskRun per UTC day whose `progressPayload` holds the clamped budget (max candidates, max probe replays, token cap) and the spend (candidates ranked, probe replays, tokens); a second tick on the same day records no second run. |
| AC-3 | OBJ-2 | The run ranks open `ImprovementSignal` rows (which already carry the MCP-efficiency AI Ops findings and the skill-curator findings) together with the configured seed queue, seed items first, and stores the ranked candidates with their trajectory references in a `harness-evolution-candidates` TaskArtifact. |
| AC-4 | OBJ-2 | A candidate with no trajectory reference, and a seed item that is missing or already terminal, is listed with its reason and never reaches a probe. |
| AC-5 | OBJ-3 | Slice 2: each candidate edit is probed by the WorkPattern experiment runtime as a baseline-versus-candidate pair on the same hermetic replay fixture, with no network route to a grader or rubric, and the verdict (ADOPT or KEEP_BASE) and contrast are recorded on the run. |
| AC-6 | OBJ-3 | Slice 2: probe replays and editor tokens stop at the run's caps, and a run that hits a cap records which candidates went unprobed. |
| AC-7 | OBJ-4 | Slice 3: an ADOPT verdict opens a governed seed PR through `seed-pull-request.ts`; nothing writes a live harness file directly. |
| AC-8 | OBJ-4 | Slice 3: each adopted or rejected edit writes an EXPERIENCE record (weakness, trajectory moments, probe contrast, what was dropped) to the work-pattern effective ledger, and the next run's ranking reads it so a KEEP_BASE candidate is not re-proposed without new evidence. |
| AC-9 | OBJ-5 | Slice 4: a weekly rollup lists each targeted signal's `recurrenceCount` growth in the window before and after its edit merged. |

## Design

### The loop

Each daily run does four steps. The paper calls them propose, probe, compose
and library.

1. **Rank** (slice 1, deterministic). Read the queue, rank it, and drop
   anything without trajectory evidence.
2. **Propose and probe** (slice 2). For the top candidates within budget, a
   bounded editor writes one harness edit per candidate. The WorkPattern
   experiment runtime replays the candidate's recorded traces hermetically
   against baseline and candidate.
3. **Compose** (slice 3). Edits that win, and do not conflict, are composed
   into one governed seed PR.
4. **Library** (slice 3). Every outcome, ADOPT or KEEP_BASE, becomes an
   EXPERIENCE record that later runs read.

### Slice 1 — the typed job and the ranked queue

**Kind.** `harness-evolution-loop` joins `SCHEDULED_AGENT_TASK_KINDS`, and
`runDeterministicScheduledTaskKind` dispatches it to
`executeHarnessEvolutionLoopTask` (`apps/web/lib/harness-evolution/`). The
seed `packages/db/src/seed-harness-evolution-loop.ts` creates the task
`harness-evolution-loop-daily` for agent `platform-engineer` (AI Ops
Engineer), daily at 04:17 UTC, owned by the install's accountable person
through `findTaskOwnerUserId`. `taskConfig` is written on create only, so an
operator's tuning survives re-seeding.

**Sources.** The run reads existing detector output; it does not scan again.

- `ImprovementSignal` rows with `status = "open"` seen inside the lookback
  window (default 30 days). The MCP-efficiency AI Ops handoff already
  projects its findings there (`sourceType = "mcp-call-efficiency"`, with
  `evidence.sampleIds` naming `ToolExecution` rows). So does the skill curator
  (`sourceType = "curator-finding"`), along with the work-pattern observer and
  the other detectors. Re-running the 250,000-row efficiency scan would
  duplicate that work.
- The seed queue: `taskConfig.seedItemIds`, an ordered list of backlog items.
  On this install the seed holds the session-mined siblings under
  EP-C00F61F4. Ids that do not exist on an install are skipped and reported.

**Ranking.** The ranking is pure and deterministic, in
`rank-candidates.ts`:

- Seed items rank first, in configured order.
- Signals follow, scored `recurrenceCount × severity × recency`. Severity is
  2 for `critical`, 1 otherwise. Recency is `exp(-ageDays / 14)` on
  `lastSeenAt`.
- Ties break on `lastSeenAt` (newest first), then on the candidate key, so
  the same input always gives the same order.

**Trajectory evidence.** A signal candidate carries its `ToolExecution` ids
(up to 5) from `evidence.sampleIds`, or its `evidence.patternKey`. A seed
item carries its backlog item id, whose body records the mined trajectory
counts. A candidate with neither is rejected as `no-trajectory`; this is the
editor rule "every edit traces to a named trajectory moment" applied before
any spend. A seed item that is missing, `done` or `retired` is rejected with
that reason.

**Component hint.** Each candidate gets a hint for slice 2's editor, following
the Harness² component priority (gate, hook or script, then a skill with a
trigger line, then a sub-agent, then always-on prose last):

- `mcp-call-efficiency` and work-pattern tool failures → `gate-hook-script`.
- `curator-finding` → `skill`.
- Anything else → `unclassified`. `improvement-flywheel/routing-answer.ts`
  classifies these in slice 2.

The hint is advisory. Slice 2 confirms it.

**Budget and spend.** The caps live in `taskConfig` and are clamped in code:
`maxCandidates` 1–25 (default 10), `maxProbeReplays` 0–200 (default 20),
`tokenCap` 0–2,000,000 (default 200,000), `lookbackDays` 1–90 (default 30).
Slice 1 spends no tokens and no replays, and records that as zero rather
than omitting it. The upstream repository has no spend cap (its issue #4);
this loop has one from the first run.

**Records.** Each run writes one proactive `TaskRun`:

- `repeatedPatternKey` is `harness-evolution:<YYYY-MM-DD>`, so a retry on
  the same UTC day finds the row and records nothing new.
- `progressPayload` holds `{ periodKey, budget, spend, ranked, rejected }`.
- `status` is `completed`.

Under that TaskRun, one `TaskArtifact` with
`metadata.kind = "harness-evolution-candidates"` holds the ranked
candidates and the rejections. The scheduled task and job rows get
`lastStatus` and a one-line summary, the same way
`demand-scoring-steward` records them. A failure records `error` with its
message and never throws into the scheduler.

No schema change: TaskRun, TaskArtifact, ImprovementSignal and
ScheduledAgentTask already have every field this slice writes.

### Slice 2 — propose and probe

- **Editor.** A bounded editor writes one edit per candidate under these
  rules, absorbed from Harness² Appendix H:
  - The edit traces to the candidate's trajectory moments.
  - Component priority follows the hint.
  - Any always-on text it adds must cut an equal amount, because
    `check-instruction-plane-size.mjs` is shrink-only.
  - It never changes a deliverable's shape.
  - It never invents authority, identifiers or citations.
  - Workspace facts copied from the library are hypotheses, re-verified
    before use.
- **Probe.** A new work-pattern variant kind for harness-text edits, keyed on
  `promptOrSkillDigest`, runs a factorial baseline-versus-candidate pair on
  the candidate's hermetic replay fixture (`work-pattern-experiment-fixture.ts`,
  `build/work-pattern-build-replay.ts`, `queue/functions/work-pattern-experiment.ts`).
- **Hermetic.** Probes have no network route to graders or rubrics; the
  upstream paper saw a Codex agent download its own grading rubric. Replays
  read only recorded internal traces. Private-data classes follow the memory
  shape contracts spec (Hermes §15.2 Q3), and no trace leaves the install for
  an external provider unless that policy permits it.
- **Judge.** Selection judges delivery, conformance, fidelity, consistency and
  fitness, not length or polish. Where it can be avoided, the editor and the
  judge are not the same model family as the graded worker; this addresses
  the shared-bias limitation the paper names.
- **Spend.** Replays and tokens count against the run's caps.

### Slice 3 — compose and library

- **Compose.** ADOPT edits that touch disjoint files are composed into one PR
  through `skills/seed-pull-request.ts` and `seed-writeback.ts`. Conflicting
  edits keep the larger contrast and record the other as dropped.
- **Library.** `work-pattern-effective-ledger.ts` gains an EXPERIENCE record
  per outcome. The ranking reads it, so a KEEP_BASE candidate stays down until
  its signal recurs past the recorded count.

### Slice 4 — weekly rollup

The rollup reads EXPERIENCE records and each targeted signal's
`recurrenceCount` history. It reports recurrence before and after the edit
merged. The target is a signal that stops recurring.

## Not taken from Harness²

- **No spend-unbounded search.** Every run is capped.
- **No direct writes to the live harness.** Adoption is a PR.
- **No client cron.** DI-E6FA02FCC221.

## Delivery and backlog

| Slice | Item | Covers |
| --- | --- | --- |
| 1 | BI-49BC21C1: typed kind, seed, ranked candidates, TaskRun budget and spend | AC-1 – AC-4 |
| 2 | Child of BI-49BC21C1: editor plus harness-edit probe variant | AC-5, AC-6 |
| 3 | Child of BI-49BC21C1: compose, seed PR, EXPERIENCE library | AC-7, AC-8 |
| 4 | Child of BI-49BC21C1: weekly before/after rollup | AC-9 |

This design stays `draft` until an independent reviewer passes its
spec-approval gate.

## Design grounding

Specs: the Hermes learning loop (§6.5, §8.4, Slice 6, §15.2),
[continuous improvement flywheel](2026-04-05-continuous-improvement-flywheel-design.md),
[coworker memory shape contracts](2026-05-14-coworker-memory-shape-contracts-design.md).

Code: `apps/web/lib/operate/scheduled-jobs/agent-task-kind.ts`,
`apps/web/lib/actions/agent-task-scheduler-deterministic.ts`,
`apps/web/lib/demand/scoring-steward-task.ts`,
`apps/web/lib/decision/self-review/decision-engine-review-task.ts`,
`apps/web/lib/skills/curator.ts`,
`apps/web/lib/operate/mcp-call-efficiency/report.ts` and `aiops-handoff.ts`,
`apps/web/lib/improvement-flywheel/signals.ts`,
`apps/web/lib/tak/work-pattern-effective-ledger.ts`,
`apps/web/lib/tak/work-pattern-experiment-types.ts`,
`packages/db/src/seed-demand-scoring-steward.ts`,
`packages/db/prisma/schema/{build-delivery,ops-telemetry,ai-coworker}.prisma`.

Live state, read 2026-10-28: 187 open `ImprovementSignal` rows (74
mcp-call-efficiency, 57 work_pattern_observer, 27 platform_issue_report, 15
workroom-flow-bottleneck, 12 thread_checkpoint_fold_failed, 2
a2a-collaboration-health). The highest recurrence is 71
(`claim_nonprod_environment_lease` thrash), with `evidence.sampleIds`
present on the efficiency rows.
