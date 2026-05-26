---
title: Contributor Client MCP Readiness for Build Studio
status: draft-for-operator-review
author: Codex
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
- Needs authorization: issue or rotate a development token.
- Needs client refresh: token exists, but the current client/env refresh has not
  been acknowledged.
- Needs grants: token exists, but the enforced access controls do not cover the
  workflow.
- Needs identity binding: token access is not tied to the expected non-human
  peer identity/GAID posture.

## Access Model

The readiness check must evaluate the full chain:

1. **Human RBAC**: the signed-in operator can manage contributor MCP access.
2. **Peer identity**: the Claude/Codex peer is represented as a governed
   non-human identity with GAID/AIDoc posture, or the readiness state explicitly
   reports that this binding is not yet available.
3. **Token lifecycle**: the token is active, unexpired, not revoked, and not a
   lifecycle-managed `ephemeral_ship` token.
4. **Token authority tier**: the token has the required coarse `scope`
   (`read`, `write`, or `admin`) for the intended workflow.
5. **Token grants**: the token `scopes[]` include the granular grants required
   by the workflow, such as `backlog_write`, `work_capsule_write`,
   `sandbox_execute`, `iac_execute`, `spec_plan_read`, and `code_graph_read`.
6. **Client wiring**: Claude Code and Codex can both resolve the same
   `DPF_MCP_BEARER_TOKEN` contract and target the canonical `/api/mcp/v1`
   endpoint.
7. **Server acknowledgment**: `/api/mcp/token/refresh` has accepted the current
   token or the platform can show the refresh action immediately after issue or
   rotation.

This does not replace the MCP server's call-time enforcement. Readiness is a
preflight and remediation surface; `/api/mcp/v1` remains authoritative on every
tool call.

## User Experience

### Build Studio surface

Add a compact readiness row to the Build Studio configuration surface:

- **Ready**: show a quiet success state, last used time, and expiry.
- **Action needed**: show one primary button with the best next action:
  `Issue development token`, `Rotate development token`, or `Refresh client`.
- **Details**: keep the exact token grants, client snippets, and raw token
  mechanics behind disclosure.

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
briefly and offer the fix action. It should not tell the operator to use direct
database access, patch config files manually, or bypass MCP.

## Data and Code Shape

The first implementation should avoid schema churn unless GAID binding cannot be
represented with existing `Principal` / `PrincipalAlias` records.

Recommended components:

- `apps/web/lib/auth/contributor-mcp-readiness.ts`
  - pure server read model over current user, `McpApiToken`, template grants,
    and available grant catalog
  - exports the readiness status, missing grants, recommended action, and
    optional GAID binding state
- `apps/web/lib/actions/mcp-tokens.ts`
  - add a server action that returns readiness for the current operator
  - keep token issue/rotate behavior in the existing actions
- `apps/web/components/platform/ContributorMcpReadinessCard.tsx`
  - compact Build Studio card/row using theme-aware styling
  - calls the existing issue/rotate/setup-snippet actions
- `apps/web/components/admin/McpTokenManager.tsx`
  - optionally reuse the readiness read model for a development-token status
    banner

If the GAID identity binding is not yet implemented for external contributor
clients, the read model should report `identityBinding: "not_available"` rather
than fabricating a binding. That state is acceptable for an initial readiness
slice if the token access controls still enforce the actual tool grants.

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
   current substrate cannot resolve it, the state degrades explicitly.
6. `insufficient_token_scope` errors can be mapped to the same remediation
   contract.
7. No new free-floating token issuance path is introduced.
8. No UI hardcodes colors outside the DPF theme token system.

## Verification Plan

- Unit test the readiness read model for ready, missing-token, expired,
  revoked, read-only, missing-grant, lifecycle-managed, and GAID-unavailable
  states.
- Unit test the server action to prove it returns only current-operator token
  state and does not expose plaintext tokens.
- Component test the readiness UI for the quiet ready state and the primary
  remediation actions.
- Existing token action tests continue to cover issue/rotate/setup snippets.
- UX verify the Build Studio configuration page against the local portal.
- Run affected Vitest tests and `pnpm --filter web typecheck`.
- For a final implementation slice, run the production build gate per
  `AGENTS.md`.

## Open Follow-Ups

- Improve `principle_decide` / WWMD scoring for responsibility-placement
  questions like this one. The tool selected the right direction during this
  discussion, but returned zero-valued low-confidence contributions because the
  feature dimensions did not map cleanly to the kernel registry.
- Decide whether external contributor clients should get a first-class
  `PrincipalAlias` type such as `mcp_client:claude-code` /
  `mcp_client:codex`, or whether the first slice should expose the current
  GAID-unavailable state until the TAK/GAID protocol-profile work lands.
- Decide whether stale-but-capable tokens should remain `ready` with a warning
  or become `attention_needed`. This spec recommends warning-only because idle
  is not the same as revoked or expired.
