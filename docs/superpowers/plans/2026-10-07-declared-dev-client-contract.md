# Declared DEV client contract

Backlog: BI-45DA45A6. Workroom: WC-4C79454C. Branch: fix/declared-dev-client-contract.

## Design grounding

Extend docs/superpowers/specs/2026-08-22-installation-identity-and-agent-stance-design.md and docs/superpowers/specs/2026-08-22-external-agent-operating-contract-design.md. Canonical sources remain loadInstanceStance, readInstallHostProfile and token/coworker grant intersection. Existing get_my_coworker_profile is the recovery read; initialize is the connect-time projection. Coworker lifecycleStage describes the coworker, never the installation. No new permission or persisted substrate.

## Problem and decision

Installer state and live config both say development; live issue_ux_verification_sign_in succeeded because environment class development. Profile reads omit that installation context, and contributor guidance routes credential-restricted clients back to the operator. Share one server-only composition between initialize and profile; return explicit unknown context on read failure. State routine already-granted DEV/test work, local credential management and platform sign-in clearly while retaining all authorization boundaries.

## Acceptance

- AC-1: An authorized profile read exposes declared environment, credential/teardown/peer stances, host source capability, and the same operating guidance used at initialization, including when no acting coworker is bound.
- AC-2: DEV/test routine authorized exercise and local test credential generation/rotation do not request repeated operator involvement; browser verification names issue_ux_verification_sign_in.
- AC-3: Production, unknown environment, read-only connections, denied grants, uncaptured backlog and paired production limits remain intact.
- AC-4: Failed stance composition is explicitly unknown/cautious, never a false DEV assertion; existing identity/grant profile behavior is preserved.
- AC-5: Focused tests and package typecheck pass, and authenticated live DEV verification uses the existing platform-owned sign-in.

## Ordered delivery

1. Refactor composition (~20% of effort): extract host/stance loading and shared instruction rendering into apps/web/lib/mcp/agent-host-context.ts. Keep independent guarded reads and explicit unknown stance. Initialize keeps installation naming and org context; delegates host briefing to the shared composition.
2. Project context from apps/web/lib/mcp/packs/coworker-capability-pack.ts on get_my_coworker_profile, including agentless connections. Resolve authority conservatively from actual token scope and effective grants; absent token evidence never implies admin. Preserve existing profile/grant fields and explain coworker lifecycleStage separately.
3. Clarify granted routine DEV/test execution and issue_ux_verification_sign_in in apps/web/lib/mcp/agent-host-instructions.ts and docs/architecture/contributor-procedure-runbook.md. Production/unknown/read observers retain caution; no grants, policies or runtime files changed.
4. Prove regressions with agent-host-context.test.ts, agent-host-instructions.test.ts, initialize.identity.test.ts and coworker-capability-pack.test.ts; include environment-class/instance-stance/automation-sign-in tests and initialization protocol tests. Resolve find_related_tests for touched source before Red. If graph advice is unavailable, expand to colocated and caller suites. Run package typecheck and pregate:preflight, style-drift-guard, doc-index generation/check, and canonical pregate before runtime-code push. No React route change is required.
5. Use the issued platform-owned DEV sign-in in the driven browser and verify an authenticated page. Verify new context on a governed deployed target when available; existing sign-in success establishes the current route only, never delivery of new code. Run independent semantic review and pr:health before merge; deployment only through request_self_upgrade.

## Traceability

Requirement refs: AC-1, AC-2, AC-3, AC-4, AC-5.
Contract refs: docs/superpowers/specs/2026-08-22-installation-identity-and-agent-stance-design.md; docs/superpowers/specs/2026-08-22-external-agent-operating-contract-design.md.
Flow refs: initialize -> shared host context -> get_my_coworker_profile; issue_ux_verification_sign_in -> authenticated browser.
Verification refs: apps/web/lib/mcp/agent-host-context.test.ts; apps/web/lib/mcp/agent-host-instructions.test.ts; apps/web/lib/mcp/initialize.identity.test.ts; apps/web/lib/mcp/packs/coworker-capability-pack.test.ts; pregate.

## Backlog coverage

One atomic deliverable mapped to BI-45DA45A6. Phases are internal sequencing: exposing context without shared composition or clear execution guidance retains the same client failure. No independent child deliverables or dependencies. Record the immutable plan blob with record_plan_backlog_coverage before implementation; the receipt is stored canonically in the Workroom, since adding its ID to this immutable blob would change the identity it certifies.

## Risks and rollback

The additive profile field can increase reply size; keep it bounded and secret-free. A failed stance loader must yield unknown/cautious guidance without losing the usable profile. DEV must never imply token grants or permission to mutate paired production. Read-only scope wins over grant names. Revert this one PR to remove the projection and briefing changes; no migration or data rollback.
