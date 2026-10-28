# Codex operational recovery

Backlog: BI-4A28B171. Workroom: WC-5D3F4404.

## Objective and boundary

Restore reliable Codex delivery in three ordered steps: repair client-scoped toolchain updates; converge the installed Codex client through the signed updater; then verify one existing stalled delivery using its current owner and applicable publication policy. This branch delivers only the first independently shippable repair. Existing review recovery remains BI-CAP-29F5787B; no duplicate review, permission change, or production runtime replacement is authorized by this plan.

Reuse `docs/superpowers/specs/2026-10-27-self-converging-agent-toolchain-design.md` and `docs/superpowers/specs/2026-10-25-client-routine-permissions-design.md`. Extend the existing updater's selection predicates and permission planner. No schema, credential, provider, or policy store changes.

## Reproduction and acceptance

The installation-signed pack 0.2.19 dry run with `--codex-only` exits 1 because the permission planner parses unrelated Grok configuration. Source at a6137100ce4aa783cfcc5896773d2d0bb284ba19 includes Grok in selected permission clients and runs Grok/Antigravity in Codex's adapter block. This differs from the missing-parser defects BI-CEDE5B55 and BI-6763D09E.

- AC-SELECT-1: --codex-only selects only Codex adapter and permission writes; unrelated malformed client configuration cannot fail it.
- AC-SELECT-2: --claude-only remains Claude-only and an unfiltered update retains all-client behavior.
- AC-SELECT-3: signed portal argument forwarding preserves client selection and dry-run semantics.
- AC-SELECT-4: rejected selected-client configuration remains unchanged and causes an honest failure.

## Ordered atomic repair

1. Add behavior regressions to `packages/dpf-skill-pack/scripts/update_agent_toolchain_test.py`: malformed unrelated client settings do not block a Codex update; other adapters are untouched; malformed selected settings fail without modification; default and Claude selections retain their behavior. Observe failure before implementation. Existing portal-source tests verify forwarded selection and dry-run arguments; extend only if coverage is absent.
2. In `packages/dpf-skill-pack/scripts/update_agent_toolchain.py`, use the same exact client selection for adapters and permission planning. Keep shared pack delivery and discovery, but do not invoke unselected adapters or refresh their credentials. Preserve all existing validation and selected-client failures.
3. Document selection in `packages/dpf-skill-pack/README.md`. Run updater, permission, portal-source and convergence tests, Python compilation and affected source guards. Graph lookup returned no linked tests, so colocated suites provide coverage. This source-only worktree can run dependency-free Python tests; no web typecheck pass is claimed.
4. Complete the exact-tree publication gate, independent review and DCO-signed protected PR. Upgrade through the canonical mechanism and rerun the signed Codex-only dry run; verify its outcome and unrelated client file preservation before applying the supported update. A client restart is owed only after successful convergence.

## Traceability and rollback

Requirement: AC-SELECT-1 through AC-SELECT-4. Contract: updater client-selection and routine-permission planner. Flow: signed portal -> child argv -> selected adapters -> selected permission plan -> report. Verification: client-selection regressions and signed updater dry run.

The code, tests and documentation form one repair, not independent deliverables. Roll back through a protected revert. Preserve existing configuration and updater backups; never overwrite later user edits. Main risks are accidentally suppressing default all-client maintenance and misleading reports for unselected clients; cover both in tests. The repair must not relax validation to make malformed selected-client configuration pass.

## Backlog coverage

Atomic deliverable SELECT-1 maps to BI-4A28B171. Research receipt: initiative-6b0d7ed8-7fe7-4fed-9c73-213ec49df62b. Plan coverage will bind this immutable document before implementation.
