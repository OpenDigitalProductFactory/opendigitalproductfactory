---
status: draft
---

# Decision Concierge — the review queue proposes, the owner rules

Phase 1 (BI-6700AF66) shipped in #4601. Phase 2 (BI-3D0FB84B) shipped in #4611. Phases 3 (BI-19B350FD) and 4 (BI-C62127B9) are implemented on this branch: the panel and the cadence that calls it ship together, because a panel nothing triggers is dead code.
Owner: platform (WWMD)
Epic: EP-0AF96937 (Decision Governance Surface — close the review-and-adjust loop)
Workroom: WC-69329196
Date: 2026-08-23

---

## 1. Problem

The decision ledger, the review workspace and the capture loops all work. What
does not work is the shape of the human's job. Observed on the live install on
2026-08-23, on `DI-453F73458838` ("run hive scout ingest", WWWD, escalate,
medium risk) and on `/coworker-decisions/review`:

1. **The queue is somewhere you have to know about.** The operator reached
   `/coworker-decisions/review` from memory. Unresolved decisions accumulate
   with no force pushing them at anyone, so business calls sit.
2. **The record does not say what it is about.** The page shows
   `agent external-catalog-scout`, a thread id and a token id. It does not say
   which workroom that coworker was working in, what it was trying to
   accomplish, or that the run is part of market-aperture scouting. Without
   that, "Proceed / Decline" is not answerable.
3. **The implications are not stated.** Two bare option ids, no statement of
   what follows from either, no blast radius, no cost, no reversibility. The
   operator is asked to rule with the consequences withheld.
4. **Metadata does not travel.** Following the record's own guidance
   ("Answer it once on Review & adjust") lands on a different page, where the
   operator must re-find the finding, then type an answer into an empty
   textarea. The question, the coworker, the workroom and the options — all
   present one screen earlier — are gone.
5. **The AI does not propose.** Every mechanism to resolve exists
   (`captureOrgBusinessAnswer`, `WeightAdjustmentProposal`, the stance editor,
   escalation capture), and every one of them starts from a blank field. The
   platform staffs finance, legal, HR, security and marketing coworkers, and
   asks none of them what the owner should do.

The through-line: **the platform has built the whole apparatus for the human to
answer, and none of it for the AI to propose.** The owner carries the retrieval
cost, the context cost and the drafting cost of every governance decision.

### 1.1 What "good" looks like

One screen per open decision. It states what happened, who was doing what and
inside which piece of work, what each option costs, what the coworkers who know
that domain recommend, and what the recommendation would change if accepted —
already drafted. The owner reads, then rules: accept, amend, reject. The queue
comes to them on a cadence instead of waiting to be found.

---

## 2. What already exists (fuse, do not build)

Verified against `origin/main` at `8ae58d373b`.

| Need | Existing substrate |
| --- | --- |
| Decision ledger + audit record | `DecisionInteraction`, `EscalationCapture`, `DeferralCapture` (`packages/db/prisma/schema/decision-governance.prisma`) |
| Decision record page | `apps/web/app/(shell)/coworker-decisions/decisions/[interactionId]/page.tsx` |
| Findings workspace | `apps/web/app/(shell)/coworker-decisions/review/page.tsx` + `apps/web/lib/wiki/decision-review-findings.ts` |
| Multi-agent panels | Deliberation Pattern Framework — `apps/web/lib/deliberation/*`, `DeliberationRun`, `DeliberationOutcome` (`mergedRecommendation`, `rationaleSummary`, `confidence`, `unresolvedRisks`, `branchRoster`), seeds in `deliberation/*.deliberation.md` |
| Decision → panel link | `DecisionInteraction.deliberationRunId` — **the column exists and is never written by the escalation path** |
| Panel → room sealing | `apps/web/lib/deliberation/deliberation-room-bridge.server.ts` |
| Rooms with a convening shape | `Workroom` + `apps/web/lib/work-management/room-shapes.ts` (`specialist-alignment`, `craft-stewardship`, …) |
| Specialist rosters | `Agent`, profession families in `docs/professions/registry.json`, `PROFESSION_REGISTRY` |
| Proactive surfacing | Attention surface — `apps/web/lib/attention/*`, source `ai-decision`, rendered by `/workspace/inbox` and `OperatorCockpit` |
| Cadence | `ScheduledAgentTask` (`taskKind`), steward sweeps (`run_mdm_steward_sweep`, `run_data_steward`) |
| Write-through resolutions | `captureOrgBusinessAnswer`, `ruleWeightAdjustmentProposal`, held-material release, stance editor |

Nothing in the list needs replacing. The gaps are four joins nobody has made:
origin context is not resolved, no panel is ever convened for an escalation, a
panel verdict has nowhere to live as a rulable proposal, and the resolution
forms do not accept a pre-filled draft.

---

## 3. Research & Benchmarking

| System | What it does | DPF stance |
| --- | --- | --- |
| ServiceNow Change Advisory Board / approval policies | The change record carries risk, impact and the CI blast radius; approval policy routes to the right group; the approver never leaves the record | **Adopt** the record-carries-its-own-context rule and the routing-by-policy idea. Reject the CAB meeting ritual — our panel is asynchronous. |
| Camunda 8 / Flowable user tasks | Human task = form + variables + candidate groups; DMN tables hold the versioned rules | **Adopt** "the task carries its input variables" (our origin contract) and candidate-group routing (domainClass → profession family). Reject adding a BPMN engine; `Workroom` + `WorkItem` already model the human task. |
| Dependabot / Renovate | The bot does not file a ticket asking a human to upgrade — it opens the diff and the human merges | **Adopt wholesale.** This is the central move: the panel produces the artifact, not a request for one. |
| GitHub suggested changes / CODEOWNERS | Review lands as an accept-in-one-click patch, routed to the people who own that path | **Adopt** one-click accept of a concrete draft, and ownership-derived routing. |
| AutoGen GroupChat, CrewAI hierarchical crews | Multi-agent panels with a manager that assigns specialists and synthesizes | **Reject as a dependency** — our Deliberation Pattern Framework already does branch topology, evidence, claims, consensus and synthesis, with provider diversity and budget caps. Adopt only the role-staffing idea. |
| Constitutional-AI critique-and-revise, LLM-as-judge panels | Independent critics before a verdict; diversity beats a single reviewer | **Adopt** — mapped onto existing roles: specialists assert, a skeptic attacks the recommendation, an adjudicator synthesizes and records dissent. |
| PagerDuty / Opsgenie | Work is pushed on a policy and escalates on age, rather than waiting in a queue | **Adopt** the push + ageing model for governance items; reuse the attention surface and the weekly digest rather than adding notification machinery. |

Standard we conform to: the panel's output is advisory evidence for a human
ruling, consistent with the Trustworthy AI Agent Standards Family framing
already used by EP-1C37C089 — an agent may prepare and recommend a
consequential change; only an accountable human commits it.

---

## 4. Design

Five parts. Each is a join between things that already exist.

### 4.1 The origin contract — a decision knows where it came from

New pure module `apps/web/lib/decision/decision-origin.ts` resolving a
`DecisionOrigin` for any `DecisionInteraction`:

```ts
type DecisionOrigin = {
  workroom: { capsuleId: string; title: string; objective: string; activityKind: string | null } | null;
  coworker: { agentId: string; displayName: string; role: string | null; portfolioSlug: string | null } | null;
  activity: { kind: "build" | "task-run" | "thread" | "mcp-session" | "unknown"; label: string; href: string | null };
  requestedBy: { principalRef: string; label: string } | null;
  recurrence: { priorOccurrences: number; firstSeenAt: Date | null; sameQuestionOpen: number };
};
```

Resolution order, each step evidence-backed and skipped when it yields nothing:

1. `buildId` → `FeatureBuild` → `Workroom.featureBuildId`.
2. `taskRunId` → `Workroom.taskRunId`, and the task run's goal.
3. `outcomePayload.caller.apiTokenId` session ref → `Workroom.executorRef`.
4. `outcomePayload.caller.agentId` → `Agent` (display name, role, portfolio).
5. `outcomePayload.caller.threadId` → `AgentThread` → the turn that triggered it.
6. Recurrence: how many times this same question has already been recorded and
   how many are still open. Exact-question matching only — paraphrase clustering
   belongs to the review page, and a record page that needs embeddings to render
   fails whenever the embedding runtime is down.

**Forward fix (Phase 3):** the gate writes `workroomId` onto
`DecisionInteraction` when the caller context carries one, so future rows do not
depend on the resolver's inference. The column lands WITH its writer, not
before it: a column nothing writes reads as capability and is not. The resolver stays for historic rows either way, and
reports which step it used so the page says "matched through the session token"
rather than implying certainty.

Rendered on the record as a **Where this came from** block above the options:
the workroom (linked), what that room is for, the coworker, what it was doing,
and "this is the 3rd time this has come up; 2 still open".

### 4.2 Consequence framing — what each option actually costs

Options today render as bare ids (`Proceed`, `Decline`). The gate already has
per-option feature vectors on scored rows (`scoredOptions`) and the platform
already has the five cost axes (`blast_radius`, `human_cognitive_load`,
`vendor_lock_in`, `business_disruption`, `operator_effort`).

Each option gets a plain-language consequence line, in this order of authority:

1. The panel's own per-option consequence text (§4.3), when a panel has run.
2. Deterministic projection from `scoredOptions` features + the origin's blast
   radius, when the row was scored.
3. Nothing. **No fabricated consequence.** An unscored, un-paneled option shows
   its description or its id, exactly as today. The
   `insufficientSignal` treatment on this page is the precedent, and it stays.

### 4.3 The triage panel — coworkers who know the domain propose first

New deliberation pattern seed `deliberation/governance-triage.deliberation.md`:

```yaml
slug: governance-triage
name: Governance Triage
purpose: Specialists who own the affected domains recommend what the owner should do, and draft it.
defaultRoles:
  - roleId: domain-specialist   # count 2-3, staffed per domain (see below)
  - roleId: skeptic             # attacks the leading recommendation and names what it costs
  - roleId: adjudicator         # synthesizes, drafts the artifact, records dissent
adjudicationMode: synthesis
strategyProfile: balanced       # high-assurance when riskTier is high/critical
```

**Staffing** (`apps/web/lib/decision/triage-staffing.ts`, pure): map the
decision's `domainClass` + origin portfolio to profession families in
`docs/professions/registry.json`, then to the org's live `Agent` roster. A
money question seats finance; a public-facing one seats marketing and legal; a
people one seats HR; an infrastructure discovery one seats security and the
platform craft. Each specialist branch is grounded in that profession's craft
corpus (WSID) and the org's own stance corpus (WWWD) via the existing retrieval
path — the panel argues from the business's recorded doctrine, not from generic
priors. Where no profession maps, the panel runs with the kernel perspective
alone and **says so** on the card.

**Output contract** — the adjudicator must return, or the run is recorded as
`insufficient-evidence` and no proposal is written:

- `recommendedAction` — one of the resolution kinds in §4.4.
- `draft` — the artifact itself: the stance text, the weight change, the option
  id, or the explicit "no change needed, here is why".
- `consequences` — per option, one line each.
- `dissent` — every specialist who disagreed, and on what.
- `confidence` + `unresolvedRisks` (already in `DeliberationOutcome`).

The run links back through the existing `DecisionInteraction.deliberationRunId`
column, and seals onto the room through the existing bridge.

### 4.4 `DecisionResolutionProposal` — the rulable artifact

A panel verdict has nowhere to live today. `DeliberationOutcome` is a synthesis
record with no lifecycle; `WeightAdjustmentProposal` covers exactly one action
kind; `AgentActionProposal` governs tool execution, not doctrine. One new model:

```prisma
model DecisionResolutionProposal {
  proposalId        String   @id            // DRP-*
  scopeKind         String                  // "interaction" | "gap-cluster"
  interactionId     String?                 // when scopeKind=interaction
  domainClass       String?                 // when scopeKind=gap-cluster
  profileId         String
  actionKind        String                  // see below
  draftPayload      Json                    // shape per actionKind
  summary           String   @db.Text       // what the owner is being asked to accept
  consequences      Json     @default("[]") // [{optionId, text}]
  dissent           Json     @default("[]")
  confidence        Float?
  deliberationRunId String?
  status            String   @default("proposed") // proposed|accepted|amended|rejected|superseded|expired
  ruledByUserId     String?
  ruledAt           DateTime?
  rulingNote        String?  @db.Text
  supersededById    String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

`actionKind` and where accepting it writes through — every one an existing path:

| actionKind | Accept writes through to |
| --- | --- |
| `answer-gap` | `captureOrgBusinessAnswer` (draft WWWD pages, as today) |
| `adopt-option` | `EscalationCapture` + `chosenOptionId` on the interaction |
| `adjust-weight` | `WeightAdjustmentProposal` at `ruled` |
| `amend-stance` | wiki overlay draft against the named page |
| `release-material` | the held-material release path |
| `no-change` | resolves the interaction with a recorded reason |

Rules that do not bend:

- **Nothing auto-applies.** `accepted` is a human act, and for corpus changes it
  still lands as draft, exactly like the current answer-once loop.
- **Amend is first-class.** The owner edits the draft in place and accepts the
  edited text; the amendment is what gets recorded, and the delta between draft
  and accepted text is the training signal for whether the panel is any good.
- **A proposal expires.** If the underlying decision resolves elsewhere, or the
  corpus moves under it, the proposal is `superseded`/`expired`, never silently
  applied later.
- **A rejected proposal does not resurface** for the same cluster without new
  evidence, and the rejection reason is kept — it is doctrine too.

### 4.5 One screen, no context loss

- **The decision record becomes the resolution surface.** Origin block (§4.1),
  options with consequences (§4.2), the panel's recommendation with dissent and
  who was on the panel, and the accept / amend / reject control inline. No
  navigation to rule.
- **`Review & adjust` becomes the queue, not the workbench** — each row states
  the proposal's headline and links into the record. Rows with a ready proposal
  are marked as such and sorted first.
- **Every existing form accepts a seed.** `GapAnswerForm` and the stance editor
  take `defaultValue` from the draft and carry `interactionId`/`domainClass`
  through, so following a link never lands on an empty field. Where no panel has
  run yet, the forms behave exactly as they do now.
- The panel's card names its limits plainly: which coworkers weighed in, which
  domain had no specialist, and how confident the synthesis is.

### 4.6 The standing room and the cadence

A standing `Workroom` — `activityKind: governance`, `decisionScope: wwmd`,
shape `specialist-alignment` — is the home of this process, convened once and
never closed (the pattern BI-A2234157 established for ongoing activity).

A scheduled steward (`ScheduledAgentTask`, `taskKind: decision-concierge-sweep`)
runs on a cadence and:

1. reads the open queue (the same predicates the review page uses — one source),
2. clusters it (existing semantic clustering),
3. convenes a panel per cluster, newest and highest-risk first, under a budget
   cap and a per-sweep panel cap,
4. writes proposals, posts the digest into the room,
5. ages items: an unresolved decision with a ready proposal escalates its
   attention placement rather than sitting flat.

Proactive surfacing reuses what exists: the `ai-decision` attention source gains
`decideEffort: "one-tap"` and an `approve`/`reject` action when a proposal is
ready, so the cockpit and `/workspace/inbox` show the recommendation instead of
"Review evidence"; the weekly digest carries the count and the top proposals; the
Coworker Decision Engine nav entry carries the open count.

### 4.7 Guardrails

- Advisory only; the accountable human rules. Panel authorship is always shown.
- No panel, no proposal — the page degrades to today's behaviour rather than
  inventing a recommendation. Insufficient evidence is a stated outcome.
- Budget: panels are capped per sweep and per decision, and the sweep records
  what it skipped rather than silently truncating.
- The panel reads the corpus; it never writes to it. Only an accepted proposal
  writes, and only through the existing draft-first paths.
- Risk tiering: high/critical decisions get the `high-assurance` profile and
  provider diversity; low-risk ones stay economical.

---

## 5. Data model changes

1. `DecisionResolutionProposal` (new, above).
2. `DecisionInteraction.workroomId String?` + index — forward-recorded origin.
3. No change to `DeliberationRun` / `DeliberationOutcome`; the governance-triage
   pattern is a seed row, not a schema change.

Both changes are additive and nullable. Migration backfills nothing: historic
rows resolve their origin through the read-time resolver.

---

## 6. Phasing

| Phase | Outcome | Ships without the next phase? |
| --- | --- | --- |
| **P1 — Context** | Origin contract, `workroomId` column + gate write, origin block on the record, consequence lines from scored options, seeded forms and carried-through metadata | Yes. Fixes complaints 2, 3 and 4 with no AI involved. |
| **P2 — Proposal substrate** | `DecisionResolutionProposal`, the accept/amend/reject control, write-through adapters, review queue reshaped around proposals | Yes. A human (or a coworker in chat) can file a proposal even before the panel exists. |
| **P3 — The panel** | `governance-triage` pattern, staffing map, output contract, run-on-escalate, panel card on the record | Yes. |
| **P4 — The standing process** | Standing room, sweep steward, attention/digest/nav upgrades, ageing | Yes. |

Phases 1 and 2 are the cognitive-load fix; 3 and 4 are the proactivity fix. The
order matters: a recommendation shown without origin context is worse than none.

---

## 7. Success criteria

- An owner can rule on an open decision without leaving the record, and without
  re-reading anything from a previous screen.
- Every open decision on the live install shows either its origin workroom and
  coworker, or an honest "origin could not be resolved" line — never a bare
  token id.
- For decisions with a ready proposal, time-to-rule is a read plus one click.
- The share of unresolved decisions older than 7 days trends down after P4.
- Amendment rate is recorded from the first accepted proposal — it is the
  measure of whether the panel is worth its cost, and it is reported, not hidden.

---

## 8. Non-goals

- No new notification channel, no new top-level navigation, no second decision
  detail page (the `/platform/ai/decisions/*` redirect stays the only alias).
- No autonomous application of any doctrine change.
- Not a replacement for the WWWD stance-onboarding flow; this closes the loop
  for decisions that have already been asked, not first-time corpus authoring.
- No change to the kernel scoring maths; three-band verdict work
  (2026-08-21-three-band-decision-verdict.md) owns that.

---

## 9. Open questions for the operator

1. Sweep cadence and panel budget: hourly with a small cap, or daily with a
   larger one? Default proposed: every 4 hours, at most 5 panels per sweep.
2. Should a panel run automatically on every escalation, or only for clusters
   that recur? Default proposed: automatic for risk ≥ medium, clustered
   otherwise.
3. Does accepting an `answer-gap` proposal publish the WWWD page directly for
   low-risk domains, or always land as draft? Default proposed: always draft,
   matching the current loop.

---

## 10. Related

- `docs/superpowers/specs/2026-07-04-decision-governance-surface-redesign-design.md` — the surface this extends
- `docs/superpowers/specs/2026-06-23-human-attention-surface-design.md` — the proactive surface reused
- `docs/superpowers/specs/2026-07-17-needs-you-cognitive-load-redesign-design.md` — decision-card contract
- `docs/superpowers/specs/2026-08-21-three-band-decision-verdict.md` — confidence bands
- EP-DECISION-TIER-REBALANCE — weight-proposal lifecycle this reuses
