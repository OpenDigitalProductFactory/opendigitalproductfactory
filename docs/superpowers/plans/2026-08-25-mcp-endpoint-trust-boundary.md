---
status: binding
---

# MCP endpoint trust boundary implementation plan

**Backlog item:** `BI-1819D34F`
**Workroom:** `WC-710F9E03`
**Design:** `docs/superpowers/specs/2026-08-25-mcp-endpoint-trust-boundary-design.md`

## Delivery slice

One atomic repair: constrain the endpoint that `scripts/host-resource-runner.mjs` resolves from `.mcp.json` before the bearer token from that same file is put on the wire.

The guard, the reader that calls it, and the two documentation surfaces ship together. They are not independently shippable: a guard nothing calls changes no behaviour, and a reader that stops on a remote endpoint without saying why in the runbook and the contributor guide leaves an operator stuck. Acceptance is one boundary — the CodeQL alert closes and no existing install changes behaviour.

## Baseline traceability

The atomic deliverable traces to objectives `OBJ-LOOPBACK`, `OBJ-STOP` and `OBJ-INTENT`; contracts `docs/superpowers/specs/2026-08-25-mcp-endpoint-trust-boundary-design.md` and `AGENTS.md` §1 (an enforcement refusal is a stop) and §6 (token scopes and local credential files); flows the `pnpm dev` / `build` / `test` / `typecheck` scripts that enter through the governed runner; and acceptance statements `AC-LOOPBACK-ACCEPT`, `AC-REMOTE-REJECT`, `AC-ALERT-CLOSED`, `AC-REMOTE-STOP` and `AC-ENV-UNNARROWED`.

## Backlog coverage

- Decision: atomic
- Parent: `BI-1819D34F`
- Constrain the file-resolved MCP endpoint to loopback before the bearer token is sent -> `BI-1819D34F`
- Dependencies: none
- Rationale: the guard, its single caller, and the operator-facing explanation share one acceptance boundary and must land together.

## Phase 1: Establish the trust boundary

- Add `isAllowedMcpEndpoint` to `scripts/lib/mcp-client.mjs`, the canonical MCP client and the module that owns the request sink.
- Accept `http:`/`https:` on hostname `127.0.0.1`, `localhost` or `[::1]` with empty userinfo; reject everything else.
- Validate the parsed authority, not the raw string, so loopback-as-userinfo and loopback-as-subdomain forms cannot pass.

## Phase 2: Apply it at the disk read

- Split `readMcpConnection` so the environment lane stays untouched and the file lane is separable.
- Run the file-resolved endpoint through the guard; throw an actionable error naming the config path and the rejected endpoint.
- Never degrade to the default endpoint on rejection — a refusal is a stop.

## Phase 3: Cover the boundary

- Extend `scripts/host-resource-runner.test.mjs`, which the Repo Guard Loop runs, rather than `scripts/lib/mcp-client.test.mjs`, which `scripts/ci-policy-test-inventory-allowlist.txt` holds out of CI.
- Cover each acceptance statement: accepted loopback forms; rejected remote, userinfo, subdomain and non-HTTP forms; the seeded-config happy path; the remote-config stop; an absent config still reading as admission failure; and `DPF_MCP_URL` left unnarrowed.

## Phase 4: Say it where operators read

- State the rule in `docs/architecture/mcp-tool-authorization-runbook.md`, beside the existing statement that `.mcp.json` is a local credential file.
- Point to it from `docs/user-guide/contributing/agent-dev-environments.md`, where contributors meet `.mcp.json` and could hit the stop.
- Regenerate `apps/web/lib/docs/doc-impact.generated.json`: citing a code path in a doc adds a code-to-doc edge.

## Verification

- `node --test scripts/host-resource-runner.test.mjs` green, including every acceptance case above.
- `node --test scripts/lib/mcp-client.test.mjs scripts/agent-host-resource-charter.contract.test.mjs` green.
- Docs Impact Gate, plan-backlog-coverage, design-grounding and the Derived Artifact Registry clean against committed history — these gates read commits, not the working tree.
- Cloud CI carries the heavy build; `Analyze (javascript-typescript)` on the merge commit is the AC-ALERT-CLOSED reading.

## Retrospective note

The fix shipped before this plan was written. The repair landed as a direct response to the code-scanning alert, and the scope baseline, plan and reconciliation were authored afterwards to close `BI-1819D34F` through the initiative-readiness gate. Recorded here so the sequence is legible rather than implied: plan-then-build remains the rule, and this item did not follow it.
