# Coworker Identity 360 — Phase 1 implementation plan

**Spec:** [`docs/superpowers/specs/2026-08-06-coworker-identity-360-hub-design.md`](../specs/2026-08-06-coworker-identity-360-hub-design.md)
**Epic:** `EP-COWORKER-IDENTITY-360`
**Backlog:** `BI-COWORKER-360-PAGE` (the page), `BI-233F165F` (Cost + Engagements facets)
**Date:** 2026-08-07
**Author:** Claude Code (external, branch `claude/ai-coworker-identity-hub`)

## Design grounding

Source of truth is the committed spec (above), founder-approved 2026-08-06 with two locked decisions: (1) a **peer identity area beside People/Customers** (route `/workforce/[agentId]`); (2) **build the full page first**. Substrate verified: the `Agent` record + satellites already hold every facet; a rich admin record exists at `/platform/ai/agent/[agentId]`; the two facets surfaced on a coworker's identity nowhere today are **Cost** (`TokenUsage`/`AgentBudgetEvent`) and **"who has engaged it"** (`CoworkerEngagement`/`DelegationGrant`). This plan **extends** that spec; it introduces no new tables (zero-schema read-projections) and reuses the canonical `CoworkerPriorityControl` / `CoworkerProactivitySetting` controls and the existing `loadCoworkerRecord` loader. Not a new contract beyond the additive read route.

## What Phase 1 delivers

A new server route `apps/web/app/(shell)/workforce/[agentId]/page.tsx` — the Coworker Identity 360 — with:
- **Definition-as-header**: `Agent.description` as the purpose/value statement + value-stream / delegates-to / escalates-to / owning-team.
- **At-a-glance band**: skills · tools · engagements · 30-day cost · teams · status.
- **Inline behaviour settings** (summary until you change), reusing the canonical shared components: `CoworkerPriorityControl` (Golden Triangle + inheritance) and `CoworkerProactivitySetting` (proactivity gauge + effects).
- **Facets collapsed to a one-line summary**: **Who has engaged it** (new), **Cost** (new), Skills & capabilities.
- **Ask** (the existing `AskCoworkerButton`) + **Manage** (deep-link to the admin record for edits).

## Steps (status)

1. **Cost read-projection** — `apps/web/lib/coworker-identity/cost-projection.ts`: pure `summarizeCoworkerCost` (30-day spend, delta vs prior window, daily series, top drivers, budget posture) + thin `loadCoworkerCostProjection` fetch over `TokenUsage`/`AgentBudgetEvent`/`AgentExecutionConfig`. **DONE + unit-tested** (`cost-projection.test.ts`).
2. **Engagements read-projection** — `apps/web/lib/coworker-identity/engagements-projection.ts`: pure `aggregateEngagers` (collapse per-counterparty touches, people vs agents, recency/tone) + `loadCoworkerEngagements` over `CoworkerEngagement` (business id) + `DelegationGrant` (cuid). **DONE + unit-tested** (`engagements-projection.test.ts`).
3. **Facet panels** — `CostFacetPanel.tsx`, `EngagementsFacetPanel.tsx` (pure presentation). **DONE.**
4. **The page** — `(shell)/workforce/[agentId]/page.tsx` composing the above + canonical controls. **DONE.**
5. **Route gate artifacts** — route:sync registry, page-purpose contract, UX-fit manifest (`docs/ux-fit/`), nav registration. **In progress** — generated/authored in this PR; the CI gates (Spec/Plan/Doc, UX-Fit, route sweep) are the verifier for the full route since this is a source-only worktree.

## Verification

- **Local (source-only worktree, verified):** the pure projection logic — `pnpm vitest run apps/web/lib/coworker-identity` → 28 tests passing. Typecheck of the new page + panels.
- **CI (the gate of record):** Spec/Plan/Doc, UX-Fit, route sweep, and the full local-merge CI — this source-only worktree cannot run the full route gate chain, so CI adjudicates the route registration and budget baselines.

## Out of scope for Phase 1 (per spec §6)

- **Teams & collaboration facet** — a follow-on read-projection over `ValueStreamTeamRole` / `AgentOwnership` / A2A edges (the header surfaces owning-team; the full rooms facet is next).
- **Share + whole-coworker A2A agent-card** (`GET /api/a2a/coworkers/[agentId]`) — spec Phase 2 (`BI-COWORKER-360-AGENTCARD`).
- **Primary-nav registration as a top-level peer area** — this PR ships the reachable route + breadcrumb; promoting it into the People/Customers nav rank is a small follow-on once the surface is validated on the live install.

## Backlog coverage

- `BI-COWORKER-360-PAGE` — the identity page + peer positioning (steps 3–5).
- `BI-233F165F` — Cost + Engagements facets (steps 1–3).
