# Contributor preview authentication repair

**Backlog item:** `BI-1F6C9BE6`

## Outcome

A sanitized Contributor preview invalidates every copied password, omits authorization memberships whose restricted roles are not cloned, and provisions one deterministic preview-admin identity with a separate development-only password. Workforce authorization remains valid when no platform role is present.

## Delivery

This is one atomic repair: the clone sanitization, preview-only credential bootstrap, null-safe authorization projection, Compose wiring, and contributor instructions are not independently useful. Shipping only one part either leaves login unusable or weakens the clone boundary.

1. Add source-local regression tests for copied-password invalidation, `UserGroup` omission, preview-admin provisioning, and role-less superuser authorization.
2. Refactor confidential-row sanitization into a testable helper; keep all copied hashes invalid and provision only the cloned superuser from `CONTRIBUTOR_PREVIEW_PASSWORD` after the clone completes.
3. Treat `UserGroup` as restricted because its required parent `PlatformRole` is restricted, and resolve workforce roles through a null-safe pure helper.
4. Wire the separate preview password into `dev-init` and update contributor instructions without a hardcoded shared password.
5. Run targeted DB/web/Compose tests, typecheck/build gates, then prove health plus authenticated `/workspace` under a governed Contributor-preview lease.

## Backlog coverage

- Atomic delivery: `BI-1F6C9BE6` covers the full repair.
- Coverage receipt: unavailable in this session because the active DPF MCP token exposes `search_specs_and_plans` but not `record_plan_backlog_coverage` or `check_plan_backlog_coverage`. This limitation is recorded explicitly rather than represented as a completed live receipt.

## Risks and rollback

- Requiring a separate preview password can stop `dev-init` when it is absent; the error must identify the variable without printing its value.
- Omitting `UserGroup` removes role-specific preview behavior. The preview administrator remains a superuser, and role-specific authorization testing must use purpose-built fixtures rather than copied production authorization state.
- Rollback is a normal PR revert. No production schema, credential, or data migration is involved.
