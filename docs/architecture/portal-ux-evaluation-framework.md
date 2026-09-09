# Portal page and flow evaluation framework

Revision: 2026-09-06. Documentation delivery: `BI-D09EE31E`, Workroom
`WC-302E3E59`. This is the evaluation method for the
[portal UX spine](../superpowers/plans/2026-05-26-portal-ux-simplification-spine.md).
It extends the [usability standards](../platform-usability-standards.md), not the
runtime schema. Use the [scorecard](../testing/portal-ux-scorecard-template.md)
for each route, persona, state and task combination.

Operator direction, clarified 2026-09-06: allocate **80% to refactoring and
consolidation, 20% to net-new capability**. This supersedes the earlier 20%
refactoring allowance. The primary work is to collapse the existing spread of
surfaces, repeated representations and unnecessary dependency burden. The
net-new allocation is a ceiling for justified gaps, not a quota to fill.

## 1. Evaluate a job, not a screenshot

Write the contract first: **When [trigger], [persona] needs to [job], so that
[observable outcome].** Name the start location, permission, prerequisites,
work object and completion oracle. A heading, saved record, sent prompt or
completed animation is not proof of the real-world outcome.

The page must lead to an action, decision or justified confidence. An
informational page is valid when it answers a named question with current
evidence; do not invent a primary button to satisfy a count. A returned view
should preserve location, filters and selection and make relevant changes
recognizable without relying on memory or color alone.

Separate four evidence classes in every finding:

- **Observed:** rendered behavior on a named served SHA, fixture and date.
- **Source-verified:** contract or implementation at a named source SHA; no claim
  that it was served or usable.
- **Estimated:** predicted effort or time, with assumptions and range.
- **Proposed:** redesign hypothesis with acceptance evidence still to collect.

The September audit's 367 pages, 205 budgeted routes, 3,048 words on Platform AI
overview and three axe violations on Documents are historical observations from
that packet. They are audit leads, not fresh measurements. Reproduce them before
claiming current defects. An unavailable evaluator produces **unmeasured**, not
zero failures.

## 2. Rubric and decision rules

### Inspect inside every item

Audit the contents of cards, table rows, badges, menus, drawers, forms and
workroom entries as well as the page around them. A compact card can still expose
its implementation: provider/model selection, capability/grant matrices, process
phases, retry state, storage relationships, provenance fields and configuration
switches. Translating these into friendlier words does not establish that the
user needs them. For every field or control ask: **Does this persona need this
information now to act, decide or trust the outcome?**

Classify each item detail as **keep visible**, **summarize**, **disclose on demand**,
**operator-only**, **merge with canonical representation**, or **remove from this
surface**. Name its consumer and purpose. A removal from presentation does not
delete canonical data or required audit evidence. Essential consequences,
permissions, meaningful uncertainty and next steps stay visible. Useful business
references remain available; unauthorized content never reaches the client.

For example, a worker's work item may need its job, due time, blocker and next
action. Its provider, model, orchestration phase, tool grants and retry counters
belong in authorized diagnostics when there is a real diagnostic job. This is a
design example, not a claim that those fields were observed on a particular page.
An accordion full of duplicated internals is only a concealment change; separately
prove that redundant components, projections and dependency paths were converged.

Score each applicable dimension separately: **0** = observed failure of the
anchor; **1** = works only with assistance, avoidable traversal or partial
coverage; **2** = anchor passes for the primary task and adverse state; **3** =
2 plus a returning-user and contrasting archetype/role pass. **U** = unmeasured;
**N/A** requires a written reason. Store evidence for every score. Scores are
ordinal review summaries, not scientific measurements; do not average them into
a platform quality percentage.

| Dimension | Pass anchor (score 2) | Failure evidence to collect |
| --- | --- | --- |
| Outcome orientation | First viewport names the work/object and next action or decision; the task reaches its completion oracle without coaching | Misidentified purpose, decorative metrics, record creation mistaken for outcome |
| Persona and archetype fit | Real permission and one relevant archetype fixture expose the right job first; no remembered schema relationships are needed | Wrong first action, administrator-only dependency, vocabulary the participant cannot explain |
| Progressive disclosure | Orientation and primary action remain visible; secondary information has a named, accessible disclosure trigger; deeper evidence is reachable | Hidden primary verb, default expanded diagnostics, disclosure that loses context |
| Time and distance to action | Recorded path meets the task's predeclared interaction/time target; action is near its motivating object | Detours, scrolling to unrelated footer actions, excessive pointer or keyboard travel |
| Cognitive load | Existing shell budget passes or documented legacy debt improves; competing first-view choices do not increase; participant recognizes location and change | Choice count, misclicks, repeated rereading, unfamiliar status labels |
| Data model leakage | Each item exposes only details needed for the persona's action, decision or trust; unnecessary internal fields and controls are removed, summarized or properly disclosed, even when their labels sound human | Item/field inventory and disposition; raw IDs, enums, schema/provider/phase labels, null strings, unnecessary metadata and configuration |
| Workroom relevance | Page explicitly chooses summary, linked room or no room; work in motion/blocked/decision states follow canonical work identity and evidence | Duplicate tasks, all stored rooms called live, recursive tree dumping, invented room status |
| AI context and trust | Context binds to the work object/room; launch preview identifies scope and next step; required confirmation precedes effect; receipt or safe failure follows | Prompt/tool/provider leakage, incidental navigation starting work, false success, missing receipt |
| Navigation | Canonical home, local state and contextual command each serve distinct intents; destination and return path preserve object context | Duplicate nav layers, feature in global rail, label/destination mismatch, shellless dead end |
| Empty/loading/failure/permission | Each applicable state has one valid next step or honest explanation; loading is distinguishable from empty; failure retains recoverable work | Zero dashboard, infinite spinner, lost input, dead CTA, unauthorized action or data |

**Release blockers override scores:** unauthorized data/action; hidden prompts or
secret/raw tool payload exposure; consequential AI effect without required
confirmation; false success or contradictory authoritative state; unreachable
primary task; keyboard trap or overlap that prevents the task. Any applicable
unmeasured blocker leaves the verdict **inconclusive**. A confirmed accessibility
failure must be repaired or explicitly carried as scoped pre-existing debt under
the repository's gate rules; a high rubric score cannot waive it.

Use the existing fit verdicts: `fits`, `fits-with-guardrails`, `defer`, `reject`.
`fits-with-guardrails` is design acceptance after named edits, not a runtime pass.
The target is score 2 or better on all applicable dimensions, with no unmeasured
acceptance scenario. Score 3 is evidence of broader robustness, not a prerequisite
for every small PR. Report the score vector, blocker list and evidence coverage.

## 3. Measurement protocol

Freeze the start route, persona permissions, archetype/configuration, data volume,
locale, theme, viewport, zoom, input method, source SHA and served SHA. Capture
arrival after content has settled with disclosures at their actual default;
capture loading separately. A timeout or partial load is a state finding, never
a low word-count win. Record responsive drawer state and whether a dialog is open.

Use 1440x900 and 390x844 CSS pixels at 100% as the initial comparison pair;
also check 320 CSS-pixel reflow, 200% zoom, keyboard focus and relevant screen
reader announcements. These viewport choices are DPF sampling conventions, not
universal usability thresholds. Use the same fixture and geometry before/after.

| Measure | Reproducible definition | Acceptance use |
| --- | --- | --- |
| First-viewport purpose clarity | After five seconds of the settled viewport, ask the participant to identify the job/object, what needs attention and the next step; record correct answers out of 3 and the actual words | Provisional pilot target 3/3 without coaching; expert inspection is marked estimated, not user-tested |
| Default visible words | Run canonical `auditUxBudget` measurement with collapsed disclosure excluded; retain its measurement scope and tool version. Separately count viewport-only words; never compare that subset with a full-default baseline | Use `budgets.ts` and committed route baseline; do not duplicate thresholds here |
| Visible choices | Count enabled links, buttons, selectable options and disclosure triggers actually visible in the viewport, partitioned into shell and task content; repeated links count as separate affordances. Record disabled controls separately | Compare like-for-like; justify increases by the task. This is distinct from canonical `maxChoicesPerControl` |
| Primary action distance | Record above-fold yes/no, scroll pixels from arrival, click/tap count, route changes, and focus stops from main content. Pointer travel is the sum of straight-line distances between successive target centers in CSS pixels, with the starting point recorded | First useful action/decision visible on action homes; minimize unnecessary travel while retaining required review and confirmation |
| Navigation layers | Count simultaneously visible sets of navigation choices: rail, section nav, local tabs. Record breadcrumbs as orientation and filters as data selection separately; note duplicated intent regardless of count | No duplicate intent; normally global + section and at most one necessary local layer, with any additional layer justified |
| Internal leakage | Inventory fields and controls within every sampled item; count unnecessary details, affected items and total items inspected, plus raw ID/enum occurrences. Record their visible/disclosed/operator-only scope and disposition | Zero unnecessary internal detail in normal-work defaults; human wording does not excuse irrelevant content |
| Redundancy and dependencies | Count duplicate representations/components and external tools, services, packages or manual handoffs required for the named job. Record before/after consumers, canonical replacement and retained dependency rationale | Prove retired duplication and reduced setup/failure burden without losing the task; a hidden card or transitive package-count reduction alone is not a consolidation outcome |
| Time to action/outcome | Observe seconds from settled arrival to first useful action, and separately to completion oracle. Record wall-clock load/provider wait separately. For estimates, list read/decision/interaction/wait assumptions and a range | Compare observed medians and ranges at the same task; never call estimated savings realized savings |
| Workroom relevance | Classify no room / summary / linked active room / detail; record parent-child path, unresolved decisions, evidence freshness, and return behavior | Show the depth needed for this job; opening a room is success only for a find/open task |
| AI trust | Trace trigger -> preview/context -> confirmation -> work state -> result/receipt; test provider failure and retry | Navigation never starts AI work; match current confirmation contract; retries do not duplicate the promised effect |
| State quality | Test populated, fresh, loading, failure, permission-limited and not-applicable where relevant; record next step and resulting destination | No dead actions; no silent stale/partial data; absence and failure remain distinct |
| Mobile/accessibility | Record overlap/overflow, keyboard completion, focus after disclosure/dialog, names/labels, status announcements, contrast/theme and axe findings | Manual checks plus automation; zero axe findings alone does not establish accessibility |

For a pilot, use three representative participants per primary persona where
available, include a returning-user attempt, and retain individual results.
This is formative testing, not a statistically representative study. Alternate
before/after order to limit learning effects. Freeze task targets before testing;
do not lower them to fit a favored layout. When participants are unavailable,
complete deterministic checks and mark human comprehension/time evidence pending.

## 4. Workroom-centered disclosure

Keep the canonical work object and room identity. Reuse
`apps/web/components/workspace/workroom/`, the case route, workroom liveness
classifier and purpose contracts. No parallel work hierarchy, generic chat home,
or client-side re-derivation of authoritative status is introduced by this method.

| Depth | What the user sees | Transition and boundary |
| --- | --- | --- |
| Workspace or domain home | What needs me now, blocked commitments, work in motion, next decision and meaningful recent change | Relevant summary links to the existing work object/room; no full transcript or tree |
| Parent workroom | Outcome, accountable participants, current state/freshness, human decision, next step, concise child exceptions | Show child rooms only when they explain a dependency, exception or requested detail; summarize routine activity |
| Child workroom | Its bounded contribution, blocker, owner/coworker, expected next step and recent receipt | Keep parent context and return path; do not duplicate the parent's task or approval |
| Evidence detail | Source, timestamp, result and decision rationale | Authorized operator can expand diagnostics; normal users see meaningful receipts rather than prompts/provider errors |

Do not recursively open every child. Aggregate by canonical identity, preserve
partial/stale states, and explain which child blocks the parent. A parent must not
claim complete while a required child outcome is pending. Permissions are enforced
at the server/read boundary before counts, summaries or evidence reach the client;
collapsing unauthorized detail is not access control.

AI states should answer human questions: working on what, waiting for whom,
what can I do, and what changed. Do not relabel uncertain state as healthy.
Use a safe explanation plus retry/escalation on failure; put technical detail
behind authorized diagnostics. Preview includes the room/object, intended action,
affected scope, expected next step and consequence. Keep explicit confirmation
for coworker launches under the existing fit contract, and always for consequential
effects; this framework does not weaken that requirement. Receipt links to the
same work and states success, partial result or failure honestly.

### Archetype sentinels without IA forks

Use existing workspace-home profiles/registry to change priority, terminology and
default filters, while canonical routes, permissions and work identity stay shared.
These are proposed acceptance tasks, not assertions that every workflow is built.

| Persona / sentinel | Job and first content | Detail deferred |
| --- | --- | --- |
| Rescue director (current install archetype) | Identify an intake/foster commitment needing a decision, open its work and see the next accountable step | Funding/provider/capability configuration unrelated to that decision |
| Dispatcher in a service archetype | Find an unscheduled job, inspect capacity, assign through the owning workflow and receive a receipt | Full process graph and historical orchestration |
| Worker or volunteer | Open assigned work, understand next action and record completion within actual permission | Organization-wide management and AI governance |
| Platform operator | Explain blocked coworker work or a count discrepancy and reach source evidence | Raw diagnostics until the operator asks for them |
| External customer/applicant | Submit a request or inspect their own status and understand what happens next | Internal management, other customers, workroom internals |

If a sentinel lacks an implemented completion path, record the missing capability
and use an existing supported task for the UX baseline; do not mock success or
silently expand a layout slice into a new workflow implementation.

## 5. Standing UX design-and-fit gate

Apply before accepting routes, tabs, cards, dashboards, launchers, settings fields
or page primitives. Use `dpf-ux-fit-review`; this is its evidence method, not a
competing skill. The navigation principles live in the spine.

1. **Design entry:** attach a purpose contract, primary task, canonical home,
   permission/archetype fixture, navigation intent, state matrix, source truth,
   AI boundary and baseline scorecard. Reject a second home without a distinct
   user job. Compare an existing filtered view, contextual action and disclosure
   before proposing a new route or primitive.
2. **Design fit:** identify reused primitives and duplication to retire. Use WWMD
   for open platform-direction choices. Record `fits`, `fits-with-guardrails`,
   `defer` or `reject`, reviewer, required edits and evidence. An unresolved data
   seam or missing task outcome defers implementation of that surface.
3. **Implementation entry:** one BI, governed branch and PR-sized scope; current
   initiative readiness and immutable coverage receipts remain mandatory where
   applicable. Allocate 80% of effort to refactoring/consolidation and at most
   20% to justified net-new capability. Name what is merged, retired or removed,
   including unnecessary per-item detail and external dependency paths.
4. **Before merge:** existing source gates and UX-fit manifest plus measured
   before/after scorecard, browser task, failure/permission check, mobile and
   manual accessibility evidence. A valid `propose-n-pick` manifest records a
   design choice; it is not evidence that the served task passed.
5. **After delivery:** record served SHA and completion oracle in the Workroom.
   Reconcile accepted outcomes and failures before closing the implementation BI.

Today, `lib/ux-budget/`, route-purpose contracts and
`scripts/check-ux-fit-decision.mjs` provide code-backed checks for their defined
axes. Human comprehension, whole-flow completion and manual accessibility remain
explicit review evidence. This documentation revision does **not** implement new
automatic enforcement. Any later automation extends those existing contracts
under a scoped BI; it must fail visibly when it cannot measure.

### Every-PR review and convergence of existing UX

Every PR receives a UX-impact disposition against this framework, including
backend, schema, dependency, prompt and workflow changes that can alter what a
person sees or can accomplish. A concrete source-backed no-impact reason takes
the lightweight path; it does not require booting a portal for an unrelated
documentation change. Unknown impact requires investigation, not an automatic
N/A. The same criteria govern new designs and refactoring of existing surfaces.

For affected UX, map the change to the ten criteria above and link the relevant
scorecard evidence. Identify affected routes, shared-component consumers, personas,
archetypes, default item details and external dependency handoffs. Use the existing
navigation model and source graph to select coverage, with source/graph/served
versions recorded; a graph is not evidence of rendered task success. Render
representative primary and adverse states, expand coverage when a shared failure
is found, and retain the existing broad route-sweep checks where applicable.

The PR review distinguishes three outcomes:

- New or worsened violations: correct them before acceptance. Missing required
  evidence remains unmeasured or inconclusive, never a pass.
- Existing debt touched by the change: record before/after harm and retire the
  relevant duplication or unnecessary detail within the bounded slice. If it
  cannot fit safely, link its existing BI, accountable owner and review trigger.
- Unrelated existing debt: retain its evidence and backlog linkage without
  misattributing it to this PR or expanding every PR into a portal rewrite.

An unchanged baseline is not proof of good design. Refactoring slices declare
which criteria they will improve and prove the improvement while preserving task
outcomes and permissions. Do not silently rebaseline regressions. Track the
80% refactoring / at most 20% justified net-new allocation across the program;
individual PRs remain cohesive and need not artificially mix both work types.

The author supplies impact and evidence; the PR reviewer records the criterion
verdict and remaining debt. Re-evaluate affected evidence after material changes
to the reviewed diff, and reconcile delivered results to the served version.
Emit one maintained review result per PR rather than repeated audit commentary.
Broader release review samples untouched families to detect drift beyond changed
routes. Navigation changes update the canonical source and existing projection
pipeline, not a separately maintained audit graph.

This is the required ongoing review contract. Automated all-PR classification,
evidence validation and review publication must extend the existing PR/UX gates
under governed implementation coverage. They are not activated by this document
and must operate independently of a particular desktop task or AI client.

### September 8 delivery reconciliation

Recent merged work already delivers parts of this direction. The following is
PR/source evidence reviewed on 2026-09-08, not a new live-install verification.

| Merged change | Criteria advanced | Remaining acceptance work |
| --- | --- | --- |
| [#5207](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5207), distinct navigation labels with a uniqueness test | Navigation, cognitive load | Renaming did not consolidate the three directories. The PR reports 3,439 arrival words on coworker identity; unchanged is not acceptable design merely because the ratchet passes. |
| [#5208](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5208), one Work rail entry and corrected Delivery cross-link | Canonical home, time to action | Verify affected personas and return paths on the served version. The PR measured the shared rail cost and limited baseline changes to attributed effects. |
| [#5198](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5198) and [#5203](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5203), portfolio activity and repaired disclosure at scale | Disclosure, state truth, workroom relevance | The latter PR reports a residual inventory table contributing about 844 words at a 200-room read. Review whether tree and table serve distinct tasks; consolidate redundant default content. |
| [#5212](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5212), architecture Workrooms leads with actual rooms | Outcome orientation, state quality, model leakage | Preserve the distinction between actual work and team definitions. Do not add plan-creation capability merely to fill a zero card. |
| [#5204](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5204), canonical room addressing and CI guard | Navigation, meaningful task completion | Reuse this guard; its documented baseline retains four legacy link candidates requiring individual verification. |

The existing UX-fit script detects new routes, controls and visible copy in TSX
diffs and validates changed manifests against route budgets. That is useful
enforcement, but it does not establish the full every-PR impact assessment above:
indirect read-model, permission, prompt, workflow and dependency changes can alter
UX without matching those additions. Its option-decision evidence also does not
prove task completion. Extend this contract and its shared sensitivity logic;
do not create another scanner or claim that a PR-description assertion is proof.

Delivery sequence:

1. Publish this framework and scorecard as documentation, reconciled with the
   merged work above. Keep historical observations and their versions intact.
2. Under governed implementation coverage, extend existing impact/manifest and
   review machinery to require every-PR classification, affected-criterion
   evidence, and explicit regression versus legacy-debt disposition. Exercise
   positive and negative fixtures, including a backend-only UX change, unrelated
   docs, shared-component consumers, and stale/missing evidence.
3. Apply the extended review to a bounded consolidation slice: the Work page's
   tree/inventory overlap is the first candidate; coworker directory duplication
   follows its existing BI-2DBC4D2D scope. Re-measure current served behavior before
   choosing the final slice, then prove reduced default detail with preserved
   room discovery, selection, direct links and permissions at ordinary and large
   data volumes.

Completion means the documentation is merged, the review executes on PRs with
traceable evidence, and a refactoring PR demonstrates criterion improvement.
This reconciliation does not claim those outstanding outcomes are delivered.

## 6. Architecture decision and research

The subsequent operator-directed 80/20 allocation is authoritative for this
revision; the WWMD result below establishes contract reuse, not the effort ratio.

### Consolidation and dependency review

Start each slice with an inventory of competing route homes, cards, components,
read projections, helpers and external dependencies serving the same user job.
Choose the existing canonical implementation, migrate its consumers and retire
redundancy. Track planned and actual effort by refactoring versus net new, not
by lines of code: replacement code can be refactoring when it preserves the job
and removes a competing implementation. A new drawer is not itself consolidation.

For each external dependency record the job it enables, callers/data flows,
setup and credentials the user must manage, operational failure modes, and the
existing platform capability that could absorb its role. Decide retain,
consolidate, replace or retire with evidence. Preserve integrations that provide
necessary external data or execution. Do not rebuild a mature external service
merely to lower the dependency count. Implementation requires consumer mapping,
compatibility/data migration where applicable, failure-path checks and rollback;
this planning revision does not disconnect services or uninstall packages.

Net-new work must demonstrate that reuse, consolidation or refactoring cannot
deliver the accepted outcome. Prefer a smaller addition that closes that gap;
record what existing surface or dependency it replaces, or why no replacement
is possible. Measure success as fewer concepts, duplicate representations,
unnecessary item details and dependency failure points while preserving outcomes.

WWMD `DI-BED2443DAD54` selected `extend-purpose-contracts`, composite 8.422,
margin 4.687, high confidence, usable and autonomy-eligible, no blockers or
commandment conflict. Alternatives were a dedicated UX service and a manual-only
checklist. Largest positive contributions: Research and Use Standards (+0.783),
Ground New Work In Existing Platform (+0.697), Architecture Over Shortcuts
(+0.667). These are MCDA contributions from estimated design attributes, not
usability measurements. Preserve the existing single-source architecture.

Source inspection at `4dcd2bc75ed6bd6ee4fcf05d96abb0ca7ed89fc3` found existing
page-purpose intent/findability/state/task protocols, route budget ratchets,
workroom inventory/definition contracts, workspace-home profiles and report-kit
disclosure/empty-state primitives. Extend these; do not copy thresholds or add an
independent route inventory. The July holistic UX design is historical context;
its claims about then-missing tokens and gates are not current source truth.

Research checked 2026-09-06:

| Primary source | Adopt for this framework | Limit |
| --- | --- | --- |
| [GOV.UK Design System patterns](https://design-system.service.gov.uk/patterns/) | Reuse task patterns such as completing tasks, checking answers and confirmation pages | Do not impose a linear form flow on every operational workspace |
| [Carbon notification guidance](https://carbondesignsystem.com/components/notification/usage/) | Match notification placement and disruption to context and urgency | Do not turn every background coworker event into an interrupting alert |
| [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/) | Check keyboard, reflow, visible/unobscured focus, labels, status messages and target size | Automated counts do not prove conformance; 2.5.8 addresses target size/spacing with exceptions, not a blanket font-size rule |

These open design-system comparisons inform pattern choices; they do not justify
adding dependencies. DPF's five-second clarity probe, sampling sizes and travel
measures are provisional evaluation conventions to calibrate, not WCAG rules.
