# Shared multi-coworker effort context — implementation plan

- **BI:** BI-23A65B81 (EP-8C706944 — AI Coworker Memory & Context Architecture, Phase 3)
- **Date:** 2026-07-09
- **Kernel ledger:** DI-F69AE978B70C
- **Status:** Substrate + core + runner + coworker door (this PR)

## Problem

Work spanning many coworkers and sessions **outside Build Studio** was stitched only by shared FKs (`backlogItemId` / `epicId`). No object held the shared working context — decisions made, open questions, scratch notes — readable and writable by every participant, so a coworker joining an effort in a fresh session had nothing to rehydrate from.

## Substrate-first finding (mandated by the BI)

- **PhaseHandoff** — NOT reusable: it is build-phase-scoped (FK to a `FeatureBuild`, `fromPhase`/`toPhase`) and is now **actively used** by the Build Studio phase machine (`build-orchestrator`, `phase-compaction-wire`, `mcp-tools`). The earlier "dead schema" note was stale.
- **WorkCapsule** — NOT reusable: it is a single-executor, single-lease unit of WIP (one worktree, one `leaseHolderPrincipalId`); an effort spans *many* capsules. It is the natural child of an effort, not the shared context itself.

Neither models context shared across many coworkers over an effort's lifetime, so the kernel decision (DI-F69AE978B70C) sanctioned **exactly one** new concept here.

## Design

1. **Store** `EffortContext` (new table, additive/data-safe migration `20260709150000_add_effort_context`): keyed by a free `effortKey` (e.g. `epic:EP-1234`, `bi:1234`), with append lists `decisions` / `openQuestions` / `notes` and a `participantAgentIds` set; optional `epicId` / `backlogItemId` links.
2. **Pure core** `effort-context.ts`: `EFFORT_ENTRY_KINDS` (decision | open-question | note), `applyEffortEntry` (route to list, idempotent dedupe, cap at `EFFORT_LIST_CAP`, record author), `formatEffortContextBriefing` (rehydration block, null when empty). Deterministic → 8 unit tests.
3. **Runner** `effort-context-runner.ts`: `recordEffortEntry` (upsert-by-effortKey so any coworker in any session appends to the same context), `loadEffortContext`, `loadEffortContextBriefing`.
4. **Coworker door** `effort-context-pack.ts`: `record_effort_context` + `read_effort_context`, appends attributed to the calling coworker (`context.agentId`). Ungated like the working-memory pack — a collaborative append to an effort you are on cannot exceed authority. Registered in `TOOL_PACK_REGISTRY` (module-size baseline bumped for the one-line import). → 7 pack tests.

Rehydration follows Linear's artifact-as-memory: the effort record briefs each session. A coworker names the effort by key at the start of work, reads the shared context, and appends as it goes.

## Non-goals (own BIs / follow-ups)

- Auto-associating a chat thread with an effort (so the context injects without an explicit key) — the harder half; deferred. The door gives coworkers explicit read/append now.
- Summarizing `ToolExecution` into the effort context as an episodic trail — a later enrichment.
- Org-vs-user visibility of effort context → composes with BI-1772D0B7.

## Verification

- Unit: `effort-context.test.ts` (8), `effort-context-pack.test.ts` (7, incl. the real description-hygiene patterns), `tool-registry.test.ts` green, `tool-description-hygiene.test.ts` green.
- Runtime (post-merge): coworker A records a decision on `epic:EP-1234`; coworker B, in a separate session, reads the same effort context and sees A's decision + both as participants.
