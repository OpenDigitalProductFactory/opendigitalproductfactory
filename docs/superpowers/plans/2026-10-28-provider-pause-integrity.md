---
status: active
---
# Provider pause integrity repair

Backlog: BI-1FB1C9B5. Workroom: WC-E490546E. Corrective successor to BI-56F2AB99 and BI-E2BDE90B under EP-75B31C95.

## Design boundary
Reuse `docs/superpowers/specs/2026-10-11-provider-pause-design.md` OBJ-PAUSE/OBJ-RESUME and `2026-10-12-provider-routing-controls` design. Existing AiProviderConnection.status, ModelProvider.status and ScheduledJob pause metadata own authority; no schema, credential, capacity-policy or dependency change. The operator asked to harden inaccurate pause behavior and UI. The body's design note and receipt initiative-1935df39-f6d2-4540-891b-22aaeecfc471 cover this medium defect.

## Acceptance
- AC-PAUSE: New local embedding dispatch and each oversize retry recheck persisted provider/account eligibility and make no HTTP inference request while paused or disabled.
- AC-DEFER: Pause returns a retryable embedding deferred result with an accurate reason; active embeddings remain exempt from local-CI capacity gating.
- AC-HEALTH: Paused/inactive never alone means missing setup or unreachable; positive recent evidence and actual failures remain visible, otherwise health is unknown.
- AC-UX: Show pause scope, resume time and health distinctly; explain health checks continue and admitted work may finish, without duplicated pause/resume text.
- AC-SAFETY: Preserve chat dispatch checks, timer identity/expiry, independent restrictions, original live pause, and health probes that generate no inference.
- AC-VERIFY: First-failing targeted regressions, affected typecheck, governed runtime/UI verification and protected CI; report unavailable checks honestly.

## Ordered implementation (one atomic deliverable)
1. Regression-first: embedding.test.ts pauses/disabled lifecycle/eligibility failure and pause between retries; provider-health.test.ts verifies inactive is not unconfigured and disabled is not guessed authentication failure. Observe first failure before implementation. Existing source initial test: 7 failed, 41 passed.
2. Extract fresh readEnabledRoutingProvider from ai-inference.ts into provider-routing-admission.ts and reuse before each embedding HTTP dispatch. Preserve existing chat semantics and return typed deferral for local routing holds. No local-CI capacity check added. Probe availability remains a GET /models, no inference.
3. Provider health evaluates real outcomes and holds independently of inactive routing. Remove guessed authentication failure with no error evidence. Batch loader treats inactive as configured for its error fallback.
4. Reuse ProviderRoutingControlPanel, ProviderPauseControl, ProviderStatusToggle, Surface, StatusBadge and LocalTime. One routing badge, one control-owned resume timestamp, health evidence visible, monitoring scope explained. No new telemetry/card/dashboard. Read-only viewers retain pause information. Preserve failed action messages and independent restrictions. Prototype: docs/ux-fit/2026-10-28-provider-pause-integrity.html (simulated only). Choice DI-95546DE16E78 recommends separate-status, high confidence, proceed; prior incomplete feature scoring DI-AC10EB21DBF5 superseded for this choice. Advisory UX engagement CE-AF4D8039 requested, execution not yet claimed.
5. Affected source tests and web typecheck; gate-context, pregate:preflight, exact-tree governed pregate with served UX/mobile/theme/keyboard evidence, protected PR and canonical release. Preserve current operator pause during all live checks. No temporary runtime started from the worktree. Inconclusive checks are not passes.

## Traceability and verification
Contracts: AiProviderConnection.status; ModelProvider.status; ScheduledJob.
Flow: /platform/ai/providers/[providerId].
Tests: apps/web/lib/inference/embedding.test.ts; apps/web/lib/inference/ai-inference.test.ts; apps/web/lib/inference/ai-inference.call-provider.test.ts; apps/web/lib/inference/provider-operator-pause.test.ts; apps/web/lib/routing/provider-health.test.ts; apps/web/lib/routing/provider-health-loader.test.ts; apps/web/lib/routing/provider-routing-control.test.ts; apps/web/components/platform/ProviderRoutingControlPanel.test.tsx; apps/web/components/platform/ProviderStatusToggle.test.tsx.
Impact contract directory claims are unresolved; expand verification to all listed colocated suites plus mandatory guards and shared gate. Graph lookup exactly links embedding.ts to embedding.test.ts; no claim of complete graph coverage.

## Backlog coverage
Atomic: the enforcement and UI explanation deliver one trustworthy pause contract and cannot be independently accepted under the stated outcome. All six acceptance criteria map to BI-1FB1C9B5. Immutable plan coverage receipt is recorded through the governed writer after commit; it is not supplied by this prose.
