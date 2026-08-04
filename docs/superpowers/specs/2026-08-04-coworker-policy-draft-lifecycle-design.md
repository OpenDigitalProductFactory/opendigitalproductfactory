# Coworker Policy Draft Lifecycle & Audience Scoping — Design

| Field | Value |
|-------|-------|
| **BI** | BI-3CDEC5F0 |
| **Date** | 2026-08-04 |
| **Epic** | EP-COWORKER-INTERACTIVITY |
| **Founder trigger** | HR coworker drafted a US HR policy in chat only; no system document |

## Problem

Coworkers can author policy text in conversation but cannot create **governed Policy** rows for human review. `/compliance/policies` already supports draft→in-review→approved→published for humans. HR specialist lacks tools and grants. Audience (e.g. US employees only) is not modeled on Policy.

## Research / substrate (verified)

| Surface | Status |
|---------|--------|
| `Policy` model | lifecycleStatus default `draft`; category includes `hr`; agentId optional |
| Server actions | `createPolicy` / `updatePolicy` / `transitionPolicyStatus` — human `requireManageCompliance` only |
| Lifecycle | draft → in-review → approved → published → retired (`lib/govern/policy-types.ts`) |
| hr-specialist grants | runtime map in `workforce-seed.ts`: registry/consumer only — **no policy_*** |
| policy-specialist | has policy_read/write in agent_registry but **no MCP Policy tools** |
| Adjacent tools | knowledge article, doc_save, propose_leave_policy (wrong product) |

## Decisions

1. **Canonical store = `Policy`**, not knowledge articles or generic docs, for company HR/compliance policies.
2. **Coworker create always draft** — never auto-publish.
3. **Publish is HITL** — coworker may `request_policy_review` (draft→in-review); human (or approved proposal later) publishes.
4. **Audience is P1** — ship P0 tools first; add jurisdiction/audience fields next so US-only policies do not noise non-US employees.
5. **Grants** — `policy_read` / `policy_write` on hr-specialist (and keep policy-specialist).

## Phases

### P0 — Tools + grants (this branch)

MCP tools (policy pack):

| Tool | Effect | Grant |
|------|--------|-------|
| `list_policies` | List active policies (optional filters) | policy_read |
| `get_policy` | Fetch one by policyId or id | policy_read |
| `create_policy` | Create **draft** Policy (category, title, body, …) | policy_write |
| `update_policy` | Update fields when lifecycle is draft or in-review | policy_write |
| `request_policy_review` | draft → in-review only | policy_write |

UI path unchanged for human edit/publish. `agentId` set from tool context when present.

### P1 — Audience

- Migration: closed applicability JSON or typed fields (jurisdiction basis + codes).
- Employee-facing filter by employment country/work location.
- Tool params for audience on create/update.

### P2 — Publish polish

- Ack/notify only in-audience; optional proposal-mode publish for coworkers.

## Non-goals

- Auto-publish employment policies without human.
- Replacing GRC obligations or leave-policy tools.

## Acceptance (P0)

- [ ] HR coworker creates draft via tool; visible on `/compliance/policies` as draft.
- [ ] Denied without policy_write.
- [ ] Human can edit and publish via existing lifecycle UI.
- [ ] Unit tests for pack + grants.

## Follow-on BI

P1/P2 may stay on BI-3CDEC5F0 or split after P0 ships.
