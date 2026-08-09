# Decision Governance Surface — reframe /wiki around WWMD / WWWD / WSID and close the review-and-adjust loop

- **Epic:** EP-DECISION-GOV-SURFACE (new)
- **Date:** 2026-07-04
- **Status:** Design (design-first — no production code this pass; operator reacts to direction before build)
- **Scope decision:** routed through `principle_decide` (`callingPopulation=external_coding_agent`) →
  **design-first** wins, composite 9.42, margin 0.745, **high confidence**, no commandment conflict,
  strong structured coverage. Strongest contributors: *Never Assume — Verify*, *Never Fabricate*.
- **Governing kernel principle:** [`decisions-belong-to-their-scope`](../../founder-kernel/wiki/principles/decisions-belong-to-their-scope.md) (subsidiarity of WWMD/WWWD/WSID)
- **UX-Fit:** this is a top-level IA change + new admin/review surfaces → binds the UX-Fit gate (§12). Progressive disclosure is the design spine; the matrix/ledger internals stay behind drill-in.

---

## 1. Problem

The platform's most important capability — a governed decision system where the AI workforce
resolves open questions against **WWMD** (founder/platform doctrine), **WWWD** (the organization's
own business doctrine), and **WSID** (each role's professional craft) — is surfaced today as a
document repository called **"Wiki"**, organized by *librarian taxonomy*:

> PRINCIPLES · 157 · STANCES · 7 · HEURISTICS · 33 · ENTITIES · 37 · SUMMARIES · 34 · INDICES · 1

That taxonomy is the **raw material** an engine consumes, not the thing a business owner reasons
about. Concretely, five gaps:

1. **The three disciplines are invisible.** `/wiki` ([apps/web/app/(shell)/wiki/page.tsx](../../../apps/web/app/(shell)/wiki/page.tsx))
   groups `WikiPage` rows by `pageKind`. WWMD/WWWD/WSID appear nowhere on the landing page.
   The only pointer is a footnote card — **"Decision Perspectives · Configure voice narration for
   WWMD / WWTD persona profiles"** — which frames the entire decision system as an *audio setting*.
2. **No "see how it works" surface for a business.** A customer org cannot see, in one place, what
   WWWD governs, what WSID governs its coworkers with, what has actually been decided, or where
   coverage is thin. The end-to-end walk exists only as prose
   ([decision-perspective-in-practice.md](../../user-guide/ai-workforce/decision-perspective-in-practice.md)).
3. **No adjust surface.** There is **no end-user UI to author or adjust the WWWD stance or extend a
   WSID corpus.** Material flows in only through the wiki ingest pipeline and
   `EscalationCapture`→candidate-material promotion. `/wiki/perspectives` is a *voice* admin index.
4. **The review/adjust loop is scattered and disconnected.** The decision outputs — the
   `DecisionInteraction` ledger, the founder/owner review queue, golden-decision flip detection —
   live under `/platform/ai/…`, on the opposite side of the portal from the material that drives
   them. Nothing ties *"decisions are accumulating under a posture"* → *"here is where the matrix
   or principles need additions, de-confliction, or analysis."* This is exactly the operator's
   second concern.
5. **The "Wiki" title actively hides the capability** behind a passive documentation metaphor. A
   business owner who wants to see or shape *how their AI decides* would never click "Wiki."

**Operator framing (verbatim goal):** *"the wiki organization is not aligned with easily seeing how
WWMD, WWWD and WSID at all … as real companies use this, they will want to adjust and see how WWWD
and WSID is used and works … over time as decisions are made based on the proactivity setting, we
need to review and adjust things. the matrix … may need additions or adjustment, the principles or
other criteria may need to be re-visited, de-conflicted, or analyzed … the WIKI page title and the
use of this detail seems disconnected from usage and visibility for the business that will use this."*

### 1.1 One terminology reconciliation the operator's framing surfaces

The operator says *"as decisions are made based on the **proactivity** setting."* In the current
code, two distinct dials exist and this design must not conflate them:

- **Proactivity** (`quiet | balanced | assertive`,
  [proactivity-resolver.ts](../../../apps/web/lib/proactivity/proactivity-resolver.ts)) = the
  *notification / in-task-initiative* dial. As of `feat/proactivity-initiative` it also shapes how
  hard a coworker works to close a gap in-turn, but it does **not** authorize autonomous action.
- **Autonomy** (`shadow → propose → supervised → autopilot`,
  [trust-graduation.ts](../../../apps/web/lib/autonomy/trust-graduation.ts)) = the dial that governs
  whether the AI *decides and acts on its own*. Its review substrate is `DecisionShadowLedger` +
  `TrustState` (measured agreement between what the AI *would* do and what a human *did*).

The operator's intent — *"as the AI makes more of its own calls, we need a place to review and
adjust the governance"* — is precisely right, and maps to the **autonomy** posture (with proactivity
shown alongside as context). The redesign surfaces **both posture dials** on the Decision Review
workspace and adopts one plain-language label, **"Posture,"** for the pair so a layman never has to
learn the internal distinction. This is a deliberate correction folded into the design, not a
blocker.

---

## 2. Design goal

Reframe the top-level surface from a **document repository ("Wiki")** into a business-legible
**Decision Governance** center, organized around the **three decision disciplines**, that lets a
business:

1. **See** how WWMD / WWWD / WSID work *for them* — what each governs, its health, and worked examples.
2. **Adjust** the two disciplines a business owns — the **WWWD** business stance and each role's
   **WSID** craft overlay — through a real authoring surface, without touching the platform baseline.
3. **Review and adjust over time** — a Decision Review workspace that turns the accumulating
   `DecisionInteraction` ledger (and the posture it was decided under) into concrete governance
   actions: **de-conflict** clashing principles, **add** missing criteria, **retire** stale material,
   and catch when a corpus change **flipped a canonical decision**.

The raw kernel material (today's Principles/Stances/Heuristics browser) is **not deleted** — it
becomes the **evidence / drill-in layer** beneath each discipline, reachable but no longer the front door.

### 2.1 Non-goals

- No change to the decision *engine* (`option-scoring.ts` `decide()`), the gate outcome semantics
  (`recommend | arbitrate | escalate | defer`), or the confidence model. This is a **surfacing +
  authoring** redesign, not a re-architecture of the kernel.
- No new decision-record model — the `DecisionInteraction` / `DecisionShadowLedger` / `TrustState`
  ledger is reused as-is. Authoring writes through the existing overlay `WikiPage` +
  `PerspectiveMaterial` substrate (org-overridability pattern), never a parallel table.
- Voice narration is retained exactly as-is; it moves from *the headline* to a per-profile option.

---

## 3. Research & Benchmarking (§10)

How comparable governance / policy / decision-audit products organize the *see → adjust → review*
loop, and what we adopt vs reject.

| Product / pattern | What they do well | Adopted | Rejected / anti-pattern |
|---|---|---|---|
| **OPA / Styra DAS** (policy-as-code decision logs) | Every policy decision is logged with the input, the matched rule, and the result; a "Decisions" explorer filters by outcome and lets you replay. | The **decision-explorer-as-first-class-surface** pattern (our `DecisionInteraction` ledger becomes a primary view, not an admin afterthought). | Raw Rego/JSON as the *primary* UX — too low-level for a business owner. We keep it as drill-in evidence. |
| **AWS IAM Access Analyzer / policy findings** | Turns a large rule corpus into a small list of *findings* ("this grants broader access than intended") with a one-click remediation. | The **findings-not-a-firehose** pattern for the Decision Review workspace: surface *conflicts / drift / chronic-defer clusters*, each with an action — not 157 principles to read. | Per-rule dashboards nobody opens. |
| **Notion / Confluence** (what "Wiki" evokes) | Free-form doc trees, good for reference. | Nothing — this is the metaphor we are moving *away* from. | **Organizing a decision system by document type.** This is the exact defect we are fixing. |
| **Retool / internal admin builders** | Progressive disclosure: 3–5 fields up front, advanced behind a toggle. | The WWWD stance editor and WSID corpus editor follow progressive disclosure (§12): a plain "how we decide this" statement first, dimension weights / evidence grades behind "Advanced." | Exposing the full `principleDimensionVector` to a layman (the #2004 raw-token-input anti-pattern). |
| **GitHub CODEOWNERS / branch protection review** | Subsidiarity made visible — *this* scope owns *this* decision; escalation has a clear owner. | The **owner-per-scope** framing: WWMD → founder review; WWWD → owner/operator review; WSID → role lead. Already latent in `founder-review/queue.ts` (`wwmd` vs `wwwd` modes). | Flat "admin approves everything" — erases the subsidiarity the kernel principle mandates. |
| **Data-catalog lineage views** (e.g. dbt docs) | "What feeds this?" backlinks from an output to its sources. | The existing `MaterialBacklinksPanel` (which materials/sources drove an outcome) is promoted into the per-decision view of the new surface. | — |

**Gap the design fills that none of the above cover:** binding the *three-scope subsidiarity*
(WWMD/WWWD/WSID) to a single business-facing *see → adjust → review* loop, where the review step is
driven by **the AI's own accumulating decisions under a measured autonomy posture**. Policy-as-code
tools have the log but not the subsidiarity or the "shape the doctrine" authoring; wikis have the
authoring but no decision loop.

---

## 4. Information architecture

### 4.1 Rename / reframe the top-level surface

- **Route:** keep `/wiki` working as a redirect alias, with the canonical surface under
  `/coworker-decisions`. Working title **"Decision Governance"** (nav label candidates, to be
  confirmed with the operator: *"How Your AI Decides"*, *"Decision Center"*). The nav entry
  ([portal-navigation-model.ts:845](../../../apps/web/lib/navigation/portal-navigation-model.ts))
  changes from *"Founder kernel and per-org overlay — stances, heuristics, decisions"* to a
  usage-framed description.
- **Landing = the three disciplines as first-class cards**, not `pageKind` sections. Each card:

  | Discipline | Plain-language subtitle | Health shown | Primary actions |
  |---|---|---|---|
  | **WWMD** — Platform doctrine | "How the platform itself decides how to build." | # commandments/core, last-changed | See how it works · Review platform decisions |
  | **WWWD** — Your business | "How *your business* decides — funding, priorities, customer calls." | coverage (has-own-profile vs inheriting platform), # open owner reviews | **See · Adjust · Review** |
  | **WSID** — Each role's craft | "What a competent professional in each role should do." | # role families covered, corpus freshness | See · Adjust (per role) · Review |

  Health is derived, never hand-entered: coverage from `PerspectiveMaterial` counts, confidence from
  the ledger, open-gap counts from `EscalationCapture`/`DeferralCapture`.

### 4.2 Per-discipline drill-in (three parallel views)

Each discipline resolves to a detail view with three tabs:

- **See how it works** — the inheritance chain (WSID → WWWD → platform-advisory → defer), what
  materials govern, and a worked example (reuse `decision-perspective-in-practice.md` content,
  rendered). Read-only, layman-safe.
- **Adjust** — the authoring surface (the confirmed gap):
  - *WWWD:* a **business-stance editor** — "How do we decide X?" statements written as overlay
    `WikiPage` `stance`/`principle` rows scoped to the org, promoted to `PerspectiveMaterial`. Plain
    text first; dimension weights / evidence grade behind **Advanced**.
  - *WSID:* a per-role **corpus view + extend** — see the seeded professional baseline, add an
    org-local override page (org-overridability pattern) without mutating the platform seed.
  - *WWMD:* read-only for a customer install (platform doctrine is advisory-only to a business);
    editable only in the founder/platform instance.
- **Review decisions** — the `DecisionInteraction` ledger *scoped to this discipline*, plus the
  owner-appropriate review queue (`founder-review` for WWMD, `owner/operator review` for WWWD, role
  lead for WSID) and golden-decision flip alerts for this scope.

### 4.3 The Decision Review workspace (the operator's second concern)

A dedicated **"Review & Adjust"** workspace that closes the loop from *decisions accumulating* to
*governance actions*. It is a **findings** surface (not a log firehose), each finding carrying a
one-click action:

| Finding class | Source signal | Action offered |
|---|---|---|
| **Conflict** — two principles/materials pull opposite ways | `DecisionInteraction.principleConflict` = true; `option-scoring` commandment-conflict flag; `principle-lint-detectors` opposing-direction pairs | **De-conflict**: adjust weight, scope one narrower, or retire one |
| **Drift** — a corpus change flipped a canonical decision | golden-decision flip detection ([golden-decisions.ts](../../../apps/web/lib/decision/golden-decisions.ts) backtest) | Review the flip; accept (rebaseline) or revert the material change |
| **Gap** — chronic low confidence / defer cluster on a question domain | `DeferralCapture` clusters; confidence-after trending low | **Add** a stance/principle to cover it (opens the Adjust editor pre-scoped) |
| **Staleness** — material past freshness horizon that still drives decisions | `PerspectiveMaterial` freshness + still-cited-in-ledger | **Refresh or retire** |
| **The matrix** — the decision-weighting table itself needs additions/adjustment | `PRINCIPLE_DIMENSIONS` × tier-weight (commandment 1.0 / core 0.4 / contextual 0.1) made visible | View the matrix; add a dimension / adjust a tier weight (governed, HITL) |

Every finding row shows the **posture context** — the proactivity + autonomy posture the relevant
decisions were made under — so an operator can see *"escalations are rising on WWWD funding calls
while this coworker is at supervised autonomy"* and act. This is where "review and adjust as
decisions are made based on the [posture] setting" lives.

### 4.4 What happens to the current pages

- `WikiPageList` (the `pageKind` browser) is **retained** as the **"Governing material"** drill-in
  beneath each discipline and behind an admin/advanced entry — not deleted, not the front door.
- `/wiki/perspectives` **voice** admin becomes a per-profile option inside the discipline detail
  ("Give this perspective a voice"), losing its role as the sole "Decision Perspectives" entry point.
- `/platform/ai/decisions/[id]` (Decision Canvas), `/platform/ai/founder-review`, and the
  Operations-Map decision-pressure overlays are **linked into** the new surface rather than
  re-implemented; the Review & Adjust workspace is the new front door to them.

---

## 5. Data model

**No new decision-record models.** The redesign is additive on the surfacing/authoring side and
reuses:

- `WikiPage` (overlay rows, `organizationId` set) for authored WWWD/WSID material — the
  org-overridability pattern already in the schema.
- `PerspectiveMaterial` + `DecisionPerspectiveProfile` / `…Version` for the decision-bearing corpus.
- `DecisionInteraction` (+ `EscalationCapture` / `DeferralCapture`) as the review ledger.
- `DecisionShadowLedger` + `TrustState` for posture-context aggregates.
- `PRINCIPLE_DIMENSIONS` (`packages/db/src/wiki-taxonomy.ts`) as the matrix registry; a dimension
  addition remains a governed schema/registry change, surfaced (read-mostly) by the matrix view.

The only *possible* new persistence is a lightweight **finding dismissal / snooze** record for the
Review workspace (so a de-conflict decision doesn't re-surface) — TBD in the Phase-2 plan; the
default is to reuse `DecisionInteraction.humanOutcome` and capture-promotion state before adding a
table (data-model stewardship §11).

---

## 6. Phasing

Phased so each slice is independently shippable behind the UX-Fit gate; the operator can stop after
any phase.

- **Phase 0** ✅ — this spec + epic + BIs + operator mockup. No code. (PR #2573)
- **Phase 1 — Reframe the landing.** ✅ Three-discipline hub with derived health, nav renamed
  "Wiki" → "Decision governance", raw material retained as a drill-in. (PR #2575)
- **Phase 2 — Decision Review & Adjust workspace.** ✅ **Complete.** (conflict + gap, PR #2575) → completion:
  `staleness` findings (stale-but-cited material) + the read-only decision **matrix** view
  (`/coworker-decisions/matrix`) + **`drift` findings** — the review page re-scores the frozen
  `GOLDEN_SCENARIOS` against the *live* commandment corpus each load (`evaluateGoldenDrift` over
  the same `decide()` engine) and surfaces any canonical decision whose winner **flipped** or whose
  margin fell below its `marginFloor` (a coin-flip), each routed to the matrix to revisit a
  dimension or the aggregate. All Phase-2 sub-slices are now delivered.
- **Phase 3 — WWWD business-stance editor.** ✅ `/coworker-decisions/stance` — a plain-language draft authoring
  form that writes an org-overlay `stance` page (the WWWD corpus the decision-routing block grounds
  business calls in). Closes the confirmed "no adjust UI" gap. Draft by default.
- **Phase 4 — WSID per-role craft view + org override.** ✅ `/coworker-decisions/craft` + `/coworker-decisions/craft/[key]` —
  per-profession view with a draft org-overlay `heuristic` override form. Does **not** depend on the
  WSID pilot-three corpus completion — it authors org overrides on top of whatever baseline exists.
- **Phase 5 — Rename + nav + redirects + docs.** ✅ Canonical route family renamed to
  `/coworker-decisions`; `/wiki` remains as a thin redirect alias for legacy bookmarks and generated
  links; active setup/tool copy now points at the canonical route.

Dependency note (corrected during build): the WWWD/WSID **authoring** surfaces write org-overlay
material and are useful immediately — the org's WWWD answers are grounded in its own org-overlay
WikiPages, retrieved by org. The still-open per-org WWWD Gate *re-scoring* work (BI-E1FB2307 /
BI-EF3F4A2D) governs multi-tenant gate authority, not whether authoring works.

---

## 7. Success criteria

- A non-technical business owner can, from one entry point, answer: *"How does my AI decide? What has
  it decided? Where do I change how it decides?"* — without encountering the words "Wiki,"
  "pageKind," "principle vector," or a tool name.
- The WWWD stance and WSID corpus are **editable** through the portal (not only via ingest).
- Accumulating decisions produce **actionable findings** (conflict / drift / gap / staleness / matrix)
  rather than an unread log, each tied to the posture it occurred under.
- The raw kernel material remains reachable for those who want it, one level down.

---

## 8. Open questions for the operator

1. **Name.** "Decision Governance" vs "How Your AI Decides" vs "Decision Center" — operator-owned
   (branding/naming), surfaced here per consult-then-defer.
2. **Posture terminology.** Confirm collapsing proactivity + autonomy under one plain-language
   "Posture" label on the review surface (§1.1).
3. **Phase-1 stop point.** Is the reframed landing + linked existing surfaces enough to react to
   before committing Phases 2–4?

---

## 9. Addendum (2026-07-28, BI-404E9BEA): plain-language "what do I do about this?" help

Operator finding: the Decision log and its drill-in show `ESCALATE`/`DEFER` rows with an
"awaiting review" chip and a bare link to Review & adjust. A non-technical reader cannot tell what
the outcome *is*, whether anything is blocked while it waits, or what to concretely do — 29 WWMD +
45 WSID unresolved rows read as alarming homework with no instructions. This is a §7 success-criteria
gap on the audit surface itself.

Resolution — a deterministic guidance layer (`apps/web/lib/wiki/decision-help.ts`, pure/unit-tested;
**no inference dependency**, so the help works even when the local model runtime is down):

- **Per-row guidance** (`buildDecisionHelp`): maps outcome type + tier + risk + conflict /
  insufficient-signal flags + build-gate linkage + resolution state to plain language — what the
  outcome means, whether anything is actually waiting (a Build Studio gate blocks; a fire-and-forget
  consult does not), and ordered next steps linking to Review & adjust / stance editor / craft
  corpus. Rendered in the decision drill-in's Human review section for every outcome, including the
  "nothing needed from you" read on recommend/arbitrate rows.
- **Log-header digest** (`buildAwaitingDigest`): rolls the per-tier unresolved counts into one
  headline ("N decisions are waiting on a human") with a progressive-disclosure explainer of
  escalate vs defer, why nothing on the page is silently stuck, and that Review & adjust clusters
  rows into themes answered once — not worked line by line.
- **Contextual Docs**: a `/coworker-decisions` quick-help entry joins the BI-2DD18122 registry so
  Help opened from any decision-governance page answers the five stuck-reader questions.

A follow-up (separate BI) may add an AI-coworker-narrated summary of the unresolved cluster; it
layers on top of — and must never replace — this deterministic floor.

---

## 10. Addendum (2026-08-08, BI-76EEDEE8): findings must carry an achievable outcome

### 10.1 Reproduced failure

`/coworker-decisions/review` rendered seven identical conflict findings with a **De-conflict**
action. The linked Decision Canvas showed no question, no option descriptions, no sources, no
named conflict pair, and no control that could change the decision. Live-state inspection found:

- six findings already had a `humanOutcome`, but the conflict query did not filter them out;
- the remaining row (`DI-8BA5F423591B`) was an unlinked, already-executed
  `mcp:principle_decide` audit record with blank decision context; and
- useful rationale and contributor data existed only inside `outcomePayload`, while the canvas
  projected only the empty `sources` column.

This is a contract failure across detection, lifecycle projection, detail, and disposition. A
different button label would not fix it.

### 10.2 Research and benchmarking

Three open-source-adjacent issue/finding leaders converge on the same workflow shape:

| Leader | Pattern adopted | Pattern rejected |
|---|---|---|
| [GitHub code scanning](https://docs.github.com/en/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/resolve-alerts) | Put evidence, affected context, fix/dismiss choices, dismissal reason, and reopenability in one alert lifecycle. | A warning that links to an audit-only page. |
| [SonarQube issue management](https://docs.sonarsource.com/sonarqube-server/user-guide/issues/managing) | Make status, assignee, why/location, comments, accept/false-positive, and automatic re-detection explicit. | Leaving resolved findings in the open queue or treating “reviewed” as “fixed”. |
| [Sentry issue details](https://docs.sentry.io/product/issues/issue-details/) and [status lifecycle](https://docs.sentry.io/product/issues/states-triage/) | Pair the best available event evidence with assign/resolve/archive actions; regress resolved issues when evidence recurs. | Showing every historical event as current work. |

[WCAG 2.2 SC 3.3.1 and 3.3.3](https://www.w3.org/TR/WCAG22/#input-assistance) provide the
accessibility floor: identify what is wrong in text and provide known correction suggestions. The
same standard applies here even though the “error” is a governance finding rather than a form
field.

### 10.3 Decided approach

WWMD interaction `DI-259D90CF912B` compared a narrow display patch, route-only convergence, and an
end-to-end actionability contract. It recommended **actionability-contract** (composite 7.097,
margin 1.850, high confidence, no commandment conflict). The strongest contributors were Research
and Use Standards and Never Assume — Verify.

### 10.4 Actionability contract

A finding is allowed to enter an operator action queue only when all of the following are true:

1. **Open:** its source lifecycle says it is unresolved and not withdrawn.
2. **Specific:** it identifies the affected decision/object in human-readable text.
3. **Evidenced:** it carries the evidence needed to choose, or names the missing evidence and offers
   a way to supply it.
4. **Owned:** it names the workflow or accountable role that can dispose it.
5. **Executable:** the primary action reaches a control or owning workflow capable of completing
   the named disposition.
6. **Verifiable:** the system can observe the source signal clear or recur after disposition.

If any condition is false, the record remains available in audit history but MUST NOT appear as
open operator work. The UI may show an honest historical-context-unavailable state; it may not
invent missing context or advertise a resolution action.

### 10.5 Decision-review application

- Conflict findings reuse the founder-actionability predicate already shared by Founder Review and
  the coworker-readable open-review tool. Unlinked internal kernel consults are audit records, not
  operator residue.
- The query excludes non-null `humanOutcome`; the pure builder also rejects blank questions as a
  defense in depth.
- The canonical decision detail is `/coworker-decisions/decisions/[interactionId]`, which already
  carries the richer evidence and plain-language next-action projection. Legacy Decision Canvas
  links converge there rather than maintaining two operator-detail dialects.
- A conflict CTA is **Review blocked decision**, not **De-conflict**. The detail page explains whether a
  build is actually waiting and links to the owning workflow. The action never claims a mutation it
  cannot perform.
- Historical sealed decision fields are never rewritten. Lifecycle cleanup appends a human or
  machine-withdrawal outcome with a reason when an owning workflow actually disposes a record.

### 10.6 Process prevention

The shared `GovernanceFinding` read contract distinguishes a navigational detail link from an
executable action. An executable action is valid only as a complete label+destination pair and
must declare its outcome semantics. Contract tests cover missing targets, blank context, resolved
source rows, and recurrence. UX-fit review treats a dead-end action as a failed empty/failure state,
not as a cosmetic issue.

### 10.7 Repeated asks and disposition lifecycle

Follow-up live-state inspection found a second breach of the same contract. The decision ledger
correctly retained multiple consultations, but **Waiting on your call** projected each unresolved
row as separate work. Capturing an answer updated only the selected row, so an older identical row
immediately replaced it and appeared to the operator as though the review had not worked. The
Decision log also counted unresolved work by absence of an escalation capture while Review used
absence of `humanOutcome`, giving two surfaces different meanings of “awaiting review.”

The lifecycle contract is therefore:

- audit occurrences remain append-only and individually inspectable;
- the work queue groups unresolved occurrences by a deterministic identity of profile + decision
  domain + normalized question and shows the represented occurrence count;
- one owner ruling atomically disposes every still-open occurrence with that exact identity, with
  non-representative outcomes linking back to the source interaction that carried the ruling;
- lexical identity is intentionally conservative: wording the system cannot prove identical is
  not silently merged or assigned the same business answer; and
- every queue and count uses non-null `humanOutcome` as the canonical disposition signal.

Existing installs receive a forward data repair under the same exact identity. It carries the most
recent explicit escalation/deferral ruling (preferred over administrative acknowledgement) to an
open historical twin and records `resolvedVia=review-cluster-backfill` plus the source interaction.
It neither deletes the occurrence nor changes its sealed decision evidence.

This preserves audit fidelity while enforcing one cognitive unit per owner decision. Future
semantic clustering may suggest near-matches, but must keep the operator in control of merging
them; similarity alone cannot propagate a business ruling.
