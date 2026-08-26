---
title: "Plan — banking books loop as governed MCP tools (S-FIN)"
date: 2026-08-23
bi: BI-DE27D34E
epic: EP-EMAIL-COMMS
status: active
---

# Plan — Banking books loop as governed MCP tools (BI-DE27D34E, slice S-FIN)

**Parent:** BI-1585FA9E (Bookkeeping Work Room). **Spec:** `docs/superpowers/specs/2026-08-16-bookkeeping-work-room-design.md` (merged). This is the FOUNDATION slice.

## Problem

The full books loop already exists in `apps/web/lib/actions/banking.ts` (create account, import statement, auto-categorize via rules, match/reconcile, reconciliation summary) — but only as UI server actions. There are no banking MCP tools and no banking grant key, so no coworker can keep the books current through governed tools. This closes that gap.

## Change (thin adapters over existing, tested actions)

1. **`apps/web/lib/mcp/packs/banking-pack.ts`** — 12 governed tools wrapping the banking actions: 6 reads (`banking_read`, side-effect-free) and 6 writes (`banking_write`, side-effecting). Write inputs validated with the existing Zod schemas (`banking-validation.ts`). No new business logic.
2. **`TOOL_TO_GRANTS`** (`tak/agent-grants.ts`) — each tool → `banking_read` | `banking_write`, mirroring the pack (tool-registry drift test enforces parity).
3. **`EMPLOYEE_FINANCE_TEMPLATE_GRANTS`** (`mcp-token-scopes.ts`) — add `banking_read` + `banking_write` so a finance token carries the loop (required same-commit per the file's own rule).
4. **`ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES`** (`tak/consequential-tool-policy.ts`) — `create_bank_account` + `import_bank_statement` route the governance gate (EP-1C37C089) for owner approval; categorization/matching stay off (ordinary, reversible).
5. **Pack registration** in `pack-registry.ts`.

No fabrication: amounts come from the imported statement; `import_bank_statement` returns per-row parse `errors`, so gaps are surfaced, not guessed. Grant scope tier is derived from `sideEffect` (writes require a write-scoped token); side-effecting tools are hidden in advise mode by default.

## Verification

- `banking-pack.test.ts`: registration/parity, read-vs-write side-effect + grant classification, `banking_read` authorizes reads but not writes, only money-of-record writes are consequential, and handler behavior (import surfaces errors, create validates, not-found is clean) against mocked actions.
- Existing suites green: tool-registry drift, consequential-tool-policy "every name resolves", token-scopes, agent-grants (166 tests). Full `apps/web` typecheck clean.

## Risks & rollback

- Blast radius: a new pack + 4 registry/grant edits. No schema change, no migration; handlers delegate to already-tested actions. Rollback: remove the pack + its registry/grant/consequential entries.
- The books loop is now coworker-reachable, but consequential writes require owner approval via the governance gate — money-of-record actions never auto-apply.

## Sequence

Foundation for S-BK (Bookkeeper coworker grants), S-ROOM, S-TRIG (BI-1585FA9E decomposition).
