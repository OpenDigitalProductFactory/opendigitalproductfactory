# OAuth defaults for MCP client setup

Owner: BI-A5307F9E. Design: [MCP client self-authentication, section 11](../specs/2026-08-26-mcp-client-self-authentication-design.md#11-oauth-setup-convergence--bi-a5307f9e).

For agentic workers: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the completion gate below before any success claim, and `dpf-pr-with-dco` for handoff.

## Contract and traceability

One atomic deliverable, `oauth-setup-convergence`, implements AC-1 through AC-6 on BI-A5307F9E and the design's AC-OAUTH-DEFAULT, AC-OAUTH-RERUN, AC-OAUTH-CLIENTS, AC-OAUTH-LEGACY, AC-OAUTH-STATE and AC-OAUTH-REINSTALL. It serves OBJ-OAUTH-SETUP and OBJ-OAUTH-COMPAT. The shared credential policy is the contract; the affected flow is fresh setup followed by authorization and repeated bootstrap/update. Verification is the configuration-generation, idempotence, explicit-compatibility and readiness matrix below. Reinstall verification stays pending by operator instruction.

No stage is independently shippable: an unchanged bootstrap or updater can restore a bearer override and defeat another writer's OAuth default. The operator requested the complete default across future installs. The stages are internal sequencing of this one deliverable, not separate backlog work.

## Stage 1: policy and regressions

Claim the exact source/test paths and consume the returned impact contract before editing. Resolve every testImpact through related-test lookup; if unavailable, record that limitation and use colocated tests and a bounded source search. Unresolved impact expands verification. Include every returned guard obligation.

Extend `packages/integration-shared/src/mcp-client-credential-policy.ts`, keeping endpoint/client/explicit compatibility selection pure. Codex supports HTTPS and loopback HTTP OAuth. Preserve other clients' established compatibility behavior where OAuth support is unproven; report that requirement. Never imply remote HTTP is secure OAuth. Explicit legacy mode may retain credential references but does not revoke or broaden tokens.

First add failing tests for HTTPS, localhost, IPv4/IPv6 loopback, remote HTTP, malformed URLs, fresh config, repeated runs and explicit compatibility. Include preservation of unrelated settings. Run the new tests against the old implementation and record the expected failures.

## Stage 2: converge all writers

Update the existing Codex, Grok and generic MCP planners under `packages/dpf-bootstrap/src/agent-toolchain/`, their bridge inputs, and `apps/web/lib/auth/mcp-setup-snippets.ts` to consume the policy. Token-issuance snippets remain explicit compatibility output; interactive setup must not silently pin the issued PAT. Inspect all callers so setup semantics remain explicit.

Update `packages/dpf-skill-pack/scripts/update_agent_toolchain.py` and shipped `codex.mcp.json`, `grok.mcp.json`, `claude.mcp.json`, `antigravity.mcp.json` descriptors consistently. Add a shared fixture matrix consumed by TypeScript and Python tests so the necessary language mirror cannot drift silently. Preserve user-disabled plugins and unrelated MCP configuration.

Allocate roughly 20% of implementation effort to consolidating duplicated credential decisions and verifying adapter agreement. This is a refactor within the existing policy, not a new authentication subsystem.

## Stage 3: bootstrap and truthful readiness

Update `scripts/dpf-bootstrap-agent-toolchain.ps1` and `.sh` plus their bridge CLI plumbing. Default interactive setup must not automatically mint a PAT because OAuth consent is pending. Preserve an explicitly selected legacy mint route and the existing headless client-credentials path. Do not read or rewrite the operator's real OAuth token store in automated tests.

Extend existing readiness types/copy and adapter projections to distinguish configuration written, authorization pending, and authenticated verification. A PAT probe must not be presented as verification of the client's OAuth session. Unsupported client/transport combinations must receive actionable compatibility guidance. Apply the DPF UX review to the setup messages and their remediation actions.

## Stage 4: verification and delivery

Run affected bootstrap Vitest suites, shared-policy tests, setup-snippet tests, and `update_agent_toolchain_test.py`. Exercise generation and reruns in temporary homes, including preexisting bearer config and unrelated user settings. Check PowerShell parsing, POSIX syntax, TypeScript, source guards and derived artifacts. Update install guidance and the MCP authorization runbook with the exact compatibility flags and authorization steps implemented.

Run the required exact-tree prepublication gate and independent semantic review; use the canonical shared lease for runtime-bound verification. Open a merge-ready DCO PR, inspect `pnpm pr:health`, and merge only through the protected queue. Advance the installed runtime only through its governed self-upgrade path if needed for shipped assets.

The live OAuth handoff already completed on deployed revision 2e226dd6584c3dbc51e67ab6787523de2099a0e0 and persisted research receipt initiative-f1168cc4-3162-41c6-8aac-2fe33de404d7. This is evidence for governed handoff writes, not fresh install, refresh, every external task, or direct author-receipt authority. Recheck affected live behavior after delivery. Keep AC-6 / AC-OAUTH-REINSTALL pending for the operator's planned reinstall, including consent, restart, refresh and governed reads/writes; no teardown is authorized by this plan.

## Risks and rollback

The main risks are updater drift restoring bearer overrides, an unsupported host receiving unusable OAuth config, loss of user settings, and a misleading ready banner. The matrix and explicit capability/compatibility selection address these risks. Source revert restores prior generator behavior; existing credentials and consent remain intact. No migration or authorization widening is needed.

## Backlog coverage

Implementation parent and sole deliverable owner: BI-A5307F9E. Deliverable `oauth-setup-convergence` has no dependencies and is atomic for the reason above. Live coverage must be recorded against this immutable plan before implementation; the current text does not claim a passing coverage receipt.
