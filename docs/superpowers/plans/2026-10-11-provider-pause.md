# Implement operator provider pause

BI-56F2AB99; Workroom WC-62930005. Design: `docs/superpowers/specs/2026-10-11-provider-pause-design.md`. Medium atomic deliverable. Status: planning; immutable backlog coverage pending, no runtime implementation authorized by this plan until the receipt succeeds.

## Acceptance criteria from the item body

- Disable offers 'Until I enable it' (persistent) or a positive duration in hours/days. Timed pause displays the exact resume timestamp in the operator's timezone.
- Block new dispatch immediately through canonical AiProviderConnection eligibility and a fresh dispatch-time check. Health/discovery must not override an operator pause. Already in-flight requests may finish.
- Allow Resume now, Extend/change resume time, and conversion to indefinite disable. A newer operator action supersedes and invalidates every older timer.
- Persist the pause and execute its expiry through the existing durable jobs/ScheduledJob substrate, independently of an open page or chat; reconcile overdue pauses after service restart.
- Use transactional/version-checked expiry so a delayed or duplicate recovery event cannot lift a later pause. Expiry removes only this operator pause and preserves independent health/auth/billing/policy restrictions. An unhealthy provider must not receive traffic solely because the duration elapsed.
- Show paused, resume time, and any health restriction distinctly; audit pause/change/resume actions.
- Verify persistence across refresh/restart, early resume, extension, indefinite conversion, stale/duplicate timer delivery, concurrent disable versus expiry, unhealthy expiry, and eligible fallback routing.

## Design grounding

The prototype precedes this plan. Reuse the provider status control, default connection routing veto, automatic recovery job pattern, and jobs facade named by the design. Research compares Alertmanager/Uptime Kuma and PagerDuty/Datadog. Existing BI-734C1534 handles the immediate disable defect separately; this plan cannot delay that PR. UX advisory engagement CE-18EF4499 is pending. Source architecture, theme styling and planning runbooks were read. No schema changes or dependencies.

## Sequencing and verification

1. Verify live control authority and deliver BI-734C1534 first. Keep deny results explicit. Obtain research receipt, immutable plan coverage and implementation readiness; incorporate specialist critique and measured UX fit before merge.
2. AC-PAUSE / connection-authority: write failing tests for immediate pause and health/recovery veto. Extend the existing routing seam into an explicit local pause/resume service. Use transactional per-connection serialization and ScheduledJob metadata with generated operation identity; keep independent ModelProvider health. Verify rollback on failed job write and stale-selection dispatch.
3. AC-TIME / durable-expiry-flow: implement one durable expiry handler plus bounded overdue reconciliation, reusing jobs facade and ScheduledJob. AC-RACE tests cover stale event, duplicate event, extension, early resume, indefinite conversion, and concurrent expiry/operator mutation. AC-HEALTH tests cover unavailable endpoint and independent restrictions. Validate send failure with successful durable pause.
4. provider-control-contract: extend existing ProviderStatusToggle and provider row/detail projection with Pause now, Resume now, Change pause, visible timestamp and inline errors; use shared themed primitives, no browser timers/dialogs. Update user guide. Test behavior and refresh/state rehydration, then exercise light/dark/mobile against a governed served target.
5. verification-pause-suite: run affected web/DB tests, production and test typechecks, docs derivations, diff gates, canonical pregate, independent semantic review, DCO PR and queue. Only after delivery use request_self_upgrade and verify live pause persists and no new local dispatch occurs.

The phases are internal sequencing of one capability: a timer without a routing veto is unsafe and a control without durable lifecycle is incomplete. The existing independent disable repair already has its own BI/branch, so this plan has no uncovered independent successor.

## Backlog coverage

Atomic BI-56F2AB99 maps AC-PAUSE, AC-TIME, AC-RACE, AC-HEALTH to connection-authority, provider-control-contract, durable-expiry-flow, verification-pause-suite. Receipt pending at immutable publication; do not claim coverage before the server validates it.

## Risks and rollback

Race/lost event/health overwrite are covered in steps 2-3. Revert timed UI and job handler while preserving inactive routing connections. An old timer must never reopen a superseding pause. No destructive DB migration. Unknown metadata fails closed. Live-control access and deployment remain separate gates from source implementation.
