---
title: MCP governance-flow token scope — unblocking Claude-side BS lifecycle work
status: draft
author: Claude (substrate investigation)
date: 2026-05-18
related:
  - PR #762 §12.5 — three substrate gaps surfaced
  - BI-0789AF6B / FB-60DCE69A — Build Studio scoped task context
  - 2026-05-17-wwmd-decision-perspective-kernel-design.md
  - 2026-05-18-build-studio-thread-management-design.md
references:
  - apps/web/lib/mcp-token-scopes.ts (CODING_AGENT_MCP_TOKEN_SCOPES)
  - apps/web/lib/tak/agent-grants.ts (getToolGrantMapping)
  - apps/web/app/api/mcp/v1/route.ts (tokenCanUseTool gate)
  - apps/web/lib/mcp-tools.ts (PLATFORM_TOOLS + handlers)
---

# MCP governance-flow token scope — design

## 1. Problem

During the rev 4 validation pass on PR #756, three Claude-side actions hit
substrate-level "cannot execute" walls:

1. Filing follow-up backlog items (`create_backlog_item`)
2. Seeding Build Studio phase evidence (`saveBuildEvidence`,
   `save_phase_handoff`)
3. Attaching evidence to a Work Capsule (`record_capsule_evidence`
   returned "side-effecting tool; this token is read-only")

These three are the bottleneck for executing the evidence-not-provenance
precedent (PR #762 §12.2) end-to-end from a Claude session. Without them,
every governance-routed Claude flow requires operator-mediated handoffs at
the points where it actually needs to write the system of record.

## 2. Substrate state — what already exists

Investigation confirms the substrate is **almost complete**:

| Component | State |
|---|---|
| Tool definitions in `PLATFORM_TOOLS` | ✅ all four exist (`mcp-tools.ts`) |
| Handlers in `executeTool` dispatch | ✅ all four exist |
| Grant entries in `getToolGrantMapping()` | ✅ all four mapped to `backlog_write` / `work_capsule_write` |
| Default coding-agent scopes (`CODING_AGENT_MCP_TOKEN_SCOPES`) | ⚠️ `work_capsule_write` present, `backlog_write` **absent** |
| MCP v1 route gate (`tokenCanUseTool`) | ✅ correctly default-denies tools without grant entries |
| Audit trail (DCO, `Signed-off-by`, `BuildActivity`, `WorkCapsuleActivity`) | ✅ existing platform pattern, applies independently |

So the missing piece is **not** new code, new tools, or a new surface. It is:

- **A token-scope provisioning gap.** Coding-agent tokens get the read set
  + capsule-write by default, but not backlog-write. There is no
  "governance flow" scope tier above `coding-agent` that explicitly
  enables backlog mutation + phase advancement.
- **A possible runtime-check discrepancy.** My session token had
  `work_capsule_write` in its default scope set, yet
  `record_capsule_evidence` returned "this token is read-only." This may
  indicate the capsule-write path has a second gate that the v1 route's
  scope check does not exercise. Audit step in §6.

The two failures combine to the externally-visible "Claude can't execute
governance flows" symptom.

## 3. Design

### 3.1 Add a `GOVERNANCE_FLOW_MCP_TOKEN_SCOPES` tier

New named scope set in `apps/web/lib/mcp-token-scopes.ts`, *additive* to
`CODING_AGENT_MCP_TOKEN_SCOPES`:

```ts
export const GOVERNANCE_FLOW_ADDITIONAL_SCOPES = [
  "backlog_write",
] as const;

export const GOVERNANCE_FLOW_MCP_TOKEN_SCOPES = [
  ...CODING_AGENT_MCP_TOKEN_SCOPES,
  ...GOVERNANCE_FLOW_ADDITIONAL_SCOPES,
] as const;
```

This is one new constant. It is not a default — operators opt in per token
when provisioning.

### 3.2 Token provisioning UX

In `Admin > Platform Development` (or wherever coding-agent tokens are
generated today, see [project_codex_fresh_install_trace.md](C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_codex_fresh_install_trace.md)), add a checkbox or scope selector:

- **Default**: `coding-agent` scopes (read + capsule write)
- **Optional**: `+ governance-flow` (adds `backlog_write`)

The label should make clear what `governance-flow` enables: "Allow this
session to file backlog items, seed Build Studio phase evidence, and
advance build phases. Use for governance-routed Claude sessions only."

Tokens with `governance-flow` get marked in the `McpToken` record with a
distinguishable tier tag so admin views can filter / audit them.

### 3.3 The capsule-write runtime discrepancy

Audit task: identify why `record_capsule_evidence` returned
"side-effecting tool; this token is read-only" despite the token's default
scope including `work_capsule_write`. Hypotheses to verify:

1. The error originated from a wrapper / middleware that classifies tools
   by `sideEffect: true` and checks a separate "write capability" rather
   than the granular scope.
2. The token's effective scopes at runtime differ from the default — e.g.,
   the token was minted before `work_capsule_write` was added to the
   default set.
3. There is an agent-grant filter on the executing agent that defaults to
   read-only and is not parameterised by the token's scopes.

Resolution either fixes the wrapper to honour scope-level grants, or makes
the wrapper's read-only assertion correct (token actually didn't have
the scope, no false positive).

### 3.4 Safety controls — unchanged

The existing gate chain in `tokenCanUseTool` continues to apply:

- **Capability check** (`tool.requiredCapability`) — user must have it
- **Scope intersection** — token must have one of the required grants
- **Agent-grant filter** (when the call carries an agentId in context) —
  applies on top, not below

`governance-flow` tokens are still subject to all three. The proposed
change adds a scope; it does not remove any gate. Audit-trail mechanics
(`BuildActivity`, `WorkCapsuleActivity`, DCO sign-off) are independent of
scopes and continue to log every call.

### 3.5 Audit / observability additions

- Every tool call from a `governance-flow`-scoped token logs the tier
  alongside the existing call telemetry, so post-hoc audits can answer
  "which Claude sessions had elevated scopes when they touched the
  backlog."
- `Admin > Platform Development` shows the current tier on each token in
  the list view so operators can spot governance-flow tokens at a glance.

## 4. Why this is small

- **Zero new tools.** Four tools already exist.
- **Zero new gates.** The v1 route gate already correctly filters.
- **One new constant** (the additional-scopes array).
- **One UX touch-up** (scope checkbox in token-generation form).
- **One audit task** (capsule-write discrepancy).
- **No schema changes** beyond optionally adding a `tier` column to
  `McpToken` for filtering — and even that is optional v1.

The total code surface is ~50 LOC + the UX touch-up. The bulk of the
work is the audit task in §3.3, whose outcome may change the resolution
path but is bounded.

## 5. Acceptance criteria

1. A token minted with `governance-flow` scope returns the four tools
   (`create_backlog_item`, `saveBuildEvidence`, `save_phase_handoff`,
   `record_capsule_evidence`) in `tools/list`.
2. A token minted with default (non-governance) scope continues to NOT
   return the three backlog/build-evidence tools, but DOES return
   `record_capsule_evidence` (matching existing behaviour after §3.3
   resolution).
3. Calling `create_backlog_item` from a `governance-flow` token writes a
   `BacklogItem` row with the calling user as actor, and the call is
   visible in `Admin > Platform Development > Tool Activity` (or
   wherever tool calls are logged).
4. Calling `saveBuildEvidence` from a `governance-flow` token, in a
   sequence terminated by `save_phase_handoff` with `autoAdvance: true`,
   advances the named `FeatureBuild` through the next phase gate. The
   gate check (`checkPhaseGate`) still runs and can still block.
5. The §3.3 audit produces a written finding (in a follow-up commit or
   PR comment) explaining the capsule-write discrepancy and either
   fixes the wrapper or documents the actual intended behaviour.
6. The audit-trail invariant holds: every `governance-flow`-tier tool
   call produces a row in the relevant activity log (`BuildActivity`,
   `BacklogItemActivity`, `WorkCapsuleActivity`), with the token's
   tier tag present.

## 6. Test plan

- Unit: `mcp-token-scopes.test.ts` adds cases asserting that
  `GOVERNANCE_FLOW_MCP_TOKEN_SCOPES` includes `backlog_write` and
  remains a superset of `CODING_AGENT_MCP_TOKEN_SCOPES`.
- Unit: `app/api/mcp/v1/route.test.ts` adds cases for the
  `governance-flow` tier returning the four governance tools, and the
  default tier continuing to deny them.
- Integration: end-to-end test that mints a `governance-flow` token,
  files a `BacklogItem` via `create_backlog_item`, then seeds
  `designDoc` on a `FeatureBuild` via `saveBuildEvidence`, and asserts
  both rows exist with correct actor + tier metadata.
- Manual smoke: from a Claude session whose token was minted with
  `governance-flow`, file BI-FOLLOWUP-WWMD-PERTASK as the actual first
  use of the new capability.

## 7. Out of scope

- New tools or handlers. The four tools and their handlers already exist.
- Cross-org / hive-mind backlog writes. This spec addresses single-Org
  governance flows. Cross-Org backlog mutation has its own contribution-
  mode controls (DCO, PR provenance, capsule scope) that ride
  independently.
- The fast-follow PR plan from PR #762 §7. This spec unlocks the BIs
  that those PRs will be filed against; the PR work itself is separate.
- Build Studio's own internal use of these tools. Build Studio
  specialists run inside the platform and already have their own
  grant-resolution path (`agent-grants.ts`) — they do not pass through
  the external MCP v1 route and are not gated by `McpToken` scopes.

## 8. Open question for the operator

Should `governance-flow` be an **opt-in scope tier on the existing
coding-agent token** (one token, two tier levels — operator chooses at
mint time), or a **separate token type** entirely (admin-issued only,
distinct from coding-agent tokens)?

**My read**: opt-in scope on the existing token type. Reasons:
1. Token-issuance UX is already a thing operators do; adding a checkbox
   is simpler than adding a token type.
2. The same human-in-the-loop Claude session may legitimately need both
   coding and governance scopes (e.g., a session that's drafting a spec
   AND filing the follow-up BI).
3. The audit trail differentiates calls by scope, not by token type.

**Counter-argument for separate type**: makes the security boundary
visually obvious in the admin UI; reduces blast radius if a
coding-agent token leaks.

Worth ratifying before implementation.

---

*End of design. This spec unlocks the follow-up BIs named in
[PR #762 §12.3](../../../../docs/superpowers/specs/2026-05-18-build-studio-thread-management-design.md#123-post-merge-action-plan).
Implementation belongs in Build Studio per the standing rule; this doc
is the predicate.*
