---
title: Contributor Client MCP Readiness for Build Studio
status: revised-for-implementation
author: Codex
reviewers:
  - Claude (chief architect + UX review, 2026-05-26)
date: 2026-05-26
related:
  - docs/superpowers/specs/2026-05-18-mcp-governance-flow-token-scope-design.md
  - docs/superpowers/specs/2026-05-21-tak-gaid-protocol-profiles-supervisor-control-design.md
  - docs/superpowers/specs/2026-04-11-platform-mcp-tool-server-design.md
  - packages/dpf-skill-pack/README.md
  - AGENTS.md
---

# Contributor Client MCP Readiness for Build Studio

## Purpose

Make Claude Code and Codex feel seamlessly connected to DPF through the DPF MCP
server without hiding the authority model that keeps the platform safe.

The target user experience is simple: Build Studio should be able to say whether
the current install is ready for external contributor clients to use
`/api/mcp/v1`, and when it is not ready, guide the operator through the smallest
governed fix. The target architecture is stricter: peer access is gated by the
human operator's RBAC, the non-human peer identity's GAID posture, and the MCP
token's enforced access controls.

## Review summary (2026-05-26, chief architect + UX)

The original draft is directionally right: a readiness projection over the
existing token machinery, surfaced compactly in Build Studio, with all token
issuance, rotation, and revocation remaining in Admin > Platform Development >
MCP. The substrate already carries everything the read model needs — the
`development` MCP token template, granular scopes, the `kind` lifecycle field,
the `lastUsedAt` signal, and the `structuredContent.error =
"insufficient_token_scope"` contract on `/api/mcp/v1`.

This revision tightens the design in five places:

1. **Probe vs refresh.** Replaces the `/api/mcp/token/refresh` acknowledgment
   check with a live, **non-mutating** MCP probe (`tools/list` against
   `/api/mcp/v1` with the operator's current token). `/api/mcp/token/refresh`
   is a client-environment binding endpoint, not a server readiness signal —
   they are not the same thing. Dynamic analysis is the evidence.
2. **Readiness threshold vs issued grants.** Calls out that the development
   template grants a broader superset than this readiness contract requires.
   Readiness asserts the minimum grant subset Build Studio Claude/Codex work
   actually needs; the token may legitimately carry more.
3. **File location.** Moves the read model from `apps/web/lib/auth/` to
   `apps/web/lib/mcp/contributor-readiness.ts`, next to `mcp-token-scopes.ts`
   — `auth/` is already crowded with token-issue and host-writer machinery.
4. **PrincipalAlias shape.** Recommends the natural
   `(aliasType="mcp_client", aliasValue="claude-code" | "codex")` shape rather
   than a colon-namespaced `mcp_client:claude-code` string crammed into
   `aliasType`. Matches the existing `edge_node` precedent.
5. **Explicit kernel principles enforced.** Adds a section binding this design
   to the relevant founder-kernel principles so the reviewer gate has a
   citation to score against.

## Problem

DPF now has the right pieces, but the operator still has to mentally stitch them
together:

- Claude Code and Codex plugins can carry skills and MCP server configuration.
- The DPF skill pack ships Claude and Codex MCP descriptors that point at the
  DPF MCP endpoint and read `DPF_MCP_BEARER_TOKEN`.
- Admin > Platform Development > MCP can issue scoped MCP tokens from role
  templates, including the development template.
- The MCP server enforces token scope and granular grants at call time.
- Build Studio increasingly expects external contributor work to flow back
  through governed records rather than chat memory.

The missing product layer is readiness. The platform should answer, in one
place, whether Claude/Codex can use the DPF MCP server for the Build Studio work
at hand. A token list is necessary but not sufficient; it exposes the parts
without explaining whether the whole connection is usable.

## Research and Benchmarking

### External patterns

- Claude Code plugins are the shareable packaging unit for skills, agents,
  hooks, MCP servers, LSP servers, and monitors. The docs explicitly position
  plugins as the team/project distribution path, while standalone config is for
  personal or one-off workflows. See
  [Claude Code: Create plugins](https://code.claude.com/docs/en/plugins) and
  [Claude Code: Plugins reference](https://code.claude.com/docs/en/plugins-reference).
- OpenAI's Codex plugin guidance describes plugins as a way to connect Codex to
  external tools and sources of information, while skills teach repeatable
  workflows. See
  [OpenAI Academy: Plugins and skills](https://openai.com/academy/codex-plugins-and-skills/).
- The MCP authorization specification treats HTTP MCP servers as protected
  resources accessed with bearer access tokens on behalf of resource owners. It
  makes authorization transport-level and token-mediated, which matches DPF's
  choice to enforce access inside `/api/mcp/v1`. See
  [Model Context Protocol Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).

### DPF patterns to adopt

- `packages/dpf-skill-pack/README.md` already makes the plugin the project
  default for Claude Code and Codex. It correctly keeps plugin wiring in git and
  token issuance outside git.
- `apps/web/lib/mcp-token-scopes.ts` already defines the development token
  template as a write-tier grant bundle for coding-agent and Build Studio loops.
- `apps/web/lib/actions/mcp-tokens.ts` already centralizes token issue, rotate,
  copy, and setup-snippet behavior. Readiness must reuse these actions rather
  than minting a new token path.
- `docs/superpowers/specs/2026-05-21-tak-gaid-protocol-profiles-supervisor-control-design.md`
  frames MCP as the tool/data carrier while TAK governs runtime authority and
  GAID preserves identity and receipts.

### Anti-patterns to reject

- Do not add token issuance UI to every AI agent or coworker.
- Do not silently auto-upgrade tokens when a call needs broader access.
- Do not treat a bearer token as merely a local setup detail. In DPF, the token
  carries enforced access control: coarse scope plus granular grants.
- Do not ask the operator to repair Claude/Codex setup by copying scattered
  commands from docs when the platform already knows the correct token template
  and setup snippets.

## Decision

Build Studio and Platform Development should share a **Contributor Client MCP
Readiness** read model and remediation flow.

Platform Development remains the system of record for token issuance, rotation,
revocation, and setup snippets. Build Studio consumes a readiness projection so
it can keep the human workflow simple:

- Ready: Claude/Codex DPF MCP access is available for development work.
- Needs authorization: issue a development token.
- Needs reissue: the best candidate token is expired or revoked, so issue a
  replacement development token rather than rotating the unusable row.
- Needs client refresh: token exists, but the current client/env refresh has not
  been acknowledged.
- Needs grants: token exists, but the enforced access controls do not cover the
  workflow.
- Needs identity binding: token access is not tied to the expected non-human
  peer identity/GAID posture.

## Access Model

The readiness check must evaluate the full chain. **All checks are
non-mutating**: the read model and the live probe issue no writes, advance no
state, and never auto-issue or auto-rotate tokens behind the operator's back.

1. **Human RBAC**: the signed-in operator can manage contributor MCP access.
2. **Peer identity**: the Claude/Codex peer is represented as a governed
   non-human identity with GAID/AIDoc posture, or the readiness state explicitly
   reports that this binding is not yet available.
3. **Token lifecycle**: the operator owns at least one `kind = "operator"`
   token that is active, unexpired, and not revoked. `kind =
   "ephemeral_ship"` tokens (build-lifecycle managed; see
   `apps/web/lib/auth/ephemeral-ship-tokens.ts`) are excluded from
   contributor-client readiness — they are issued and revoked by the build
   phase machinery, not by the operator.
4. **Token authority tier**: the token has the required coarse `scope`
   (`read`, `write`, or `admin`) for the intended workflow. For Build
   Studio-oriented Claude/Codex work the required tier is `write` or higher,
   because the workflow needs `backlog_write` and `work_capsule_write`.
5. **Token grants**: the token `scopes[]` include the granular grants required
   by the workflow (see *Required Grants for Development Readiness* below).
   The development template legitimately bundles a broader superset of grants;
   readiness asserts the minimum subset, not template-equivalence.
6. **Client wiring**: Claude Code and Codex can both resolve the same
   `DPF_MCP_BEARER_TOKEN` contract and target the canonical `/api/mcp/v1`
   endpoint. The skill pack's `claude.mcp.json` / `codex.mcp.json` descriptors
   are the contract — the readiness check confirms they are present and
   reference `${DPF_MCP_BEARER_TOKEN}`.
7. **Live probe (when available)**: the read model can issue an authenticated,
   read-only MCP request — `tools/list` against `/api/mcp/v1` with the
   operator's current token — and confirm it returns `200` with a non-empty
   tool catalog. This is the strongest ready signal: it proves the token is
   actually accepted by the running MCP server end-to-end, not merely
   structurally valid. The probe is rate-limited (one per minute per token)
   and cached.

`/api/mcp/token/refresh` is a separate mechanism: it binds a freshly-issued or
rotated token to a running agent client's process environment. The readiness
surface should expose it as the **post-issue** action on the same card, not
conflate it with the live probe.

This does not replace the MCP server's call-time enforcement. Readiness is a
preflight and remediation surface; `/api/mcp/v1` remains authoritative on every
tool call.

## User Experience

### Build Studio surface

Add a compact readiness row to the Build Studio configuration surface
(`apps/web/components/platform/BuildStudioConfigForm.tsx`, above the Build
Dispatch Engine section so the operator sees it before selecting a CLI
provider):

- **Ready** — quiet success state. One line: "Claude Code and Codex can use
  DPF MCP for Build Studio work." Inline metadata: last used (relative time
  from `lastUsedAt`), expiry (relative time), and an unobtrusive
  `Test connection` button that runs the live probe and reports the result
  in-line.
- **Action needed** — single primary button with the smallest correct next
  action, drawn from the table below. Never offer more than one primary
  action; secondary affordances live in the disclosure panel.
- **Details** — disclosure panel showing the granular grants, the missing
  grants (if any), the client snippets, the runtime refresh snippet, and a
  link to Admin > Platform Development > MCP for full management.

| Readiness state            | Primary action            | One-line copy                                                                  |
| -------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `ready`                    | `Test connection`         | "Ready. Last used <X> ago."                                                    |
| `needs_authorization`      | `Issue development token` | "No usable token yet — issue a development token to enable Build Studio MCP."  |
| `needs_reissue`            | `Issue development token` | "Current token is expired or revoked — issue a replacement development token." |
| `needs_grants`             | `Rotate development token`| "Current token is missing <N> grants needed for Build Studio work."            |
| `needs_client_refresh`     | `Refresh client`          | "New token issued — bind it to the running Claude/Codex session."              |
| `needs_identity_binding`   | (disclosure only)         | "Token works, but the Claude/Codex peer identity is not GAID-bound yet."       |

The `Test connection` affordance is the dynamic-analysis signal — it must
actually call `/api/mcp/v1` (read-only `tools/list`) with the current token
and report the response. Static field checks are necessary but not sufficient
evidence per the kernel principle `structural-verification-is-not-functional`.

The main Build Studio workspace should not become an access-management page. It
may show a small status chip only when external contributor handoff is relevant.

### Platform Development surface

Keep Admin > Platform Development > MCP as the full management surface. Improve
the development-token path so it reads as a guided Claude/Codex setup:

- one-click development token issue/rotation,
- existing Claude Code and Codex snippets,
- session refresh snippet,
- clear status for active, stale, expired, revoked, and lifecycle-managed
  tokens,
- explicit warning when a token does not satisfy the contributor-client
  readiness contract.

### Error handling

When `/api/mcp/v1` returns `structuredContent.error =
"insufficient_token_scope"` with a `requiredScope`, the user-facing recovery
should be the same readiness flow. The message should name the missing access
briefly and offer the fix action.

It must **never** tell the operator to use `psql`, Prisma scripts, direct DB
edits, hand-edited `.mcp.json` files, or any other path that bypasses the
governed token machinery — per AGENTS.md §8 ("Scope escalation rule") and the
kernel principle `never-ask-user-to-run-commands`. The correct recovery is
always: issue or rotate a scoped token through this readiness surface (which
delegates to the existing `mcp-tokens.ts` actions), then `Refresh client`.

Note: the `requiredScope` value returned by `/api/mcp/v1` is the coarse tier
(`"read"` / `"write"` / `"admin"`), not a granular grant key. The readiness
read model computes the missing granular grants client-side by diffing the
token's `scopes[]` against the required-grants list — that diff is what the
disclosure panel shows.

## Data and Code Shape

The first implementation should avoid schema churn unless GAID binding cannot be
represented with existing `Principal` / `PrincipalAlias` records. Inspection of
the current schema confirms `PrincipalAlias` is a free-form
`(aliasType, aliasValue, issuer)` triple — adequate for an MCP-client peer
identity without migration.

Recommended components:

- `apps/web/lib/mcp/contributor-readiness.ts` *(new — colocated with
  `mcp-token-scopes.ts`, not under `apps/web/lib/auth/` where token-issue,
  ephemeral-ship, and host-writer machinery already live)*
  - exports a pure async function
    `getContributorMcpReadiness(userId: string, opts?: { probe?: boolean }): Promise<ContributorMcpReadiness>`
  - composes over `listMcpApiTokens`, the `development` template grants,
    `getToolGrantMapping`, and (when `probe: true` and within the rate-limit
    window) a single `tools/list` MCP call
  - exports `ContributorMcpReadiness` discriminated union: `ready`,
    `needs_authorization`, `needs_reissue`, `needs_grants`,
    `needs_client_refresh`, `needs_identity_binding`
  - **never mutates** — no issue, rotate, revoke, or refresh side-effects
- `apps/web/lib/actions/mcp-tokens.ts`
  - add a thin server action `getMyContributorMcpReadiness({ probe?: boolean
    })` that resolves the session user and delegates to the pure function
  - keep token issue/rotate/revoke behavior in the existing actions —
    readiness *reads*, the existing actions *write*
- `apps/web/components/platform/ContributorMcpReadinessCard.tsx` *(new)*
  - compact Build Studio card/row using the existing theme tokens
    (`var(--dpf-surface-1)`, `var(--dpf-border)`, `var(--dpf-text)`,
    `var(--dpf-accent)`, `var(--dpf-success)`, `var(--dpf-warning)`,
    `var(--dpf-error)`) — the sole exception of `color: "white"` on a
    `bg-var(--dpf-accent)` primary button applies per AGENTS.md §12
  - calls the existing issue/rotate/setup-snippet actions; never opens a new
    token issuance path
- `apps/web/components/admin/McpTokenManager.tsx`
  - reuse the readiness read model for a development-token status banner that
    matches the Build Studio card's verdict — one source of truth across both
    surfaces

If the GAID identity binding is not yet implemented for external contributor
clients, the read model should report `identityBinding: "not_available"` rather
than fabricating a binding. That state is acceptable for an initial readiness
slice if the token access controls still enforce the actual tool grants.

### PrincipalAlias shape for MCP-client peer identity

When the GAID binding is implemented, model each external contributor client
as one `Principal` (`kind = "non_human"`) with `PrincipalAlias` rows of the
form:

| `aliasType`   | `aliasValue`   | `issuer`                                        |
| ------------- | -------------- | ----------------------------------------------- |
| `mcp_client`  | `claude-code`  | install identifier (e.g. `dpf://<install-id>`)  |
| `mcp_client`  | `codex`        | install identifier                              |

This mirrors the existing `edge_node` alias precedent (`aliasType="edge_node"`
keyed by `aliasValue`) and stays inside the `PrincipalAlias.@@unique([aliasType,
aliasValue, issuer])` constraint without introducing a colon-namespaced
overload of `aliasType`. The MCP token's `agentId` (already nullable on
`issueMcpApiToken`) is the candidate FK back to the Principal once the binding
exists.

## Required Grants for Development Readiness

The baseline should use the existing `development` MCP token template instead
of a new grant bundle. For Build Studio-oriented Claude/Codex work, readiness
should at minimum require:

- `architecture_read`
- `backlog_read`
- `backlog_write`
- `code_graph_read`
- `file_read`
- `spec_plan_read`
- `work_capsule_read`
- `work_capsule_write`
- `work_capsule_adopt`
- `sandbox_execute`
- `iac_execute`

The implementation should derive these from the development template when
possible, then expose any missing grants in the readiness result.

**Threshold vs template superset.** The `development` template in
`apps/web/lib/mcp-token-scopes.ts` legitimately bundles a broader set
(`build_promote`, `build_plan_write`, `deployment_plan_create`,
`release_gate_create`, `release_plan_create`, `deliberation_create`,
`thread_write`, `document_write`, `tool_evaluation_create`, etc.). The
required-grants list above is the **minimum threshold** for the readiness
contract — a token may legitimately carry more. The reverse is never true:
issuing a development-template token must always satisfy this threshold.
A regression test in `mcp-token-scopes.test.ts` should assert
`DEVELOPMENT_TEMPLATE_GRANTS ⊇ CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS`
so future template edits cannot silently break readiness.

**`sandbox_execute` and `iac_execute`.** These two grants exist primarily for
Build Studio's in-portal sandbox loop, not for the external contributor
client. They are nonetheless included in the readiness threshold because the
"governed handoff back to Build Studio" path (`contribute_to_hive`, capsule
adoption, build evidence recording) routes through tools that require them.
If a later substrate change splits sandbox/iac execution from contributor
write paths, this list must be revisited.

**`lastUsedAt` as a freshness signal.** `McpApiToken.lastUsedAt` (already
exposed by `listMyMcpTokens`) is the natural "is this token actually used
right now" indicator. The Ready state surfaces it; the read model uses it to
order tokens when the operator owns more than one development-tier token
(prefer the most recently used).

## Acceptance Criteria

1. Build Studio configuration shows contributor-client MCP readiness for
   Claude/Codex without requiring the operator to inspect the full token list.
2. A current active development token produces a ready state when it has the
   required coarse scope and granular grants.
3. Missing, expired, revoked, stale, read-only, or under-granted tokens produce
   a clear next action.
4. Issuing or rotating through the readiness surface reuses the existing
   development-token actions and returns the same setup snippets used by Admin >
   Platform Development > MCP.
5. The readiness model includes GAID/non-human peer binding state. If the
   current substrate cannot resolve it, the state degrades explicitly to
   `identityBinding: "not_available"` and the readiness card surfaces this in
   the disclosure panel — never asserts an unverified binding.
6. `insufficient_token_scope` errors can be mapped to the same remediation
   contract.
7. No new free-floating token issuance path is introduced.
8. No UI hardcodes colors outside the DPF theme token system (sole exception
   per AGENTS.md §12: `text-white` on `bg-[var(--dpf-accent)]` buttons).
9. The readiness read model performs no writes. It does not auto-issue,
   auto-rotate, auto-revoke, or auto-refresh tokens. Every state transition
   is explicit operator-initiated through the existing actions.
10. When the live probe is enabled, the Ready state is backed by a successful
    `tools/list` response from `/api/mcp/v1` within the probe-cache window.
    A structural-only Ready state (no probe yet) is visually distinguishable
    from a probe-confirmed Ready state.
11. `kind = "ephemeral_ship"` tokens are ignored by the readiness model —
    they neither satisfy nor invalidate contributor-client readiness.
12. The required-grants threshold is exported as a named constant
    (`CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS`) and the
    `DEVELOPMENT_TEMPLATE_GRANTS ⊇ CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS`
    invariant is asserted by a unit test.

## Verification Plan

- Unit test the readiness read model for ready, missing-token, expired,
  revoked, read-only, missing-grant, lifecycle-managed (ephemeral_ship),
  multiple-tokens (picks most recently used), and GAID-unavailable states.
- Unit test the `DEVELOPMENT_TEMPLATE_GRANTS ⊇
  CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS` invariant.
- Unit test the server action to prove it returns only current-operator token
  state and does not expose plaintext tokens.
- Integration test the live probe path: with a valid development token,
  `getContributorMcpReadiness(userId, { probe: true })` issues exactly one
  `tools/list` request to `/api/mcp/v1` and reports the probe outcome in the
  result. The probe is rate-limited (one per minute per token) and the
  cached probe result is returned on subsequent calls within the window.
- Component test the readiness UI for the quiet ready state, the
  probe-confirmed ready state, and each of the primary remediation actions.
- Existing token action tests continue to cover issue/rotate/setup snippets.
- UX verify the Build Studio configuration page against the local portal —
  drive each readiness state by manipulating the underlying token (issue,
  let expire by setting `expiresInDays: 0`, revoke, rotate to a smaller
  grant set) and confirm the card transitions correctly. Report findings
  as a dynamic-analysis prose summary, not a screenshot pile (per the
  memory `feedback_dynamic_analysis_is_evidence`).
- Run affected Vitest tests and `pnpm --filter web typecheck`.
- For a final implementation slice, run the production build gate per
  `AGENTS.md` §5 (unit + `next build` + UX + migrations if any).

## Kernel Principles Enforced

This design intentionally satisfies the following kernel principles
(`docs/founder-kernel/wiki/principles/`):

- `structural-verification-is-not-functional` — Ready is backed by a live
  MCP probe, not field-level checks alone.
- `never-ask-user-to-run-commands` — Every remediation is one button click;
  no copy-paste shell, no `psql`, no hand-edited config.
- `architecture-over-shortcuts` — Readiness is a read projection over the
  existing token machinery; no parallel token-issue surface, no DB-bypass
  fallback when scope is missing.
- `single-source-of-truth` — One required-grants constant, one read model,
  consumed by both the Build Studio card and the Admin token manager banner.
- `verify-substrate-before-proposing-new` — Confirms `PrincipalAlias`,
  `McpApiToken.kind`, `lastUsedAt`, and the `insufficient_token_scope`
  contract already exist before designing on top.
- `evidence-before-diagnosis` — `Test connection` returns the live probe
  result, so the operator sees the actual server response when something
  is wrong, not a guess derived from token fields.
- `live-state-over-seed-data` — The read model queries `McpApiToken` and
  `TOOL_TO_GRANTS` at runtime; no seed-time snapshot of grants.

## Open Follow-Ups

- Improve `principle_decide` / WWMD scoring for responsibility-placement
  questions like this one. The tool selected the right direction during this
  discussion, but returned zero-valued low-confidence contributions because the
  feature dimensions did not map cleanly to the kernel registry.
- Confirm the recommended `PrincipalAlias` shape
  (`aliasType="mcp_client"`, `aliasValue="claude-code" | "codex"`,
  `issuer=<install-id>`) when the TAK/GAID protocol-profile work lands. Until
  then, the readiness model reports `identityBinding: "not_available"` as the
  honest state.
- Decide whether stale-but-capable tokens should remain `ready` with a warning
  or become `attention_needed`. This spec recommends warning-only because idle
  is not the same as revoked or expired (consistent with
  `MCP_TOKEN_DEFAULT_STALE_DAYS = 7` and the kernel-stated
  `idle-is-not-abandoned` posture).
- Per-PR Build Studio readiness: ephemeral_ship tokens are excluded from
  contributor readiness today. When Build Studio cloud runners adopt their
  own readiness surface, decide whether the same read model is reused with a
  `kind: "ephemeral_ship"` filter flip, or whether ephemeral-ship readiness
  is a separate projection.
- Headless / cloud contributor case: the current design assumes a local
  Claude Code or Codex install with `DPF_MCP_BEARER_TOKEN` in the user
  environment. When external CI agents (cloud Claude, hosted Codex) become
  contributor peers, the readiness card needs a second mode that targets
  the agent's environment rather than the operator's machine.
- Probe rate-limiting and caching policy: the spec calls for one probe per
  minute per token. Confirm this against `/api/mcp/v1` throughput targets
  and whether the probe cache should be in-memory per-process or backed by
  the existing audit substrate so multiple admin tabs share one probe.
