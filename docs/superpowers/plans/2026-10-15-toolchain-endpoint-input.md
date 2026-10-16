# Preserve the MCP path in toolchain endpoint inputs

Backlog: BI-E2CE164A. Workroom: WC-8ED077A8.

## Problem and existing contract

At source `5bcd06fcf2a700dc56f45871c860968f4aead1c5`, passing
`https://localhost` to the standalone updater replaces an existing
`https://localhost/api/mcp/v1?tier=full` with a root-only URL. An independent
temporary-home reproduction establishes this behavior; attribution of the
earlier live outage remains unproven.

The owning design is [agent toolchain release delivery](../specs/2026-10-07-agent-toolchain-release-delivery-design.md),
section 5.3: a portal origin selects a signed distribution, while the manifest
provides an MCP endpoint. Extend the existing Python updater input boundary and
Node `computeAgentToolchainPlan` boundary; do not add a connector or auth mode.

## Acceptance criteria

- A bare HTTP(S) portal origin cannot replace a working MCP connector with a root-only URL; Python and Node inputs behave consistently.
- Explicit non-root MCP/proxy endpoint paths and non-secret query options remain intact; no authentication, grant, or user-disabled-state widening.
- Regression tests use temporary homes/configs only and prove the previously broken replacement, valid endpoints, existing preservation, and malformed-input refusal without touching the operator's real configuration.
- The documented updater contract distinguishes portal origin from MCP endpoint and delivered plugin copies can converge through the supported signed updater.

## Atomic implementation sequence

One repair, one PR: language adapters must agree before either is delivered.
There are no independently shippable phases.

1. Resolve the claimed paths' `find_related_tests` advice. If the graph cannot
   answer, use the colocated Python updater suite, the complete Node bootstrap
   package suite, and bounded searches for callers. The current impact contract
   has no extra guard obligations or migrations.
2. Add first-failing regressions to `update_agent_toolchain_test.py` and
   `bridge.test.ts`. Use temporary homes and filesystem shims. Cover root origins
   with and without a slash/query, valid custom proxy paths, invalid URL schemes,
   embedded credentials, and refusal before filesystem reads/writes.
3. Normalize an explicit HTTP(S) root origin to `/api/mcp/v1` before any client
   config is written. Preserve explicit non-root paths and query options.
   Refactor the Python saved-URL validation into the existing input helper where
   useful, retaining its safe error message and implicit endpoint preservation.
   Normalize Node planner input once so all planned clients and probes agree.
4. Run both affected suites and bootstrap typecheck. Regenerate the existing
   documentation index if needed. Document origin versus endpoint in the MCP
   authorization runbook. Run applicable policy, docs and shared integration
   gates, then independent review and the normal protected PR/merge queue.
5. After canonical delivery, verify the shipped signed updater against a
   temporary home or safe dry run. Do not rerun a real host update unless its
   observed digest differs. Coordinate any active-client restart after the
   existing critical release and saved acceptance evidence.

## Traceability and backlog coverage

The atomic deliverable `endpoint-input` maps to BI-E2CE164A. Requirements are
`AC-origin`, `AC-preservation`, `AC-isolation`, `AC-delivery`; contracts are
`explicit-mcp-endpoint`, `implicit-endpoint-preservation`; flows are
`standalone-updater`, `computeAgentToolchainPlan`; verification references are
`update_agent_toolchain_test.py`, `bridge.test.ts`.

Record immutable plan coverage before implementation and retain its receipt in
the Workroom. Research receipt: `initiative-11f4e582-eb9b-4d54-907d-7ce950cfba89`.

## Risks and rollback

Only root-origin shorthand changes meaning. An explicitly selected custom
non-root endpoint must retain its path/query. Reject unsafe values without
echoing them, changing authority, or partially applying host configuration.
Existing OAuth scope pins, bearer policy, plugin enable choices and unrelated
settings remain covered by their existing tests. Revert this PR through the
protected workflow if needed; no database migration or data rollback is involved.
