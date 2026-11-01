---
status: draft
---

# Readable requested actions — BI-038AA4BC

Design: [existing approval presentation design](../specs/2026-09-01-approval-cards-recommendation-versus-authorization-design.md#readable-requested-actions--bi-038aa4bc-2026-10-31).
Scope: one medium continuation of the existing presentation refactor, admitted
for design in WC-4BD300BC / IRD-9662FCF74D5E. Prior PR #6751 and its deployment
remain historical delivered evidence. This plan does not claim its own approval.

## Existing acceptance baseline

- Existing approval kinds lead with understandable outcome, affected scope, consequential facts and validity.
- Tool/grant IDs and receipt lineage move to accessible technical details when unnecessary for the decision; destinations, amounts and irreversible effects remain visible.
- Authorization, execution and completion states remain truthful and separate; uncertain acknowledgement reconciles the recorded result and does not replay the action.
- No new grant picker, approval engine, endpoint or standing permission is introduced.
- Reuse canonical theme-aware components and localization; verify keyboard, status announcements, mobile and light/dark presentation against the served target.
- Characterization tests preserve authorization endpoints and exact binding behavior; UI acceptance includes representative known, exact, generic and handover envelopes.

## Contracts and flow

CT-QUESTION: a localized operation question identifies an exact registered
request without claiming its scope/effects are verified. CT-UNCERTAINTY: missing
names, unknown shapes and unresolved consequences remain explicit; all material
facts and current hold recommendations survive. CT-BINDING: presentation cannot
alter execution inputs, authorization or completion. CT-FIT: the shared renderer,
theme tokens, disclosures and localization remain the existing substrate.

FLOW-NAMED: saved exact proposal -> existing decision projection -> localized
operation question -> existing primary facts and controls -> optional evidence.
FLOW-UNKNOWN: missing/malformed/unrecognized proposal -> existing unresolved
fallback -> complete material facts and a hold recommendation.

VERIFY-QUESTION: behavioral projection/render tests name the requested operation.
VERIFY-INTEGRITY: negative tests retain unknown effects, actual-viewer name
admission, complete material facts and exact decision bindings.
VERIFY-SERVED: source-bound shared/protected production serving and real browser
scenarios qualify copy, keyboard and viewport behavior separately from source tests.

## Ordered work and stop conditions

1. Preserve the observed baseline and existing research/design. Publish this
   signed design/plan/prototype through the normal documentation lane. Re-sync
   exact author/source and obtain the canonical design, independent spec and
   architecture receipts, objective baseline, plan review and immutable live
   coverage. Stop before runtime edits while readiness is not allowed.
2. Add the behavioral first-failing tests to the existing projection/component
   suites: known update/merge/reservation questions appear in the initial view;
   unsupported effects retain their hold, names are never guessed, and critical
   values remain visible. Run those tests before changing runtime copy.
3. Extend only the existing primary projection and source locale. A standard
   update request may identify this app; it must describe a request whose timing
   depends on admission, not an installed update. Preserve existing name readers
   and every authorization/state boundary. Do not add a new enrichment reader or
   infer effects from free-text rationale. If additional semantics are required,
   return to design rather than widening this implementation silently.
4. Run affected tests, both web TypeScript programs, style/whitespace and derived
   freshness checks. Freeze the DCO-signed source; obtain independent exact-source
   review and the governed integration evidence. Never repeat a terminal/unknown
   gate under a new identity or use another actor's credentials.
5. Use the existing protected UX Route Sweep Runtime lane described in the
   design. Exercise known/exact/generic/handover fixtures at320px and desktop in
   light/dark with keyboard and status assertions; keep real-DOM budgets frozen.
   Record measured UX-fit evidence before publication. No live authorization is
   submitted by fixture buttons. Full production-copy performance is separate.
6. Submit a regular ready PR only after exact-source readiness; follow protected
   checks and merge queue. Coordinate one canonical release with its current
   owner, verify installed membership with CAN-TEST, and inspect representative
   live cards. A source pass is not deployment or final acceptance.

## Start-of-work impact

The native changeImpactContract is resolved. Graph lookup is ready and returns
three exact tests: apps/web/lib/attention/coworker-envelope-decision.test.ts,
apps/web/components/attention/CoworkerEnvelopeApproval.test.tsx and
apps/web/components/attention/CoworkerEnvelopeApproval.on-behalf.test.tsx.
Run them proportionally to the final diff, plus both TypeScript programs.
The current guard obligation is node scripts/check-style-drift.mjs; the PR owes
Design grounding. Check node scripts/gen-doc-index.mjs --check first; claim an
actual derived diff before writing it. No module ratchet or migration was selected
in this prospective contract; re-run gate context on the actual final diff.

## Atomic coverage and limits

One deliverable: readable operation questions without losing unresolved-effect
protection, mapped to BI-038AA4BC. requirementRefs: RQ-ACTION, RQ-UNCERTAINTY,
RQ-SCOPE, RQ-FACTS, RQ-STATE, RQ-FIT. contractRefs: CT-QUESTION, CT-UNCERTAINTY,
CT-BINDING, CT-FIT. flowRefs: FLOW-NAMED, FLOW-UNKNOWN. verificationRefs:
VERIFY-QUESTION, VERIFY-INTEGRITY, VERIFY-SERVED. No dependency or child item is
introduced. The immutable coverage receipt is still owed after publication.

Unknown work names and unproven consequences remain limitations, not permission
to expose private names or authorize a request. Other technical notice producers
retain their current owners. This plan does not repair preferred-provider routing,
settle old uncertain executions, or deploy reporting/Responses changes. Funding
ownership is unresolved; no new allocation or provider spending is inferred.
