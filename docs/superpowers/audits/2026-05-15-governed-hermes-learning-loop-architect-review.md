# Architect Review — Governed Hermes Learning Loop Spec

| Field | Value |
| --- | --- |
| Date | 2026-05-15 |
| Reviewer | Chief architect pass (Claude session in worktree `musing-chatelet-14287d`) |
| Subject | `docs/superpowers/specs/2026-05-15-governed-hermes-learning-loop-design.md` |
| Spec status at review | Already shipped to `main` via PR #618; Slices 1+2 shipped via PR #621/#629; Slice 3 in flight on `feat/skill-revisions-and-proposals` |
| Hand-off | Notes for the active Slice 3 session, not a competing spec edit |

## Why this is a note instead of a spec edit

A parallel session was actively editing the spec inside the `hermes-governed-learning` worktree at the same time as this review. Direct edits collided and were reverted. This note is the safe channel: structured findings the active session can fold into the spec on its own branch, without a cross-session sweep.

## What is already covered by in-flight Slice 3 commits

These are visible on `feat/skill-revisions-and-proposals` and need no further input from this review:

- `feat(db): add SkillRevision and ImprovementProposal.targetSkillId` — confirms reuse of `ImprovementProposal` for skill diffs (no parallel `SkillImprovementProposal` table) and the `PromptRevision` mirror for `SkillRevision`.
- `feat(skills): skill proposal submit/approve/reject/rollback actions` — Slice 3 acceptance per the spec.
- `feat(skills): seed-parity drift detection` — addresses the seed/runtime drift risk directly.
- `feat(skills): MCP tool propose_skill_improvement` — MCP surface for proposals.
- `feat(ui): skill proposals + revision history + rollback on /platform/ai/skills` — the operator surface.

The architectural intent of this review is largely already on disk in code form. The residual items below are the parts not obviously covered by those commits.

## Residual architectural items the spec should still capture

### 1. Lifecycle vocabulary conflict (must decide before Slice 4)

`SkillDefinition.status` enum today is **`discovered | evaluated | approved | installed | active | deprecated`** (`packages/db/prisma/schema.prisma:6800`). The marketplace spec and the original draft of this spec use a different set: `active | stale | archived | pinned | quarantined | proposed`. The two are not synonyms — they describe different axes:

- `status` = adoption stage (how the skill entered the org and whether it is approved for use).
- The proposed states = operational health (is the skill being used, decaying, intentionally protected, under quarantine).

**Recommendation:** add `SkillDefinition.lifecycleState` as a separate column with values `active | stale | pinned | quarantined | archived`. Keep `status` for adoption stage. `proposed` is not a state on the skill — it is the state of the proposing `ImprovementProposal`. Land the typed enum in `apps/web/lib/backlog.ts` + `apps/web/lib/mcp-tools.ts` in the same migration commit (AGENTS.md §3).

### 2. `CoworkerCapabilityNeed.kind` is still a free-form String

Schema check confirms `kind` has no enum constraint today. AGENTS.md §3 ("Strongly-Typed String Enums") requires it be promoted to a typed union with values `skill | prompt | memory | tool | convention | code | other`, mirrored in `backlog.ts` + `mcp-tools.ts` in the same commit, before any data uses additional values. Worth a one-line confirmation that Slice 2's shipped work already does this; if not, it is a tiny follow-on.

### 3. The Continuous Improvement Flywheel is the parent prioritization spine

Reflection runs should emit `ImprovementSignal` rows (per `2026-04-05-continuous-improvement-flywheel-design.md`) and let the flywheel prioritize. The reflection plane is the producer; it is not a competing prioritizer. This discipline keeps the org from running two improvement routers. The spec should state this explicitly so future slices do not bypass the flywheel.

### 4. Operator Pattern applies to learning runs themselves

Reflection, curator, and evolution runs are themselves governed operators. They inherit the five-piece contract from `2026-04-30-ai-coworker-operator-pattern.md`: operator contract, skill playbooks, tool surface, persistent work products, UI surface. Without this framing, future slices will shape these runs as ad-hoc jobs. Calling it out in §5 (Design Principles) and §8 (Runtime Flows) prevents drift.

### 5. Refactoring seam — `apps/web/lib/actions/agent-coworker.ts` is 81 KB

This file is the entry point for coworker chat/work execution and is fast becoming a god-file. Skill resolution + attribution should leave it and live in a dedicated `apps/web/lib/skills/runtime.ts` service. Route handlers consume the service. §12 Refactoring Commitments should name this seam explicitly so successive slices have a target rather than continuing to extend the existing file.

### 6. Cross-references missing or under-weighted

- `2026-05-12-ai-capacity-continuity-design.md` — capacity-triggered reflection runs should reference, not redefine, the capacity handoff contract.
- `2026-05-13-realtime-hitl-mobile-companion-design.md` — open question worth surfacing: should curator findings be approvable from mobile, or only desktop operator surfaces?
- `2026-05-13-code-intelligence-graph-adoption-design.md` — Slice 8's "graduate to platform primitive" action likely benefits from CIG adoption.
- `2026-05-14-coworker-memory-shape-contracts-design.md` — defer `MemoryCandidate` definition entirely to that spec; do not redefine.
- `2026-05-14-portal-work-capsule-control-harness-design.md` — relates to TaskRun framing.

### 7. Open Questions that are now answerable as decisions

The spec has historically carried these as open. Both are now resolvable on the basis of in-flight Slice 3 work and the live schema:

- **Q: Should the first proposal object be a new `SkillImprovementProposal` table or a typed `CoworkerCapabilityNeed(kind="skill")` with diff JSON?** Resolved by Slice 3 substrate (`ImprovementProposal.targetSkillId` + `SkillRevision`). Reuse `ImprovementProposal` with `category="skill"`.
- **Q: Should lifecycle state live on `SkillDefinition` first, or be modeled separately from the start?** Resolved by item 1 above. Separate column on `SkillDefinition`, separate enum.

### 8. Risks worth adding to §14

- **Lifecycle vocabulary fragmentation** — adoption-stage and operational lifecycle drift if both are not typed enums in `backlog.ts` + `mcp-tools.ts`.
- **Substrate duplication via Hermes copy-paste** — reviewers should gate every new model against the §7.1 reuse list and require a stated reason for any new table that cannot extend an existing one.
- **Reflection plane outruns the flywheel** — reflection emits `ImprovementSignal` only; prioritization stays in the flywheel. Removing this discipline is a regression.
- **Cross-session sweep on concurrent slice work** — per AGENTS.md §4 each slice runs in its own `git worktree`; this very review's collision is the proof case.

## Suggested wording stubs

Drop into §6.1.1 (Lifecycle vocabulary reconciliation):

> `SkillDefinition.status` today is `discovered | evaluated | approved | installed | active | deprecated`. Earlier drafts and the marketplace spec used `active | stale | archived | pinned | quarantined | proposed`. The two describe different axes — adoption stage vs operational health — and must not be merged. Decision: keep `status` for adoption stage; add `SkillDefinition.lifecycleState` for operational health, valued `active | stale | pinned | quarantined | archived`. The migration that adds the column also adds the typed enum in `apps/web/lib/backlog.ts` and the matching MCP tool definition (per AGENTS.md §3). `proposed` is not a state on the skill; it is the state of the proposing `ImprovementProposal`.

Drop into §5 (Design Principles) as new principles 2–4:

> 2. **Reuse before invent.** Before any new model, service, or surface, name the existing primitive (`ImprovementProposal`, `DeliberationRun`, `TaskRun`, `CoworkerCapabilityNeed`, `PromptRevision`) and explain why it cannot serve. Substrate-creep is the easiest way to fragment governance.
> 3. **One flywheel.** This loop is the skill-and-coworker-deepening lane of the Continuous Improvement Flywheel (`2026-04-05-continuous-improvement-flywheel-design.md`). Reflection outputs become `ImprovementSignal` entries; the flywheel is the prioritization spine. Do not build a parallel router.
> 4. **Operator pattern applies to learning runs.** Every reflection, curator, and evolution run is a governed operator and inherits the five-piece contract from `2026-04-30-ai-coworker-operator-pattern.md`: operator contract, skill playbooks, tool surface, persistent work products, UI surface.

## Hand-off

The active session in `hermes-governed-learning` should treat this note as input, not a competing spec change. Anything still relevant after Slice 3 lands can be folded into the spec under the active session's normal commit cadence (with DCO sign-off). This worktree (`musing-chatelet-14287d`) will not push competing edits to the spec file.
