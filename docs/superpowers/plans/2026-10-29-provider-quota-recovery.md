---
status: draft
---

# Provider quota recovery delivery

Backlog: BI-D81CCC24. Workroom: WC-2CCBB706. Design: [provider quota recovery](../specs/2026-10-29-provider-quota-recovery-design.md).

For agentic workers: execute one independently reviewable backlog item at a time. Use `dpf-tdd`, `dpf-local-merge-ci-before-push`, and `dpf-pr-with-dco` with the existing protected gates.

## Verbatim acceptance baseline

- Consultation produces result, acknowledgement or explicit actionable failure, including resolved success:false; retry can run again.
- Configured account status prominently distinguishes green enabled/working, yellow paused/temporary wait, red hard credential/billing failure, neutral uncertainty. Allowed work stays separate.
- Active install-owned ChatGPT/Codex quota holds get bounded hourly inference rechecks before distant reset; completed inference clears only unchanged proven quota ownership.
- Manual pause/disable/disconnect and hard auth/billing holds survive quota revalidation; concurrent changes prevent stale success writes.
- Affected tests/typecheck and governed served UI evidence cover failure, recovery, themes, mobile and keyboard before done.

## Ordered work

1. Research and independent design challenge. Bind immutable design/plan to the current workroom and live coverage. Verify current account actions, capacity projection, CLI ownership and paused/credential controls. Record source tests reproducing successful verification without quota reconciliation and stale shared forecast exclusion.
2. Refactor one bounded explicit quota-recheck implementation, using existing account snapshot and conditional persistence. Preserve verification-only `test`. Add adversarial/current-generation and real PostgreSQL tests before implementation. Reject an unsupported owned-account quota row before dispatch or writes, with unchanged original/provider/CLI records and a clear reconciliation result; do not silently normalize ownership. Route portal/MCP through the same governed operation; no hand-clearing or alternate credentials.
3. Add the bounded hourly recovery to existing durable scheduling and record per-account attempts/results. Respect current short waits; observe distant forecasts without claiming CLI proof. Keep explicit Check now separate from hourly due time, retain duplicate-click bounds, and provide an independent stop-only account operation that sends no provider request, including for paused accounts. Exercise timeout, loss, concurrent edits and repeated-sweep idempotence.
4. Extend existing account capacity/readiness UI with distinct restriction evidence, freshness, next check and provider reset guidance. Reuse localized theme-aware components; show reset availability unknown where unsupported. Extend the existing UX Route Sweep workflow with scoped provider recovery fixture/verification scripts and accessible desktop/mobile/light/dark/keyboard scenarios, including stop-only/no-inference. Preserve independent allowed-work/trust information.
5. Run affected tests, both typechecks, `pnpm gate:context` obligations, canonical shared gate, independent exact-source review, ready DCO PR and protected queue. Coordinate shared generated docs rather than overwrite another room. Request canonical update once eligible and prove served bytes before actual account recheck and normal coworker/watch acceptance. Preserve all failed/unrun receipts.

## Backlog coverage

Atomic deliverable `provider-quota-recovery` maps to BI-D81CCC24. Its control, observation, projection, scheduled recovery and view must agree before the operator can safely rely on a restored account; the ordered steps are internal sequencing, not independently shippable claims. Existing consultation and routing work is reused and verified, not duplicated.

Requirements: AC-1, AC-2, AC-3, AC-4, AC-5, OBJ-1, OBJ-2, OBJ-3.
Contracts: CT-QUOTA-OBSERVATION, CT-RECOVERY-COMMISSION, CT-RECOVERY-VIEW.
Flows: FLOW-RECHECK, FLOW-HOURLY, FLOW-RESET.
Verification: VERIFY-ISOLATION, VERIFY-RECOVERY, VERIFY-UI, VERIFY-LIVE.

Published-plan coverage: cmvub7tf9376u01o22s49q8b8 at immutable 9cc3a657337f3e239d8ed1031d3b4a4f8703229a / db7866dd1489c7ba2b4921e3e675ef878587ba1a. Research receipt: initiative-bf1078a3-afc2-461e-a84d-590aba4665dc. Implementation admission: IRD-C65A52BD352B. Refresh coverage for this updated artifact and declared edit scope before final delivery.

Current implementation adds one nullable capacity-proof field and a narrow additive migration, reuses the guarded verification transport with exact model and pre/post snapshot callbacks, and records explicit per-account hourly commissions in ScheduledJob. Ordinary connection Test remains verification-only. Source unit tests cover identity/freshness/expiry, a later quota generation, dispatch ownership changes, paused jobs, short waits, unrelated models/CLI and the UI action boundary. The isolated PostgreSQL suite copies table structure only and remains UNRUN until its governed database is admitted; no source-only run is database evidence. The UX Critic engagement CE-F00D8D7F is requested, not completed, and local prototype rendering was refused by browser protocol policy. No alternate rendering workaround was used. Final served UI and independent acceptance are still owed.

Independent source challenge of preserved checkpoint c2bc68dc5122dd94fc0f959f355abb25085ee0af found an unsupported owned-account quota row could be overwritten by the new proof write, and stopping an active stale commission could dispatch a check. Both findings remain open until their own regressions and corrections are observed. The source checkpoint is retained in the local backup branch; this documentation-first publication restores valid current-scope coverage before source corrections. It is not a delivery or runtime pass.

## Risks and rollback

The principal risk is a false available state from another account, transport or older generation. Fence all writes and the shared projection; preserve hard holds and unknowns. Reset offers have no inspected supported discovery API, so this delivery exposes honest guidance and a provider link rather than fabricating availability. Hourly probes stay bounded within the existing account/commission and cannot execute original work. Revert through protected delivery and pause the existing recovery job if needed; retain evidence and never delete operational history.
