# Two-scope memory (org-shared vs per-user) — implementation plan

- **BI:** BI-1772D0B7 (EP-8C706944 — AI Coworker Memory & Context Architecture, Phase 4)
- **Date:** 2026-07-09
- **Kernel ledger:** DI-F69AE978B70C
- **Status:** Scope classifier + write tagging + org read path (this PR)

## Problem

All conversational memory was siloed per human user (`UserFact.userId`), so a coworker serving ten employees kept ten disjoint memories and could not carry an org-relevant fact between them — while some content genuinely must stay private. The founder's exact concern: *"when there are 10 human employees, the separation / sharing of this memory will need to be contextually decided smartly."*

## Design

GitHub Copilot Memory's production split — repo-scoped shared facts vs private user preferences — mapped onto DPF's fact categories, decided at write time. **No new table** (single-source-of-truth): `UserFact` gains two columns.

1. **Schema** (additive migration `20260709160000_add_user_fact_scope`): `UserFact.scope` (`"user"` default | `"org"`) and `UserFact.sensitivity` (`"normal"` default | `"sensitive"`). Every existing fact backfills to `user`/`normal` — its current private behavior — so nothing changes for existing data.
2. **Pure classifier** `memory-scope.ts`: `classifyMemoryScope({category, key, value})` →
   - **sensitive** content (salary, health, credentials, "confidential / do not share", personal identifiers) is ALWAYS user-private, whatever the category — this dominates.
   - `preference` → user (personal taste).
   - `decision` / `constraint` / `domain_context` → org (durable business facts belong to the organization, per `learnings-belong-in-the-shared-commons`).
   - unrecognized → user (safe default).
   Deterministic → 7 unit tests.
3. **Write tagging**: `upsertUserFact` classifies once and tags `scope`/`sensitivity` on every fact it creates.
4. **Org read path**: `loadOrgSharedFacts(excludeUserId)` returns `scope="org"`, non-sensitive, active facts learned in *other* employees' sessions; `loadGovernedUserFacts` merges them (deduped, own facts first) so the coworker carries org context across the team. One DPF install = one organization, so "org" is install-wide.

## Safety

Sensitive facts never leave their originating user regardless of scope. Authority is never stored in memory (the permission plane owns it). Org facts are the same durable business facts the commons already governs; this surfaces them across sessions without a heavyweight proposal per fact.

## Non-goals (own BIs / follow-ups)

- Org-scoped session briefings (`CoworkerBriefing` `scope="org"`, reserved in BI-A9052DCB) — composes once both land.
- Multi-organization filtering within one install — the model is install-per-org today; an `organizationId` filter is the multi-tenant follow-up.
- Surfacing/redacting sensitive vs org facts in the audit UI → BI-DC8B03AB.

## Verification

- Unit: `memory-scope.test.ts` (7 — business→org, preference→user, sensitive override across categories, do-not-share marker, unknown default). Existing user-facts suite green.
- Runtime (post-merge): a `domain_context` fact ("tech stack is Next.js + Postgres") learned in employee A's session is injected into employee B's session with the same coworker; a salary fact stays only with A.
