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

---

## Cross-cutting

- One source for "which decisions are open": the review page, the sweep and the
  attention source share the predicate module. If they can disagree, they will.
- Every surface degrades to the current behaviour when a panel has not run, the
  inference runtime is down, or the origin cannot be resolved.
- Documentation impact per phase: the decision-governance surface docs and the
  operator-facing help copy change with Phase 1 and Phase 4.
