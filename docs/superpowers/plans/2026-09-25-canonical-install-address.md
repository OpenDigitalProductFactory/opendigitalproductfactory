---
status: active
---

# Canonical install address: one origin, one connector, every client

Design: [MCP client self-authentication, section 12](../specs/2026-08-26-mcp-client-self-authentication-design.md#12-canonical-install-address-one-origin-one-connector-every-client). Epic: EP-24741BBF.

For agentic workers: one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` before any success claim, and `dpf-pr-with-dco` for handoff. Never test against the operator's real user environment, trust store or client configs; exercise writers in a temporary home and a disposable trust store.

## Backlog coverage

| Deliverable | BI | Design | Acceptance |
|---|---|---|---|
| S1 canonical https origin at install and upgrade | BI-6DC1CD5B | 12.4.1, 12.4.2 | BI AC-1..AC-5; AC-CANON-3 |
| S2 machine trust and persisted endpoint | BI-2D545A0C | 12.4.3 | BI AC-1..AC-4 |
| S3 one plugin-owned connector per client | BI-5201141C | 12.4.4 | BI AC-1..AC-4; AC-CANON-1 |
| S4 authorization server and scripted callers on the canonical origin | BI-8A562681 | 12.4.5 | BI AC-1..AC-3 |
| S5 remote agent join command | BI-60A85892 | 12.4.6, 12.5 | BI AC-1..AC-4; AC-CANON-4 |
| S6 Grok credential without a paste | BI-5BCDB07C | 12.4.7 | BI AC-1..AC-3; AC-CANON-2 |

Order: S1, then S2 and S4 in parallel, then S3, then S5. S6 can start after S1. AC-CANON-5 is verified once, after S3, on the live install.

## S1 — canonical https origin (BI-6DC1CD5B)

1. Red: installer contract tests for the origin choice order (explicit DNS name > resolvable machine DNS name > `https://localhost`), `PUBLIC_URL_ALIASES`, and the certificate name set. Put the choice in one pure module shared by `install-dpf.ps1` and `install-dpf.sh` callers (PowerShell and bash twins stay thin; the module is the rule).
2. Red: `bootstrap-organization-pki.ps1`/`.sh` reissue when the requested SAN set differs from the current certificate's; `step ca token` carries `--ca-url`; compose uses the install's own compose file set (from install state or the running portal's compose labels).
3. Green: installer runs the PKI bootstrap in authority mode by default, writes `PUBLIC_URL`/`PUBLIC_URL_ALIASES`, starts `portal-tls`, and binds 80/443/8443 through `DPF_HOST_BIND_ADDRESS`.
4. Upgrade path (`scripts/installer/install-release-assets.mjs`, `scripts/promote.sh`): an install without `PUBLIC_URL` converges to the same state; record that each client re-consents once.
5. Verify on the canonical runtime through `/ops/self-upgrade`: OAuth discovery documents advertise the https issuer; the browser opens the canonical origin without a warning after S2.

## S2 — machine trust and endpoint (BI-2D545A0C)

1. Red: tests in a temporary home for persistence of `DPF_MCP_URL` (`<PUBLIC_URL>/api/mcp/v1?tier=full`) and `NODE_EXTRA_CA_CERTS`, and idempotent trust-store insertion (fake store adapter per OS).
2. Green: installer (not only the agent-toolchain bootstrap) adds the root to the machine store (Windows LocalMachine Root via `certutil -addstore`, macOS System keychain, Linux system CA dir plus `update-ca-certificates`/`update-ca-trust`) and persists the two variables. Remove the circular "only when `DPF_MCP_URL` is already https" condition in `dpf-bootstrap-agent-toolchain.ps1:67-85` by reading `PUBLIC_URL` from the install `.env`.

## S3 — one connector per client (BI-5201141C)

1. Red: descriptor tests (`update_agent_toolchain_test.py`, `hooks/mcp-catalog-profile.test.mjs`) assert every shipped descriptor is URL-only on https with `${DPF_MCP_URL:-...}`; the checked-in `claude.mcp.json` equals the https generator output.
2. Green: regenerate `claude.mcp.json`, `antigravity.mcp.json`, `grok.mcp.json` (Grok keeps its bearer until S6); Codex home config stays the only Codex connector.
3. Retire second writers: `mcp-host-writer.ts` stops writing `.mcp.json`/`.vscode/mcp.json` in OAuth mode; bootstrap stops planning the repo `.mcp.json` for Claude when the plugin is installed; `seed-worktree-mcp` and `sync-mcp-worktrees` stop copying it; untrack the repo `.mcp.json` (already in `.gitignore`) and remove the `.claude/settings.json` enablement. Move the `.mcp.json` readers (`ux-audit/dpf-mcp-client.ts`, `code-intelligence-benchmark.ps1`, `host-resource-runner.mjs`) to `DPF_MCP_URL`.
4. Correct `docs/architecture/mcp-tool-authorization-runbook.md:64-65` (match by endpoint; one connector) and the stale "advertises only `dpf.read`" comments (`mcp-client-credential-policy.ts:35-38`).
5. Verify: a restarted Claude Code session on the live install shows one `dpf` server namespace, OAuth-authenticated.

## S4 — canonical origin accepted (BI-8A562681)

1. Red: `oauth-policy` DCR allowed for loopback and the configured canonical origin, refused otherwise; `mcp-client.mjs` allows the `PUBLIC_URL` origin; hooks read `DPF_MCP_URL`.
2. Green: implement; add `--cacert "$NODE_EXTRA_CA_CERTS"` to `session-reaper.sh`; make `mcp-health` resolve `DPF_MCP_URL`, then the plugin default, and stop warning when the repo `.mcp.json` is absent.

## S5 — remote agent join (BI-60A85892)

Blocked on the operator decision in design 12.5 for networks without DNS. For networks with a DNS name:
1. Red: bootstrap `--install-url --ca-fingerprint` fetches the root, refuses a fingerprint mismatch, trusts the root in a disposable store, persists `DPF_MCP_URL`.
2. Green: implement in both bootstrap twins; the portal shows the command (Admin > Platform Development) using the canonical origin and the root fingerprint; UX-fit review for the new card.

## S6 — Grok credential (BI-5BCDB07C)

1. Red: container-side script creates a `credentials` client idempotently for the operator; refresher exchanges and rewrites the Grok credential before expiry; revocation stops it.
2. Green: implement, reusing `scripts/lib/mcp-credential.mjs` `exchangeClientCredentials` and the PAT auto-mint container pattern.

## Completion gate per slice

Unit tests for touched packages, `pnpm pregate:preflight`, `pnpm pregate`, DCO-signed PR through the merge queue, then live verification on the canonical runtime recorded as execution evidence on the slice's BI. Written configuration is not evidence of an authenticated connection (runbook line 57).
