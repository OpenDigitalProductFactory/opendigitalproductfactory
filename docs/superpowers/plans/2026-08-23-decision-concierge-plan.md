---
status: draft
---

# Decision Concierge — implementation plan

Spec: `docs/superpowers/specs/2026-08-23-decision-concierge-design.md`
Epic: EP-0AF96937 · Workroom: WC-69329196
Backlog: BI-6700AF66 (P1), BI-3D0FB84B (P2), BI-19B350FD (P3), BI-C62127B9 (P4)

Each phase ships on its own and leaves the surface better than it found it. Do
not start a later phase before the earlier one is merged: a recommendation shown
without origin context is worse than no recommendation.

---

## Phase 1 — Context (BI-6700AF66)

**Goal:** an owner opening a decision record can tell what it is about and what
each option costs, and following any link out of it keeps what they just read.

1. **`apps/web/lib/decision/decision-origin.ts`** (pure, dependency-injected db
   reader; no Prisma import in the pure half).
   - `resolveDecisionOrigin(row, db)` walking build → task run → session token →
     agent → thread, returning `DecisionOrigin` plus `matchedVia` so the UI can
     state how it knew.
   - Recurrence counts exact-question repeats. Paraphrase clustering stays on
     the review page: running embeddings from a record page would make the page
     fail whenever the embedding runtime is down, and this count is context,
     not a resolution boundary.
   - Tests: each resolution step in isolation, the "nothing resolves" case, and
     that a partial match never presents itself as certain.
2. **Schema (deferred to Phase 2):** `DecisionInteraction.workroomId String?` +
   `@@index`, written by the gate when the caller context carries a room. The
   resolver covers every row without it, so this rides the migration Phase 2
   already needs rather than spending a migration on a convenience column.
4. **Record page** (`app/(shell)/coworker-decisions/decisions/[interactionId]`):
   a "Where this came from" section above Options — workroom (linked, with its
   objective), coworker (display name + role, not the agent slug), what it was
   doing, requester, and the recurrence line. Theme tokens only.
5. **Consequences:** `apps/web/lib/decision/option-consequences.ts` — pure
   projection from `scoredOptions` features + origin blast radius to one line per
   option. Returns nothing for unscored rows; the page renders exactly what it
   does today in that case. Tests cover the empty case first.
6. **Seeded forms:** the record's "answer it once" step carries `focus` (the
   finding's domain) and `from` (the interaction id) plus a fragment, so the
   review page opens that finding's answer box with the question restated.

**Status:** implemented on `feat/decision-concierge` — steps 1, 4, 5 and 6 done,
step 2 deferred as above, step 3 rides step 2.

**Gate:** affected vitest files pass (30), `pnpm --filter web typecheck` clean,
50 preflight guards clean, prose-lint and style-drift show no growth. Still
outstanding: UX verification of the record page against a live unresolved
decision on the contributor preview.

---

## Phase 2 — Proposal substrate (BI-3D0FB84B)

1. `DecisionResolutionProposal` model + migration (spec §4.4). Run the new-model
   cascade: classification, docs, any coverage tests the schema guards require.
2. `apps/web/lib/decision/resolution-proposal-store.ts` — create, list-open,
   rule (accept / amend / reject), supersede, expire. Ruling is idempotent and
   loses to a concurrent ruling rather than double-writing (mirror
   `ruleWeightAdjustmentProposal`'s already-ruled path).
3. Write-through adapters, one per `actionKind`, each delegating to the existing
   path — no new resolution mechanics.
4. Inline accept / amend / reject control on the record; amendment posts the
   edited text and stores the draft-vs-accepted delta.
5. Review queue reshaped: proposal-ready rows first, headline = the proposal
   summary, action = "Review the recommendation" into the record.
6. Tests: lifecycle transitions, each adapter's write-through, the
   nothing-auto-applies invariant, and supersession when the interaction
   resolves elsewhere.

**Approved substrate delta.** `prismaModelCount` ratchets 606 -> 607 for
`DecisionResolutionProposal`. The alternative — folding a drafted resolution
into `DeliberationOutcome` or `DecisionInteraction.outcomePayload` JSON — was
rejected: a proposal needs its own identity (one per thing-being-decided, so a
re-run cannot pile duplicates), its own ruling lifecycle with a first-ruling-wins
conditional update, and foreign keys to the decision, the profile, the panel run
and the ruling user. None of that survives inside a JSON blob. Its closed sets
are real Prisma enums (`DecisionProposalScope|Action|Status`), and row liveness
uses the canonical `RecordLifecycle` convention rather than a sixth spelling of
"not active": `status` records what the HUMAN ruled, `lifecycle` records whether
the row is still live, and a draft retired because its decision was settled
elsewhere still reads `proposed` — because nobody ever ruled on it. No other
non-increasing substrate metric is relaxed.

**Status:** implemented on `feat/decision-resolution-proposals`. The model,
migration, store, write-through adapters, the inline accept/amend/reject card
and the review-queue section are in; `amend-stance` and `release-material`
deliberately REFUSE rather than reporting a success they cannot deliver, and
stay that way until their write paths are wired. The `workroomId` column is
NOT in this migration after all: nothing writes it until the panel exists, and
a column with no writer is dead substrate that reads as capability. It lands
with its writer in Phase 3.

---

## Phase 3 — The panel (BI-19B350FD)

1. `deliberation/governance-triage.deliberation.md` seed (roles, adjudication
   mode, evidence requirements, output contract).
2. `apps/web/lib/decision/triage-staffing.ts` — pure `domainClass` + portfolio →
   profession families → live agents, with the honest empty case.
3. Runner wiring: on escalate/defer with risk ≥ medium, start a governance-triage
   run through the existing orchestrator, set `deliberationRunId`, seal onto the
   room via the existing bridge, and write a proposal from the adjudicator's
   output.
4. Output-contract validation: a run missing `recommendedAction`, `draft`,
   `consequences` or `dissent` records `insufficient-evidence` and writes no
   proposal.
5. Panel card on the record: roster, recommendation, dissent, confidence,
   uncovered domains.
6. Tests: staffing map, contract validation (the no-proposal path first), and
   that a failed panel leaves the record exactly as Phase 1 left it.

**Status:** the pattern seed, both role prompts, the staffing map, the verdict
contract, the conductor and the panel-roster line on the card are implemented on
`feat/governance-triage-panel`, with 37 tests over the three new pure modules.

**The trigger ships with it.** Hooking the kernel gate directly was rejected —
a panel is provider-bound and asynchronous, and the gate is a hot path that must
not wait on one. The caller is the Phase 4 sweep below, so Phases 3 and 4 land
together: a panel nothing triggers is dead substrate that reads as capability.

**Staffing signal quality — measured, not assumed.** The live ledger carries
five domain classes across every unresolved decision (plan-readiness,
kernel-consult, architecture-tradeoff, risk-assessment, professional-practice),
which cannot separate a payroll question from a marketing one. Staffing
therefore reads the profession gate first, then subject matter in the question
text, then the domain class where it is unambiguous — and reports which signal
it used. Subject-matter matching is a labelled heuristic; when nothing matches,
the panel runs kernel-only and the card says so.

---

## Phase 4 — The standing process (BI-C62127B9)

1. Convene the standing governance workroom (idempotent; one row).
2. `decision-concierge-sweep` scheduled task: shared queue predicates, cluster,
   panel under caps, write proposals, post the room digest, age items, and log
   what it skipped.
3. Attention: `ai-decision` items gain one-tap approve/reject when a proposal is
   ready; digest and nav counts.
4. Tests: cap enforcement and the skip log, the ageing rule, and that the sweep
   and the review page cannot drift apart on which decisions are open.

**Status:** implemented on `feat/governance-triage-panel` together with Phase 3.

- `decision-perspective/owner-ruling-queue.ts` is the ONE definition of "waiting
  on a human", and the sweep composes on it rather than restating it. Three
  copies of that predicate drifted once already (BI-6EC1EE25). This branch
  originally added its own consolidating module; `owner-ruling-queue.ts` landed
  on `main` first with the same purpose plus an organization-profile ownership
  boundary (BI-EB5E9BE3), so it is the canonical home and the duplicate was
  dropped rather than reconciled.
- `concierge-sweep.ts` is bounded and reports what it dropped — a cap that
  truncates silently reads as "everything was covered" the moment anyone looks.
  It never resolves anything: it writes proposals that sit at `proposed` until a
  human rules.
- `triage-panel-binding.ts` convenes the run through the existing orchestrator
  and parses the adjudicator's verdict narrowly: either a JSON object comes out
  or `null` does, and a verdict nobody can parse is refused rather than repaired.
- The standing governance room is upserted on a stable key and each pass is
  appended as activity — convened once, never closed.
- The attention inbox now leads with the suggestion and asks for a review rather
  than judgment once a draft exists.

Deferred deliberately: the nav count and the weekly-digest line. Both are
cosmetic next to the trigger, and neither is worth widening this change.

---

## Cross-cutting

- One source for "which decisions are open": the review page, the sweep and the
  attention source share the predicate module. If they can disagree, they will.
- Every surface degrades to the current behaviour when a panel has not run, the
  inference runtime is down, or the origin cannot be resolved.
- Documentation impact per phase: the decision-governance surface docs and the
  operator-facing help copy change with Phase 1 and Phase 4.

## Running a panel: the contract the first implementation got wrong

The panel shipped unable to complete a single run. Ten `governance-triage`
runs were created on the live install and none finished, against 222 waiting
decisions. Both causes were invented identifiers, and both were invisible to
unit tests because the tests asserted against fixtures rather than the engine.

**A pattern may only use role ids the orchestrator implements.**
`lib/deliberation/orchestrator.ts` maps roles to node types through a hardcoded
switch, and finds the fan-in node by an exact `roleId === "adjudicator"` match.
A pattern declaring `resolution-adjudicator` gets branch nodes and *no
adjudicator node* — the run has nothing to conclude it and stays `pending`
forever, with no error anywhere. The vocabulary today is `author`, `reviewer`,
`skeptic`, `debater`, `adjudicator`; unknown ids fall back to a generic review
node with a `console.warn` nobody reads. Node types are likewise fixed
(`analyze`, `review`, `skeptical_review`, `summarize`).

**Orchestration persists a graph; it does not run it.**
`orchestrateDeliberation` writes the run and its nodes. A separate Inngest
function executes them, and it only wakes on `deliberation/run.start`. Omitting
that event does not fail — it leaves queued nodes and no outcome, which reads
from the outside as "the panel produced nothing" rather than "the panel never
ran". `lib/deliberation/start-run.ts` is the single place that send lives, so
the step cannot be forgotten by omission.

**The verdict is asynchronous.** Reading `DeliberationOutcome` immediately after
orchestrating always returns nothing. The binding waits, bounded (four minutes),
then reports "not drafted" and lets the next pass retry — one slow panel must
not starve the decisions queued behind it, and a partial verdict is never
written.

**Verification that counts.** A green test suite did not catch either defect.
The check is a run row with `completedAt` set and a `DecisionResolutionProposal`
against a real interaction — read from the database on a live install, not from
a fixture.
