---
status: active
---
# Provider navigation and routing controls

Backlog: BI-E2BDE90B. Workroom: WC-F0807EB1. Medium platform repair.

## Acceptance

- Every AI provider, including ChatGPT, is reachable from Providers & Routing; shared Codex/ChatGPT auth has explicit reciprocal links and a clear authentication owner.
- Provider detail begins with current routing eligibility and all applicable automatic restrictions (quota reset/cooldown, health/auth, local-only) plus operator pause and resume time, without presenting removal of one veto as full eligibility.
- Reuse and refactor existing durable pause, connection eligibility, routing summary and UI controls for supported cloud providers. Pause immediately, optionally set hours/days, resume early, and preserve independent restrictions and stale timer safety.
- Verify navigation, shared-auth explanation, simultaneous vetoes, timed persistence, and cloud expiry without resetting auth/quota failures.

## Design grounding

Extend [operator pause design](../specs/2026-10-11-provider-pause-design.md) and [provider setup UX](2026-07-26-provider-routing-setup-ux.md). Source reviewed: `apps/web/lib/inference/provider-operator-pause.ts`, `apps/web/lib/routing/provider-health-loader.ts`, `apps/web/lib/routing/provider-routing-eligibility.ts`, `apps/web/components/platform/LocalProviderPauseControl.tsx`, `apps/web/components/platform/ServiceRow.tsx`, `apps/web/lib/inference/ai-provider-data.ts`, and `packages/db/data/providers-registry.json`.

Existing Alertmanager, Uptime Kuma, PagerDuty and Datadog research in the pause design applies to identity, expiry and preserving independent restrictions. No new schema or dependency. Registry sync converges visibility on existing installs.

## UX fit

Prototype: [provider controls](../prototypes/2026-10-12-provider-routing-controls.html). Platform owner persona; contextual actions in existing detail route, no new navigation layer. Reuse StatusBadge, Button, LocalTime and existing pause control; retire local/cloud UI divergence for model endpoints. Account, trust, models and finance remain accessible below. Read-only users see status without mutation controls. Unconfigured and unsupported service endpoints stay setup-gated.

Kernel choice DI-41A3E45ADBFE recommends contextual controls over a separate routing tab; human_cognitive_load 0.2 versus 0.7. Advisory UX critique CE-85978F80 requested through the specialist service. Prototype is simulated, not runtime proof. Owner correction supersedes stale initial 20% guidance: 80% refactoring/integration/reliability investment.

## Ordered implementation

These phases are internal sequencing for one atomic provider-management repair: navigation leads to a status/control surface whose read and write semantics must agree. No phase constitutes an independent release.

1. Generalize the existing pause service and scheduler from local-only to model providers with canonical default connections. Cloud pauses change connection eligibility only; expiry preserves provider lifecycle, capacity and auth/billing restrictions. Keep local probing semantics and compatibility exports. Broaden overdue reconciliation and validate event identities. Verify cloud pause, independent disable, and stale timer tests in `apps/web/lib/inference/provider-operator-pause.test.ts`.
2. Reuse the same pause control for supported providers; ensure persisted read state applies across refresh. Introduce one provider routing read model composing deriveRoutingEligibility, provider health, CLI pool, local-only, recovery job, and operator controls. Show simultaneous vetoes with localized retry/resume timestamps. Remove duplicated detail toggle. Verify `apps/web/components/platform/ProviderStatusToggle.test.tsx` and provider-routing-control projection tests.
3. Restore registry ChatGPT visibility, explicit catalog Manage links and reciprocal ChatGPT/Codex shared-auth links. Document behavior in `docs/user-guide/`. Verify registry visibility and `apps/web/components/platform/ServiceRow.test.tsx`; no manual runtime DB patch.
4. Run affected unit tests, package typecheck, deterministic guards, measured UX-fit, and exact-tree shared-runtime pregate. Exercise served light/dark/narrow/keyboard provider detail and pause/resume using governed sign-in and lease. Preserve unrun/inconclusive checks explicitly. Open ready DCO PR only after applicable gates, follow CI through protected merge queue.

## Traceability and coverage

Requirement reference: Acceptance above. Contract reference: `AiProviderConnection.status` plus `ScheduledJob` pause generation. Flow reference: `/platform/ai/providers` to `/platform/ai/providers/chatgpt` and reciprocal `/platform/ai/providers/codex`. Verification reference: `provider-operator-pause.test.ts`, `ProviderStatusToggle.test.tsx`, `ServiceRow.test.tsx`, source typecheck and shared-runtime pregate.

Coverage receipt `cmv5o3et9cvzs01mwbzskhyvj`: atomic, parent BI-E2BDE90B, no independent children/dependencies. Immutable plan commit `7d1d302d7a4e9f794be91271218a4b4aab1135c4`, blob `1e8c1a433606b64bdabe0ce34c036bce61ed1a94`. Implementation admission IRD-C22FC5649796 passed.

## Risks and rollback

Cloud expiry must never reactivate an automatic disabled provider or erase quota state. Stale selections require a dispatch-time connection veto; support account identities rather than checking a different default connection. Unknown/service endpoints are refused for model pause. Old timers remain safe by operation generation. Rollback removes UI/generalization but retains existing persisted pauses as routing vetoes. Never kill in-flight work or clear quota rows during pause/resume. Existing user-owned runtime files remain untouched.
