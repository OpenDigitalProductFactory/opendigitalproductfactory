---
title: Decision-surface consolidation — one governed path through the Decision Perspective Gate
status: draft-for-operator-review
author: Claude (Opus 4.8)
date: 2026-05-30
backlog:
  - BI-E1FB2307
epics:
  - EP-WWMD-MCP
related:
  - apps/web/lib/decision-perspective/evaluator.ts
  - apps/web/lib/decision-perspective/build-studio-gate.ts
  - apps/web/lib/decision-perspective/material.ts
  - apps/web/lib/decision-perspective/persistence.ts
  - apps/web/lib/decision-perspective/types.ts
  - apps/web/lib/wiki/principle-decide.ts
  - apps/web/lib/build/decision-service.ts
  - apps/web/lib/kernel/runtime-gate.ts
  - apps/web/lib/mcp-tools.ts
  - packages/dpf-skill-pack/skills/dpf-decision-via-kernel/SKILL.md
  - docs/user-guide/ai-workforce/decision-perspective.md
  - docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md
  - docs/superpowers/specs/2026-05-19-wwmd-mcp-exposure-design.md
prs: []
---

# Decision-surface consolidation

## Purpose

Make the **Decision Perspective Gate** the single governed decision path, so every AI coworker and agent decides against the **correct profile** — **WWWD** (the customer's business operating principles) for business decisions, **WWMD** (the founder/platform kernel) for platform-development decisions — and it is unambiguous which profile governed any decision. Today a second, profile-unaware door (`principle_decide`) lets coworkers decide via the founder kernel, violating the non-inherit boundary the Gate exists to enforce.

## Layered vs. parallel (the framing)

- **Parallel (today):** two independent decision implementations. The Gate (`lib/decision-perspective/evaluator.ts`) resolves a profile, runs the inheritance chain, and writes a `DecisionInteraction` ledger row. `principle_decide` (`lib/wiki/principle-decide.ts`) separately scores `PRINCIPLE_DIMENSIONS` over WikiPage principles with **no** profile awareness. Verified 2026-05-30: the Gate does not call `principle_decide`; they share no path. Two doors → agents can pick the wrong one.
- **Layered (target):** one door. The Gate selects the profile, gathers that profile's principles, and calls the scoring math as its **inner engine**, then wraps the score with outcome (recommend/arbitrate/escalate/defer), confidence, the ledger, and the non-inherit boundary. `principle_decide` stops being an independent public surface.

This plan implements the layered target.

## Current state (grounded)

| Surface | Profile-aware? | Callers today |
|---|---|---|
| Decision Perspective Gate (`lib/decision-perspective/`) | Yes (WWMD/WWWD/WWTD, inheritance chain, ledger, boundary) | Build Studio (`build-studio-gate.ts`, plan-readiness) |
| `principle_decide` (`lib/wiki/principle-decide.ts`) | No (founder-kernel scoring, org-overlay only) | `mcp-tools.ts` (the `dpf-decision-via-kernel` skill, assignTo `["*"]`), `build/decision-service.ts`, `kernel/runtime-gate.ts` |

The leak: `dpf-decision-via-kernel` → `principle_decide` → founder kernel, for *all* coworkers.

## Target architecture

```
caller (coworker / agent / Build Studio / contributor)
        │  declares calling population
        ▼
Decision Perspective Gate  ── selects active profile (WWWD org | WWMD platform)
        │                     gathers profile principles + inheritance chain
        ▼
scoring engine (extracted from principle-decide.ts)  ── vector alignment math
        ▼
Gate wraps: outcome + confidence + DecisionInteraction ledger + non-inherit boundary
        ▼
response NAMES the governing profile  ── unambiguous for agents
```

## Phases

### Phase 1 — Extract the scoring engine (no behavior change)
- Extract the pure vector math (`computeStructuredAlignment`, `buildOptionScores`, `decide`) into a shared module the Gate can import. `principle_decide.ts` keeps its current exports (re-export) so existing callers are untouched.
- **Verify:** existing `principle-decide` + decision-perspective unit tests stay green; no caller diff.

### Phase 2 — Gate uses the engine; Gate gains an options-decision entry
- The Gate's `evaluator.ts` calls the shared engine for the scoring step, so principle scoring and profile resolution live in one path.
- Add a Gate entry that accepts the `principle_decide` option-vector shape, resolves the profile, scores, and returns the Gate outcome + ledger.
- **Verify:** a decision through the Gate writes a `DecisionInteraction` row and resolves against the selected profile; parity test vs. the old `principle_decide` math on `platform` profile (identical scores when profile=WWMD).

### Phase 3 — Profile-aware decision MCP surface + skill routing
- Route the coworker/agent decision tool through the Gate with **calling-population → profile** resolution: in-portal coworker → org **WWWD**; external coding agent / Build Studio platform work → **WWMD** platform.
- Decide the `principle_decide` MCP tool's fate (open decision A below): deprecate, or make it a thin profile-aware delegate. The tool/skill **response names the governing profile**.
- `dpf-decision-via-kernel` body + description: state it is the **platform-development WWMD** surface; business/coworker decisions go through the Gate (WWWD). Re-scope `assignTo` off `["*"]` toward development roles (open decision B).
- AGENTS.md §16: add the **DPF-vs-DPF** disambiguation rule and the **WWMD-vs-WWWD** boundary; fold in the skill `triggerPattern` overlap tightening.
- **Verify:** a coworker decision resolves against WWWD (inheritance chain), names the profile, and does NOT cite founder-kernel platform principles as authority; a contributor decision still resolves against WWMD.

### Phase 4 — Migrate remaining `principle_decide` callers
- `build/decision-service.ts` and `kernel/runtime-gate.ts`: route through the consolidated path or scope them explicitly to the platform profile (these are platform-runtime decisions → WWMD is correct, but make it explicit, not incidental).
- **Verify:** Build Studio runtime gate behavior unchanged (regression test); no caller still reaches the raw profile-unaware path by accident.

### Phase 5 — UX disambiguation
- Build Studio **Decision Perspective Gate Panel** and coworker decision surfaces show **which profile (WWMD/WWWD) governed**, the inheritance level that produced the answer, and the outcome — so operators and coworkers can see the active kernel at a glance.
- Where a coworker is about to decide on a business question with no WWWD content yet, surface the "falling back to product doctrine" state explicitly (it's the inheritance chain, made visible).
- **Verify:** UX review — the governing profile is visible on both surfaces; the fallback state reads clearly.

### Phase 6 — Cross-surface verification + ledger coverage
- End-to-end evidence: coworker (WWWD), contributor (WWMD), Build Studio gate; every decision writes a `DecisionInteraction` row naming the profile + inheritance level.
- **Verify:** dynamic-analysis report across all three caller types.

## Open decisions for the founder

- **A. `principle_decide` MCP tool fate** — deprecate it (skill routes to a new Gate-backed decision tool) vs. keep the name but make it a thin profile-aware delegate to the Gate. Recommendation: **delegate** (preserves the tool name external clients already use; the Gate becomes the implementation).
- **B. Default profile per calling population** — external coding agents (Claude/Codex contributors) = **WWMD platform**; in-portal coworkers = **WWWD organization** (which inherits product doctrine until the org seeds its own). Recommendation: adopt this mapping; it is the boundary the perspective spec already defines.

## Risks + rollback

- **Multiple callers of `principle_decide`** (build/decision-service, runtime-gate) — Phase 1's re-export keeps them working; Phase 4 migrates them deliberately. Rollback: the engine extraction is behind a re-export, so reverting Phases 2-4 restores the parallel path without data loss.
- **Build Studio runtime gate is load-bearing** — Phase 4 carries a regression test before switching its path.
- **WWWD content is deferred** (org profile points at platform profile in this instance) — the inheritance chain already handles "no org content yet" by falling back to product doctrine, so consolidation does not block on WWWD content; it just makes the fallback explicit and correctly-bounded.
- **Versioned profiles** — `DecisionInteraction` already snapshots the profile version; the consolidation must preserve that so historical decisions still resolve against the doctrine active when they ran.

## Relationship to other work
- The skill-disambiguation sub-fix (Phase 3's §16 + trigger tightening) is the concrete piece that can land first and independently; it relates to BI-9B4ED962 / EP-REDUCTION-GEAR-ARCH.
- Builds on the shipped Decision Perspective Gate (specs 2026-05-17 / 2026-05-19) and EP-WIKI-001 per-org overlays.
