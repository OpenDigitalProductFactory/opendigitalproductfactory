---
status: draft
---

# Consumer MCP bootstrap design

Backlog item: `BI-ED1BBC9E`

Decision record: `DI-29D9F5D72C50`

## Problem

A release/consumer install has no source checkout. The Windows installer nevertheless tries to run `seed-worktree-mcp.ps1` and `dpf-bootstrap-agent-toolchain.ps1`; neither is in `/dpf-release-assets`. The POSIX installer skips agent bootstrap entirely in customer mode. Both paths can finish successfully while leaving an external agent with no token and no reachable DPF MCP server configuration.

Copying those scripts into the release is not a complete fix:

- `seed-worktree-mcp.*` requires a Git worktree and copies configuration from a source root.
- `dpf-bootstrap-agent-toolchain.*` imports contributor-only packages, skill-pack assets, Python/Node helpers, and worktree state.
- a consumer release intentionally contains none of that source substrate.

The first-turn promise therefore needs a source-free connection bootstrap, not a source bundle disguised as a script fix.

## Decision

Introduce `scripts/bootstrap-consumer-mcp-access.ps1` and `.sh` as the small, release-capable boundary for external MCP access. The scripts own only four operations:

1. reuse a still-valid `DPF_MCP_BEARER_TOKEN` when one is already persisted;
2. otherwise issue an audited, expiring Development token through the running portal container;
3. persist the secret using the host OS's established protected user-environment path; and
4. write env-backed MCP client descriptors into the install directory.

Both consumer installers invoke this bootstrap after the portal is healthy. The contributor toolchain also invokes it for token/bootstrap work, then continues with its source-only skill, memory, worktree, and smoke-test phases. This extraction is the deliberate refactoring portion of the change: token detection, issuance, persistence, and connection-file generation stop being duplicated inside the two large contributor scripts.

The kernel compared this with shipping the full contributor toolchain and retaining manual portal pairing. `principle_decide` recommended the thin shared bootstrap with high confidence and no commandment conflict (`DI-29D9F5D72C50`).

## Authority and token lifetime

The bootstrap token uses the existing `write` tier, which resolves to the canonical Development role template. It is never `admin`. This is the smallest existing tier that lets an external coding agent do governed development work rather than merely inspect it.

The token expires after 30 days. This is shorter than the issuer's current 90-day default, long enough for a first-install evaluation window, and compatible with the existing integer-day TTL contract. Its display name starts with `consumer-bootstrap-` and includes a timestamp, so Admin > Platform Development retains an honest audit trail and the operator can rotate or revoke it.

The installer must not print the plaintext token, write it into install state, embed it in `.mcp.json`, or add it to Compose `.env`. Only the portal issuer's raw stdout is captured, and logs show the token prefix at most.

## Idempotency and failure states

Before minting, the bootstrap checks the current process environment and the OS-specific persisted store. It probes the token against the local MCP endpoint with a read-only, no-argument tool call. A successful MCP response reuses the token and refreshes descriptors; an explicit authentication/expiry failure permits replacement. Network ambiguity does not destroy or replace a present token.

No token is minted when Docker or the portal container cannot be resolved. Bootstrap failure remains non-fatal to the portal install, but the installer must report a single actionable `MCP access not ready` state and must not mark `mcp_seed` complete. A rerun therefore retries instead of preserving a false success marker.

The scripts support a dry-run mode that performs no token issuance, persistence, or file writes. They never auto-revoke an existing operator token.

## Host persistence

### Windows

- Read the current process token, then the user-scoped environment variable.
- Persist with `[System.Environment]::SetEnvironmentVariable(..., 'User')` and update the current process environment.
- Never place the secret in the registry-facing install-state JSON or installer transcript.

### POSIX

- Store the export in `~/.dpf/mcp-token.env` created under `umask 077` and kept mode `0600`.
- Add one idempotent managed source line to the applicable shell startup files.
- Export the value for the remainder of the bootstrap process.

The POSIX installer sources the managed env file after a successful child bootstrap so later installer phases can use the same credential.

## Client descriptors

The bootstrap writes the two descriptors whose shapes are already canonical in `mcp-setup-snippets.ts` and verified by `mcp-host-writer.ts`:

- `<install>/.mcp.json` with `mcpServers.dpf`, HTTP transport, the full-catalog tier, and `Authorization: Bearer ${DPF_MCP_BEARER_TOKEN}`;
- `<install>/.vscode/mcp.json` with `servers.dpf` and `${env:DPF_MCP_BEARER_TOKEN}`.

The secret is referenced, not embedded. Files are replaced only when the managed `dpf` entry is absent or differs; unrelated servers are preserved. Client-global TOML is out of scope because safe TOML mutation is not available in the sourceless shell substrate. Codex and Claude sessions launched in the install directory consume the project descriptor; the portal continues to offer global-client snippets for operators who want them.

The TypeScript snippet builder remains the semantic source of truth. Contract tests pin the shell-emitted descriptor shape to the same endpoint, catalog tier, environment variable, and key names so cross-language drift fails CI.

## Release assembly

The two new bootstrap scripts are copied into the init stage and into `/dpf-release-assets/scripts/` before `SHA256SUMS` is generated. `scripts/check-release-asset-contract.test.mjs` treats both as required consumer assets and continues to prove the two-sided `COPY` plus release-bundle `cp` contract.

The existing worktree seeder and full contributor toolchain are not added to the consumer bundle. Their source-only responsibilities remain source-only.

## Installer integration

Windows replaces its impossible worktree/full-toolchain fallback with the consumer bootstrap for release installs. Contributor/customizer installs run the shared MCP bootstrap first and then the full contributor toolchain.

POSIX removes the assumption that customer installs do not need agent MCP access. All install modes run the shared connection bootstrap after portal health; contributor mode additionally runs the full toolchain.

The bootstrap is opt-out through the existing headless/dry-run conventions plus a narrowly named `DPF_SKIP_AGENT_MCP_BOOTSTRAP=1` environment override for operators whose security policy forbids automatic local credential issuance. Opt-out is explicit in output and never reported as ready.

## Verification

Tests must prove:

1. release assembly stages and packages both OS scripts before checksums;
2. a source-free fixture does not reference Git, workspace packages, pnpm, Python, or contributor memory;
3. missing token issues `write` with `--expires-days 30`, never `admin` or `never`;
4. a valid persisted token is reused and does not mint another row;
5. ambiguous endpoint failure preserves a present token and returns not-ready;
6. token output is absent from stdout, install state, descriptors, and Compose `.env`;
7. Windows user persistence and POSIX `0600` persistence are idempotent;
8. descriptor fixtures preserve unrelated MCP servers and use the canonical env-backed DPF shape;
9. consumer installer success marks MCP access ready only after the bootstrap succeeds;
10. contributor bootstrap delegates token/bootstrap work to the shared script and retains its source-only convergence phases.

Functional acceptance uses a release-shaped directory with no `.git`, `packages/`, or `node_modules`: start the portal, run the OS bootstrap, launch an MCP client from the install directory with a fresh environment, and complete a read call plus a governed Development-tier call. The token must appear in the portal audit list with the expected name, tier, and expiry.

## Non-goals

- bundling the DPF source tree, skill pack, or contributor memory in a consumer release;
- granting Admin authority automatically;
- inventing a new token tier or schema;
- writing unverified global configuration formats;
- replacing normal token rotation and revocation controls.
