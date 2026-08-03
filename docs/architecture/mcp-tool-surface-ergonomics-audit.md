# MCP Tool-Surface Ergonomics Audit

**Status:** binding checklist for DPF MCP / coworker tool-surface changes  
**Backlog:** BI-5FE9DF99 / EP-COWORKER-INTERACTIVITY  
**Related:** [mcp-tool-authorization-runbook](mcp-tool-authorization-runbook.md), [mcp-tool-packs](mcp-tool-packs.md), [claude-inside-out agent-harness parity spec](../superpowers/specs/2026-07-07-claude-inside-out-agent-harness-parity-spec.md) (§2 Tool plane), `scripts/check-tool-surface.mjs`

## Purpose

Agents fail when the tool surface is large, inconsistently named, poorly described, or grant-opaque. This audit is the **ergonomics gate** for changes that add, rename, split, or pack MCP tools — aligned to the agent-harness construction checklist (tool plane: MCP server exposure, deferred loading, permission planes).

Use it for:

- New `PLATFORM_TOOLS` / tool-pack entries
- Grant or capability changes
- Local-fallback / deferred-loading budget impacts
- Coworker vs external-CLI exposure deltas

## Non-goals

- This is not the full security review (authn/z, token scope) — see MCP authorization runbook.
- This is not the pack extraction migration plan — see mcp-tool-packs.
- This does not replace `scripts/check-tool-surface.mjs` baselines; it adds human/agent checklist criteria those scripts do not encode.

## Harness checklist mapping (tool plane)

From the harness parity inventory, every tool-surface PR must account for:

| Harness mechanic | DPF question |
| --- | --- |
| **MCP server** | Is the tool exposed through the governed door (`governedExecuteTool` / pack handler), not a side door? |
| **Deferred tool loading** | Does the change keep local / budgeted surfaces lean (search/load on demand, pack scoping)? |
| **Permission planes** | Are grants, scopes, and advise-safe visibility explicit and single-sourced? |

## Audit checklist (every tool-surface PR)

A PR that touches the MCP tool surface **must** answer each item. Missing answers are a fail for ready-to-merge.

### 1. Name and discoverability

- [ ] Tool name is stable, verb-oriented, and collision-free across packs
- [ ] Description states **when to call** and **when not to call** (not only what it does)
- [ ] Semantic IDs in args/results use public forms (`BI-*`, `EP-*`, …), never internal cuids in docs/examples

### 2. Schema ergonomics

- [ ] Required vs optional parameters match real call patterns (no false required fields)
- [ ] Enums are closed where the domain is closed; free strings justified
- [ ] Errors return actionable next steps (`insufficient_token_scope`, missing id shape, etc.)

### 3. Grant and population fit

- [ ] `TOOL_TO_GRANTS` / pack grant mirror stay aligned (no silent grant drift)
- [ ] Token scope (`read` / `write` / `admin`) matches side effects
- [ ] Advise-safe classification correct: side-effecting tools are hidden in advise mode unless truly reversible
- [ ] Coworker grants remain registry-sourced — not re-derived per page

### 4. Budget and deferred loading

- [ ] Local-fallback max-tools budget considered (`LOCAL_FALLBACK_MAX_TOOLS` and pack composition)
- [ ] High-cardinality tool families prefer pack + deferred discovery over dumping into the always-loaded list
- [ ] No duplicate tools that solve the same job under two names

### 5. Audit and evidence

- [ ] Side effects produce `ToolExecution` (or equivalent) audit rows
- [ ] Destructive or promoting tools require explicit confirmation / authority path
- [ ] Contract or unit tests cover the new/changed tool registration path where feasible

### 6. Docs and single source of truth

- [ ] Runbook or pack doc updated if the operator/agent contract changed
- [ ] No second dispatch switch or parallel registry introduced
- [ ] AGENTS.md / authorization runbook still accurate (pointer, not copy)

## Scoring rubric (optional but recommended)

For larger surface changes (new pack or ≥5 tools), score each section 0–2:

| Score | Meaning |
| --- | --- |
| 0 | Missing or contradictory |
| 1 | Present but thin / easy to misuse |
| 2 | Clear, testable, grant-correct |

Ship bar: no section at 0; average ≥1.5 for multi-tool packs.

## Anti-patterns

| Anti-pattern | Why it hurts agents |
| --- | --- |
| Mega-descriptions that restate the whole domain | Crowds context; bury the trigger |
| Twin tools (`list_x` + `query_x` with same filter shape) | Wastes budget and confuses selection |
| Write tool with `read` scope | Runtime failures mid-plan |
| Advise-visible irreversible tools | Operators see actions they cannot safely preview |
| Handler-only change without definition/grant update | Discovery and auth drift |

## Worked example (pass)

Adding `list_work_capsules` with status enum, semantic ids, read scope, pack-owned definition+handler, grant mirror test, and a description that says "coordination records only — not backlog triage."

## Worked example (fail)

Adding `run_everything` with free-form `action` string, admin scope optional, no grant entry, and a 40-line description pasted from internal design notes.

## Related tooling

| Tool / path | Role |
| --- | --- |
| `scripts/check-tool-surface.mjs` | Mechanical surface baseline |
| `apps/web/lib/mcp/tool-pack.ts` | Pack shape |
| `apps/web/lib/mcp-governed-execute.ts` | Governed execution door |
| MCP authorization runbook | Token scope and grants |

## Change control

Checklist axes change via PR against this file. Feature PRs should not invent private ergonomics rules that contradict it.
