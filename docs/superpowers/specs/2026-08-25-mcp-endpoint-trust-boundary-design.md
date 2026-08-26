---
status: active
---
# MCP endpoint trust boundary (`BI-1819D34F`)

**OBJ-LOOPBACK:** An MCP endpoint resolved from on-disk config is loopback before a bearer token is sent.
**OBJ-STOP:** A config naming another host stops the run; it never falls back to the default endpoint.
**OBJ-INTENT:** Stated operator intent keeps reaching a non-loopback portal.

| AC-LOOPBACK-ACCEPT | OBJ-LOOPBACK | Every endpoint form the worktree sync script writes is accepted. |
| AC-REMOTE-REJECT | OBJ-LOOPBACK | Remote host, loopback-as-userinfo, loopback-as-subdomain, and non-HTTP forms are rejected. |
| AC-ALERT-CLOSED | OBJ-LOOPBACK | CodeQL `js/file-access-to-http` raises no alert on the merged analysis. |
| AC-REMOTE-STOP | OBJ-STOP | A remote `.mcp.json` raises an actionable error rather than returning the default endpoint. |
| AC-ENV-UNNARROWED | OBJ-INTENT | `DPF_MCP_URL` reaches a non-loopback endpoint unchanged. |

## Problem

CodeQL alert 388 (`js/file-access-to-http`, CWE-200, medium) traced file data into an outbound request: source `scripts/host-resource-runner.mjs` reading `.mcp.json`, sink the request URL in `scripts/lib/mcp-client.mjs`.

`readMcpConnection` falls back to `.mcp.json` when `DPF_MCP_BEARER_TOKEN` is unset, then passed `mcpServers.dpf.url` into `mcpCall` alongside the `dpfmcp_...` token from the same file. The URL was never checked.

This is exposure, not an analyser artifact. `.mcp.json` is ambient state: gitignored, copied between worktrees by `scripts/sync-mcp-worktrees.ps1`, writable by anything holding the checkout. A copied-in, stale or tampered file redirects a live read/write/admin credential to whatever host it names. Every other MCP caller under `scripts/` already resolved its endpoint from `DPF_MCP_URL` or the loopback constant, so this reader was the lone disk-sourced endpoint.

## Research and benchmarking

Three prior approaches were compared before choosing.

**Dismiss as a false positive.** The CodeQL workflow's own note says JS/TS false positives are dispositioned by dismissal-with-justification, because GitHub cannot honour a repo-local JS/TS model pack. Rejected: the flow the query describes is real, so dismissal would suppress a true finding.

**SSRF allowlists (OWASP SSRF Prevention Cheat Sheet; Go `net/http` and Python `requests` hardening guidance).** The standard shape is an allowlist applied to the parsed authority, never to the raw string, because userinfo and subdomain tricks defeat substring checks. Adopted: parse with `URL`, compare `hostname`, and reject non-empty `username`/`password`.

**Narrow every endpoint source, environment variables included.** Rejected: an environment variable is stated operator intent, and narrowing it would break a portal deliberately fronted off loopback while adding no protection against ambient file state. The trust boundary belongs at the disk read.

## Contract

`isAllowedMcpEndpoint(candidate)` in `scripts/lib/mcp-client.mjs`, the canonical MCP client, is the single source of endpoint trust. It accepts `http:`/`https:` on hostname `127.0.0.1`, `localhost` or `[::1]` — the forms `scripts/sync-mcp-worktrees.ps1` writes — with empty userinfo. Everything else is rejected.

`readMcpConnection` keeps its two lanes. The environment lane is unchanged and unnarrowed. The file lane runs the candidate through the guard and throws an actionable error naming the config path and the rejected endpoint; it never degrades to the default.

## Verification

Unit coverage sits in `scripts/host-resource-runner.test.mjs`, which the Repo Guard Loop runs. `scripts/lib/mcp-client.test.mjs` is a live-socket timing test held out of CI by `scripts/ci-policy-test-inventory-allowlist.txt`, so the guard's cases ride with the reader that motivates them. AC-ALERT-CLOSED is read from the CodeQL analysis on the merge commit.
