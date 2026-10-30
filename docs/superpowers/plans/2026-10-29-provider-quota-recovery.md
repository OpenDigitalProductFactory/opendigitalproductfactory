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
2. Refactor one bounded explicit quota-recheck implementation, using existing account snapshot and conditional persistence. Preserve verification-only `test`. Add adversarial/current-generation and real PostgreSQL tests before implementation. Route portal/MCP through the same governed operation; no hand-clearing or alternate credentials.
3. Add the bounded hourly recovery to existing durable scheduling and record per-account attempts/results. Respect current short waits; observe distant forecasts without claiming CLI proof. Exercise timeout, loss, concurrent edits and repeated-sweep idempotence.
4. Extend existing account capacity/readiness UI with distinct restriction evidence, freshness, next check and provider reset guidance. Reuse localized theme-aware components; show reset availability unknown where unsupported. Add accessible desktop/mobile/light/dark served scenarios. Preserve independent allowed-work/trust information.
5. Run affected tests, both typechecks, `pnpm gate:context` obligations, canonical shared gate, independent exact-source review, ready DCO PR and protected queue. Coordinate shared generated docs rather than overwrite another room. Request canonical update once eligible and prove served bytes before actual account recheck and normal coworker/watch acceptance. Preserve all failed/unrun receipts.

## Backlog coverage

Atomic deliverable `provider-quota-recovery` maps to BI-D81CCC24. Its control, observation, projection, scheduled recovery and view must agree before the operator can safely rely on a restored account; the ordered steps are internal sequencing, not independently shippable claims. Existing consultation and routing work is reused and verified, not duplicated.

Requirements: AC-1, AC-2, AC-3, AC-4, AC-5, OBJ-1, OBJ-2, OBJ-3.
Contracts: CT-QUOTA-OBSERVATION, CT-RECOVERY-COMMISSION, CT-RECOVERY-VIEW.
Flows: FLOW-RECHECK, FLOW-HOURLY, FLOW-RESET.
Verification: VERIFY-ISOLATION, VERIFY-RECOVERY, VERIFY-UI, VERIFY-LIVE.

The live coverage receipt is recorded after this plan is committed, published and provider-readable; no fabricated receipt is embedded.

## Risks and rollback

The principal risk is a false available state from another account, transport or older generation. Fence all writes and the shared projection; preserve hard holds and unknowns. Reset offers have no inspected supported discovery API, so this delivery exposes honest guidance and a provider link rather than fabricating availability. Hourly probes stay bounded within the existing account/commission and cannot execute original work. Revert through protected delivery and pause the existing recovery job if needed; retain evidence and never delete operational history.
