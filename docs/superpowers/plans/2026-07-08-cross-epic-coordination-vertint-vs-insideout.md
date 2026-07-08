# Cross-epic coordination — Vertical Integration Inward × Claude Inside-Out

_Status: coordination note · 2026-07-08 · kernel-gated (principle_decide: dependency_link,
HIGH confidence 8.64, margin 1.53)_

Two live epics, worked by parallel threads, overlap on the AI/coworker/tool/identity
substrate:

- **EP-8DC217EB · Vertical Integration Inward** — *consolidate existing duplication*
  (plan: `docs/superpowers/plans/2026-07-07-vertical-integration-inward-plan.md`).
- **EP-CLAUDE-INSIDE-OUT · agent-harness mechanics as governed DPF primitives** —
  *build new platform primitives* (ServiceNow-replacement groundwork).

## The rule: build-it-once

Where a Claude-Inside-Out **new primitive** is the same target as a Vertical-Integration
**consolidation of N existing implementations**, they are **one effort, not two**:

> The Inside-Out primitive is the **canonical home**. The Vertical-Integration bet is
> its **migration follow-on** — "collapse the existing N duplicates onto the new
> primitive," not a parallel re-build. Never ship both; the primitive must *absorb* the
> duplicates, not sit beside them (single-source-of-truth; architecture-over-shortcuts).

**Sequencing:** the Inside-Out primitive lands first (or defines its contract first);
the Vertical-Integration migration lands against it. The migration bet is a *dependent*
of the primitive BI.

## Overlap map (canonical home → migration follow-on)

| Canonical home (EP-CLAUDE-INSIDE-OUT) | Migrates these duplicates (EP-8DC217EB) | Strength |
|---|---|---|
| **BI-55D2A0E5** universal approval-chain engine | **BET-2** (BI-F4156099): 3 "needs-approval" evaluators (engagements/build-requirements/agent-card) + whether-vs-who-approves have no spine → collapse onto the engine | **Strong** |
| **BI-4FA040D5** durable coworker tool grants | **BET-2** (BI-F4156099): grants forked 3× (AgentToolGrant/AuthorityBindingGrant/DelegationGrant) → one grant primitive; durability is the same substrate | **Strong** |
| **BI-69B614C6** governed server-side hook plane | **BET-2** (BI-F4156099): the tool-authorization seam (3 `requireCapability` surfaces, mcp-governed-execute) → hooks + resolver share one gate | **Strong** |
| **BI-8E07CCA5** agent-authored orchestration workflows · **BI-D80D16C4** user-definable workflow · **BI-E63B8293** subagent fan-out · **BI-D6F6A313** goal/stop primitive | **BET-8** (BI-0C4486A5) dispatch generations + **BET-11** (BI-B72328D5) createGatedCron/scheduled-jobs + **BET-0d/0e** (BI-C350F8B0/BI-F95222FA) dispatch harness + scheduled sweep → the dispatch/cron/fan-out scaffolding becomes instances of the workflow primitive | **Strong** |
| **BI-B459B303** unified CI identity graph (CSDM) · **BI-6804292F** governed data extension | **BET-13** (BI-75B31594) identity/vocab convergence + **BET-1** (BI-B6DD63A4) WorkUnit spine + "capability modeled 5 ways" → one class model; CSDM reconciliation and Principal/WorkUnit convergence are the same work | **Strong** |
| **BI-83AC1A03** ad-hoc reporting/dashboard composer | **BET-7** (BI-6182950F) report-kit + **BET-10** (BI-B6157FB7) read-model → the composer builds ON report-kit + the run read-model, not a parallel one | Moderate |
| **BI-997503EC** notification/subscription rules | **BET-12** (BI-7CD647B0) findings + ops notification dedup + self-upgrade H4/H5 notification vocabularies → one notification substrate | Moderate |
| **BI-042F5269** packaged-capability store | **BET-14** (BI-C0CEB377) skill-corpora + tool-pack dedup → the store is the home for pack consolidation | Mild |
| **BI-F9025BA0** coworker working memory · **BI-033F7446** session surfaces · **BI-4D1CD70B** deliverable artifacts | **BET-0** coworker substrate (BI-D9B58004…): the enablement loop consumes these surfaces | Mild |

## File-collision hot-zones (both threads will touch)

To avoid same-file index/HEAD collisions and cross-thread sweeps, both threads must
**claim before working** (`claim_backlog_item_for_work` binds BI↔worktree↔branch) and
sequence — not co-edit — these shared surfaces:

- `apps/web/lib/tak/*` (agent-grants, agentic-loop, delegation/collaboration authority) — BET-2 ∩ hook plane / durable grants
- `apps/web/lib/govern/*` (governance-resolver, approval-authority, grant writers) — BET-2 ∩ approval-chain / grants
- `apps/web/lib/routing/*` + `apps/web/lib/integrate/*dispatch*` — BET-8 ∩ workflow/fan-out
- `apps/web/lib/queue/*` (Inngest functions, scheduled-jobs) — BET-11 ∩ workflow / SLA engine
- `packages/db/prisma/schema.prisma` (grants, identity, WorkUnit, CI classes) — BET-1/2/13 ∩ CI-identity-graph / data-extension. **Schema is the highest collision + fleet-safety risk — one migration author at a time.**

## Actions taken — bidirectional links landed (2026-07-08)

- **EP-8DC217EB side (9 bets):** BI-F4156099 (BET-2), BI-0C4486A5 (BET-8),
  BI-B72328D5 (BET-11), BI-75B31594 (BET-13), BI-B6DD63A4 (BET-1), BI-6182950F (BET-7),
  BI-B6157FB7 (BET-10), BI-7CD647B0 (BET-12), BI-C0CEB377 (BET-14) — each annotated with
  the "canonical home / migrate-onto" dependency line.
- **EP-CLAUDE-INSIDE-OUT side (12 BIs, founder-authorized):** BI-55D2A0E5, BI-4FA040D5,
  BI-69B614C6, BI-8E07CCA5, BI-D80D16C4, BI-E63B8293, BI-B459B303, BI-6804292F,
  BI-83AC1A03, BI-997503EC, BI-042F5269, BI-78414B9D — each annotated with the reciprocal
  "canonical home — must ABSORB the existing duplicates (BET-N), read its file:line
  evidence when designing the contract" note. Additive body notes only; no status/scope
  change (active thread not disrupted).
- Plan §10 references this note.

## Standing rules for both threads

- When designing each primitive's contract, read the corresponding BET's `file:line`
  evidence (plan §4) so the primitive is shaped to absorb the real duplicates.
- Coordinate schema-touching work (BI-B459B303, BI-6804292F, BI-4FA040D5) with
  BET-1/2/13 — **one migration author, expand→contract, fleet-safe.**
- Claim before working (`claim_backlog_item_for_work`) on every hot-zone file.
