# Owner Workspace Streamlining Design

**Status:** Proposed for governed review

**Date:** 2026-08-28

**Backlog:** `EP-00B120A1` · umbrella `BI-0D18010C` · workroom `WC-AB7E826D`
**Source report:** operator-provided private testing artifact (kept outside the public repository)

## Objective baseline

The testing report counted 41 visible cards or controls where the owner expected
about eight decisions. It identified 23 defects in three surfaces:

- seven attention/inbox defects (`S-01`–`S-07`),
- six decision/compliance dead ends (`D-01`–`D-06`), and
- ten coworker-panel defects (`C-01`–`C-10`).

The target is not an arbitrary card-count reduction. The target is one visible
unit per distinct owner decision, an actionable next step wherever the owner is
asked to intervene, and truthful controls whose visible effect matches the
runtime contract. Human-in-the-loop boundaries and policy controls remain in
force. The report's separate `B-01` Build Studio finding is explicitly referred
to the existing Build Studio initiative and is outside this change.

## Current-main reconciliation

The report was captured against an older install. Current `origin/main` already
contains several complete or partial corrections. This change must preserve
those fixes and close only residual acceptance gaps.

| Finding | Current-main evidence | Design disposition |
| --- | --- | --- |
| `D-01` | PR #4611 persists an owner-editable resolution proposal on a decision record. | Verify and reuse the proposal surface; do not add a second answer store. |
| `D-02` | PR #4154 makes decision findings resolvable and current decision CTAs are real links. | Retain and regression-test the canonical route. |
| `D-03` | PR #4768 routes work held by the digital team out of the owner's inbox. | Treat as delivered; preserve the routing invariant. |
| `D-06` | PR #4601 records decision provenance, evidence, option costs, and unresolved origin state. | Treat as delivered; preserve known-vs-unknown wording. |
| `C-04`/`C-05` | PR #4627 removed several misleading routing and voice-status claims. | Extend the same truthful, owner-readable copy contract to remaining failure paths. |
| `C-09` | The old clipping priority popover has been replaced by the in-flow `CoworkerPriorityDock`. | Add the missing keyboard/one-open-control behavior to the remaining conversation-controls popover. |

Any newly filed child backlog item whose acceptance is already fully met will
be marked duplicate of its canonical item. A duplicate remains in the
traceability table but produces no redundant code.

## Research & Benchmarking

| Leader or standard | Relevant pattern | Adopt | Reject |
| --- | --- | --- | --- |
| [Linear Inbox](https://linear.app/docs/inbox) and [Linear notifications](https://linear.app/docs/notifications) | A single attention inbox supports snooze, read state, filtering, and urgency-based digest delivery. Notification categories are grouped. | Keep one canonical attention projection, expose deferred/handled state consistently, and summarize routine digest material. | A parallel per-page queue or user-configurable grouping model in this slice. |
| [Linear Pulse](https://linear.app/docs/pulse) | Daily or weekly summaries arrive as one inbox update while full detail remains available in the source feed. | Render the Friday digest as one collapsed summary with an explicit reveal. | Expanding every digest entry in the owner's first viewport. |
| [WAI-ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Escape closes a dialog; focus returns to its invoker; a visible close action is recommended. | Make conversation controls Escape-dismissable and prevent simultaneous control layers. | Marking a lightweight popover modal when the rest of the panel is not inert. |
| [OpenAI Data Controls](https://help.openai.com/en/articles/7730893-data-controls-faq) | People can choose whether a conversation creates history or memory; temporary conversation behavior is explicit. | Provide an explicit per-turn context-use control with truthful scope and retention language. | Claiming deletion, training opt-out, or provider guarantees the DPF runtime does not implement. |

## Product contract

### Attention: one unit per owner decision

1. `S-01` — Items sharing the same actionable answer cluster render as one
   owner-decision card with a count and expandable source detail. Grouping is a
   read-model concern derived from stable source identity and action; source
   records are not merged or discarded.
2. `S-02` — Compliance freshness items use the evidence source subject in the
   title. Generic provider-level titles are not emitted when a source name is
   known.
3. `S-03` — The Friday digest rests as one summary row. It reports the number
   and types of updates and expands on request to the canonical entry cards.
4. `S-04` — Reversibility and recommendation chrome appears only when it
   distinguishes the decision: irreversibility is always shown; reversibility
   and a default recommendation are omitted when they merely restate the
   platform default.
5. `S-05` — Header, navigation badge, and rendered sections consume the same
   projection counts: `Needs you`, `Handled`, and `Deferred`. No surface
   recomputes a conflicting total.
6. `S-06` — Repeated escalation writes for the same open source/action key
   increment the canonical occurrence record rather than create another open
   decision.
7. `S-07` — Applying a standing answer returns a visible receipt that says how
   many matching open decisions were cleared. Zero is shown honestly and does
   not claim work was removed.

### Decision and compliance: every request has a real next step

1. `D-01` — A decision record displays the current answer/proposal in place,
   with accept, edit, and reject actions using the existing proposal contract.
2. `D-02` — Review CTAs navigate to the exact resolvable finding or decision;
   no button is decorative and no click depends on an unrelated nested target.
3. `D-03` — Simple view contains only work that needs owner input. Coworker-held
   work remains discoverable outside the owner's queue.
4. `D-04` — An expired or expiring compliance-evidence item offers actions that
   can actually resolve it: open the owning evidence source and renew/replace
   the evidence. A provider settings link alone is insufficient.
5. `D-05` — Coworker remediation controls mutate the canonical coworker
   assignment/configuration or open the exact governing surface. Controls that
   cannot affect runtime behavior are not rendered.
6. `D-06` — Known provenance names the source, actor/coworker, and time. Missing
   provenance is labelled as a named unresolved gap, never invented or silently
   omitted.

### Coworker panel: truthful routing and bounded context

1. `C-01` — Before dispatch, the route contract evaluates sensitivity and
   required capability. The UI discloses the effective route in owner language
   before the message is committed when policy materially changes the route.
2. `C-02` — Every turn has a bounded effort/cost budget. If the limit stops
   work after useful content was produced, the useful partial result is kept
   and the unmet portion is named.
3. `C-03` — Failure copy offers only actions that can change the effective
   constraint; it never recommends a provider or control that policy makes
   ineligible.
4. `C-04` — Internal model, provider, and tool identifiers stay behind a
   technical-details disclosure. Owner-facing copy names the work and remedy.
5. `C-05` — The visible blocker is derived from the classified dispatch
   failure, not from a population-level guess or the last attempted provider.
6. `C-06` — Remediation links to the effective lever: shorten context, change
   sensitivity/context scope, wait for bounded capacity, or open the exact
   routing configuration.
7. `C-07` — The priority surface uses one vocabulary: `Quality`, `Cost`, and
   `Time`, with plain effects and a bounded time expectation where the compiler
   provides one. It does not mix those axes with model-tier jargon by default.
8. `C-08` — Material routing disclosure appears before dispatch rather than
   only after failure. Routine/default routing remains quiet.
9. `C-09` — Conversation controls close on Escape and opening one control closes
   the other. The priority control remains in flow and no popover can clip past
   the coworker panel.
10. `C-10` — The user can narrow or exclude confidential/restricted context for
    a turn. The control changes the request contract sent to routing and states
    its exact scope; it is not cosmetic.

## Architecture

### Canonical contracts to extend

- `lib/attention/owner-projection.ts` remains the single owner-attention read
  model. Clustering and counts belong here, not in `AttentionInbox`.
- Existing attention source adapters remain responsible for source identity and
  resolvable action metadata. Compliance renewal extends the current compliance
  adapter rather than creating a compliance-only queue.
- Existing `PlatformIssueReport`/decision write paths own occurrence dedupe.
  Dedupe is enforced transactionally at write time; rendering does not conceal
  duplicate rows as a substitute.
- Existing decision resolution proposals and decision-origin projection remain
  canonical for answers and provenance.
- The request contract and routed-inference failure classifier remain canonical
  for sensitivity, eligibility, budgets, and effective blocker classification.
- `CoworkerPostureControl`, `CoworkerPriorityDock`, and
  `GoldenTriangleControl` remain the shared UI primitives. A tiny shared
  single-open controller may coordinate them; no third control layer is added.

### Data and migration decision

Prefer existing stable source keys and occurrence counters. A schema change is
permitted only if the write-path audit proves the existing unique identity
cannot represent an open escalation cluster or a per-turn context ceiling. Any
migration must backfill all existing states inline and apply forward-only.

### Privacy and authority

The per-turn context control may only narrow the caller's authorized context;
it can never widen sensitivity clearance. It does not delete persisted source
records and must not imply that it does. Consequential actions continue to use
the existing proposal/approval boundary.

## UX fit review

**Decision:** fits with guardrails.

- Owning surfaces are the Workspace attention inbox, Decision Governance, and
  the global coworker composer. No new top-level route or navigation item is
  justified.
- First viewport: one row per distinct decision, digest collapsed, default
  badges quiet, and technical routing detail hidden.
- Progressive disclosure: source instances, digest entries, route details, and
  priority fine-tuning expand in place.
- All styling uses existing shared components and `--dpf-*` tokens. Light and
  dark modes are both part of verification.
- Every visible control must either mutate canonical state or navigate to the
  exact governing surface.
- Keyboard verification covers Escape dismissal, focus return, and one-open
  behavior.

## Verification contract

1. Red/green tests for grouping, canonical counts, digest collapse, exceptional
   badges, write-time dedupe, receipt counts, compliance action targets, failure
   classification, partial-result preservation, vocabulary, Escape dismissal,
   one-open behavior, and context narrowing.
2. Targeted affected Vitest suites run locally.
3. Source scans prove no hardcoded color was introduced and no second queue,
   answer store, or routing classifier was added.
4. UX manifest records the changed surfaces and the browser journey.
5. The governed pregate runs the production build, semantic review, and shared
   nonproduction browser verification before the PR opens.

## Documentation impact

Update the owner-facing attention/coworker guide if control labels or workflows
change. Architecture documentation changes only if the audit requires a new
persisted contract; otherwise this design and its implementation plan are the
durable record. No install or deployment contract changes are expected.

## Out of scope

- `B-01` Build Studio streamlining, already referred to the Build Studio work.
- Replacing the canonical attention, proposal, provider, or decision models.
- Making provider configuration changes on behalf of the operator.
- Changing authority ceilings or weakening human approval requirements.
