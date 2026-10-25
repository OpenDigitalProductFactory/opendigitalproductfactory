---
status: draft
---
# Approval result recovery implementation
Backlog: BI-A83A4188. Workroom: WC-B7FF346F.
Design: [recorded approval failure recovery](../specs/2026-10-25-approval-result-recovery-design.md).

## Outcome and acceptance
One atomic repair implements OBJ-APR-1, OBJ-APR-2 and OBJ-APR-3 through CT-APR-BOUND-EXEC, CT-APR-READ, CT-APR-PRESENT and FLOW-APR-READ.
The item-body acceptance criteria are retained verbatim:
- AC-1: The original failed handoff result names its verified refusal in plain language and retains the saved authorization versus execution distinction.
- AC-2: Owner Inbox, exact status API and caller-scoped MCP use the same safe failure-evidence projection; private messages/arguments never leave it.
- AC-3: A proven original Workroom is reachable only when current reader access permits it; missing access/identity produces an explicit inspection limitation without revealing foreign content.
- AC-4: Missing, conflicting, unsupported and unknown evidence never becomes a cause, pass, permission to retry or new approval; current actor and parameter fences remain enforced.
- AC-5: Existing provider-account evidence and waiting/result routing retain behavior; regression tests first reproduce the missing explanation and exercise identity drift, audit shadowing, ambiguity and private payloads.
- AC-6: Governed source delivery and canonical deployment are recorded separately; repeat the exact baseline result, historical/current review inspection, normal refresh and isolated offline/reconnect scenarios with bounded timings and honest unknown/unrun outcomes.

## Ordered work
1. Refactoring: characterize current bounded evidence behavior and add a first-failing regression for the missing known refusal. Resolve the claimed impact paths with find_related_tests; if unavailable, use the colocated source/store/UI/API suites and expand affected verification. V-APR-REGRESSION covers input/actor drift, annotation stripping, conflicting executions, audit shadowing, malformed result, missing evidence and private payloads.
2. Refactoring: consolidate original execution selection and binding validation in the existing approval-action-evidence module. The provider-test reader and failed-outcome projector reuse it. Preserve direct-call thread absence as absence, and the existing finite row bound. No record mutation or replay.
3. Refactoring: route owner history/exact API and caller-scoped MCP through the same safe failure projection in the existing outcome store. Only allowlisted tool/code pairs produce explanations. Revalidate any room locator through current human or human-plus-assistant access, using canonical case links. V-APR-ISOLATION proves foreign/removed access suppression.
4. Refactoring: consolidate localized failure copy and adapter rendering while keeping existing state/routing/provider evidence tests green. Run both package TypeScript programs, affected regressions and the required prose/style guards. V-APR-COMPATIBILITY retains the existing public provider-account evidence contract and unknown states.
5. Bounded UI repair: render the explanation and permitted inspection link in the current ApprovalOutcomeHistory card; keep technical evidence under its existing disclosure and expose no retry/approval control. Apply advisory UX findings, theme/keyboard/narrow checks, and proportional UX evidence. V-APR-LIVE repeats exact baseline failure-result, current/historical reviewer inspection, normal refresh, isolated offline/reconnect and narrow layout on the canonical served commit.

Steps 1-4 are the 80% consolidation/refactoring allocation; step 5 is the remaining bounded presentation work. This estimate supersedes the earlier 20% user instruction and is not measured labor.
No step is independently shippable: a visible explanation without exact safe evidence is unsafe, and an unused evidence extractor alone does not deliver the measured operator outcome.

## Impact and gates
The claimed impact contract is resolved. Five production paths require related-test lookup: Inbox page, ApprovalOutcomeHistory, approval-action-evidence, approval-outcome-store and approval-outcome. Colocated suites plus exact envelope API tests provide the explicit fallback if the graph is unavailable.
Run the Prose Lint Guard tests and check, and scripts/check-style-drift.mjs. The Inbox frozen route budget is 428 words and its text-mass ratchet may only shrink. Keep added explanation concise; use existing disclosure for identifiers and detailed evidence.
Regenerate required docs index/impact artifacts when source changes warrant them; do not change route inventory for a route that already exists.
After local checks, run the shared governed local-CI gate, exact-source independent review, normal push/readiness, ready PR, all protected checks and merge queue. Advance the install only through the existing governed self-upgrade path and coordinate its owner. Source tests are not deployed acceptance.

## Backlog coverage
Coverage pending the immutable published plan. One atomic deliverable: approval-result-recovery -> BI-A83A4188.
Requirement refs: OBJ-APR-1, OBJ-APR-2, OBJ-APR-3.
Contract refs: CT-APR-BOUND-EXEC, CT-APR-READ, CT-APR-PRESENT.
Flow refs: FLOW-APR-READ.
Verification refs: V-APR-REGRESSION, V-APR-ISOLATION, V-APR-COMPATIBILITY, V-APR-LIVE.
No product source implementation starts before the live coverage and implementation admission are allowed.

## Risks and recovery
Overbroad evidence selection could leak a private result or attribute the wrong failure. Fail closed on ambiguous, malformed, changed or unauthorized input; return static safe copy, never raw error text. A navigation link cannot authorize room access.
The baseline includes unknown original provider outcomes and unrelated Windows repair obligations; retain them. Do not infer end-to-end recovery success from this presentation repair.
Rollback is a protected revert with no data rewrite. A publication/infrastructure failure is unrun/inconclusive, not a product pass or a new authority.
