---
status: active
---

# Recover the persisted MCP endpoint during bootstrap

BI-9F258707 · WC-2552ADE3 · delivery-small@1.0.0

## Existing contract and reproduction

Extend [canonical install address section 12](2026-08-26-mcp-client-self-authentication-design.md#12-canonical-install-address-one-origin-one-connector-every-client) and its S2 implementation BI-2D545A0C. The original BI-9F258707 suggestion to retain insecure per-client endpoints predates machine trust provisioning; this repair follows the existing canonical HTTPS design instead. It does not add trust, credentials or grants.

At source 156d212f363f0433d8a7b60ef4e08dae5d537a12, controlled resolver execution with no checkout PUBLIC_URL and no inherited DPF_MCP_URL returns no endpoint, so bootstrap selects HTTP. Supplying either HTTPS PUBLIC_URL or an explicit HTTPS DPF_MCP_URL succeeds. Native Codex reports the HTTP loopback endpoint despite the saved client environment containing HTTPS. Research receipt: initiative-b9902607-93e6-46e4-bf21-b513b9610393.

## Ordered implementation and acceptance

One atomic repair, owned by BI-9F258707. These steps are not independently shippable.

1. **REQ-ENDPOINT**: add failing resolver regressions for a process without DPF_MCP_URL and a persisted HTTPS endpoint; preserve explicit process overrides and install HTTPS precedence.
2. **CONTRACT-PERSISTED**: extend the existing bash and PowerShell resolver twins. Resolve install HTTPS origin, then explicit process endpoint, then persisted user endpoint. POSIX reads only managed export values as data, never sources or evaluates the file. Windows reads the existing User environment. Recover persisted Node CA bundle only for HTTPS, preserving explicit/install bundle precedence. Missing saved state retains existing fallback behavior.
3. **FLOW-BOOTSTRAP**: the existing bootstrap and installer callers consume this resolver. Preserve OAuth mode and every credential/grant. Document the cross-platform recovery in the support watchlist.
4. **VERIFY-CONVERGENCE**: run resolver tests with missing/stale process context, precedence, quoted paths, malicious shell text, missing saved state and Windows twin coverage where a host exists. Run source guards, independent semantic review, canonical integration and required cloud checks; publish a DCO-signed PR through the merge queue. Apply supported bootstrap on this Mac in OAuth mode and verify the native CLI's actual endpoint and a stable repeated run. Do not claim Windows runtime or authenticated OAuth consent without executing it.

## Risk and rollback

A stale saved endpoint is lower priority than explicit install/process configuration. Read saved exports without executing shell code or reading credentials. The default CA file remains the final candidate. Reverting the source restores earlier resolution; operators can use the existing explicit endpoint override. Do not remove OAuth tokens, alter grants, or weaken certificate validation.

## Backlog coverage

Atomic mapping: REQ-ENDPOINT, CONTRACT-PERSISTED, FLOW-BOOTSTRAP and VERIFY-CONVERGENCE all map to BI-9F258707. The immutable coverage receipt is recorded through DPF MCP before implementation.

## Change impact

The Workroom impact contract has no additional testImpact or guardObligation entries. Required gates are pregate:preflight, exact-tree pregate and pr:health; install changes require a Convergence-Impact-Decision trailer. Documentation index generation is managed by the existing documentation pipeline. No database migration or portal UI change.

## Project override follow-through (BI-9F258707)

The persisted-endpoint repair did not cover a repository's `.codex/config.toml`.
Native readback from the root checkout still selects HTTP while the same binary
in the worktree selects HTTPS. Global configuration alone cannot establish
convergence. This section extends the same atomic endpoint repair.

1. **REQ-PROJECT-ENDPOINT**: when a repository-local Codex configuration already
   declares `mcp_servers.dpf`, converge that block to the resolved canonical
   endpoint. Preserve disabled intent, unrelated configuration and credentials;
   use the existing credential policy. Do not create a local override when none
   exists, scan unrelated repositories, or treat malformed TOML as empty.
2. **CONTRACT-PROJECT-CONFIG**: extend the existing TypeScript planner/bridge and
   standalone Python updater. The bridge knows `repoRoot`; repository updater
   wrappers and bootstrap fallback calls pass an explicit project directory. A standalone
   installed updater without an explicit project directory only manages global
   state. Bash and PowerShell adapters apply the same plan.
3. **FLOW-PROJECT-CONVERGENCE**: global endpoint resolution precedes scoped local
   block convergence. A second run is a no-op. A malformed project file reports
   incomplete convergence instead of a successful readiness result.
4. **VERIFY-PROJECT-CONFIG**: add regressions in
   `packages/dpf-bootstrap/src/agent-toolchain/__tests__/codex-config.test.ts`,
   `packages/dpf-bootstrap/src/agent-toolchain/__tests__/bridge.test.ts` and
   `packages/dpf-skill-pack/scripts/update_agent_toolchain_test.py` for stale
   HTTP, custom unrelated configuration, disabled DPF, no project file/no DPF
   block, malformed TOML, and repeat-run stability. Resolve graph-linked tests
   for bridge.ts, codex-config.ts and update_agent_toolchain.py before Red;
   unavailable graph advice expands to the full package/updater suites. Run
   bootstrap typecheck, the required source guards, exact-tree gate or recorded
   authorized infrastructure override, cloud CI and pr:health. After delivery,
   bootstrap the root checkout and verify its native effective endpoint.
   Windows native/fresh-install/renewal claims require actual execution and
   remain unrun until such evidence exists.

Changes touch the bridge and Codex planner, their tests, Python updater/tests,
and the repository updater/bootstrap wrappers plus the packaged PowerShell argument adapter.
Project TOML validation uses the TypeScript parser or Python standard-library
`tomllib` (with `tomli` when already available on older Python). If a project
file exists and neither parser is available, stop with an explicit diagnostic;
never rewrite an unvalidated file. No credential grant, trust provisioning,
DB migration, or plugin-uninstall operation is part of this endpoint change.
Rollback is a source revert; retain local configuration for operator recovery.
REQ-PROJECT-ENDPOINT, CONTRACT-PROJECT-CONFIG, FLOW-PROJECT-CONVERGENCE and
VERIFY-PROJECT-CONFIG form one atomic deliverable under BI-9F258707. Updated
immutable backlog coverage is required before source implementation.

Coverage receipt: `cmv68u5ty08wb01laytsfyfhy` binds the atomic project endpoint deliverable to BI-9F258707 at commit `c54d5b479b4d85d92f4835c6bbdbd7fd2e15ac65`. No external dependency BI is required.
