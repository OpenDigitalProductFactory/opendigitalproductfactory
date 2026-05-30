---
title: DPF-native skill equivalents — own the composed capabilities, retire the dangling superpowers dependency
status: draft-for-operator-review
author: Claude (Opus 4.8)
reviewers:
  - Mark (operator review pending)
date: 2026-05-30
backlog:
  - "TBD — file after operator review; live MCP check on 2026-05-30 confirmed overlap with BI-98683E68 / BI-90793048, so this should be a scope-revision child or follow-up under EP-REDUCTION-GEAR-ARCH rather than a new epic"
epics:
  - EP-REDUCTION-GEAR-ARCH
related:
  - packages/dpf-skill-pack/README.md
  - packages/dpf-skill-pack/skills/dpf-decision-via-kernel/SKILL.md
  - packages/dpf-skill-pack/skills/dpf-evidence-before-diagnosis/SKILL.md
  - packages/dpf-skill-pack/skills/dpf-pr-with-dco/SKILL.md
  - packages/db/src/seed-skills.ts
  - packages/dpf-bootstrap/src/agent-toolchain/codex-config.ts
  - packages/dpf-bootstrap/src/agent-toolchain/install-state.ts
  - scripts/dpf-bootstrap-agent-toolchain.sh
  - .claude-plugin/marketplace.json
  - .agents/plugins/marketplace.json
  - docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md
  - docs/superpowers/drafts/2026-05-24-dpf-skill-pack-formalization-bi-bundle.md
  - docs/superpowers/audits/2026-05-24-superpowers-snapshot-drift.md
related_backlog:
  - "BI-98683E68 (in-progress — auto-install dpf-platform pack; assumes upstream superpowers stays alongside; this spec revises that assumption)"
  - "BI-90793048 (triaging/captured — parent DPF skill pack formalization bundle)"
  - "BI-446E169C (in-progress pending operator sign-off — retired the manual superpowers snapshot in commit efd0924a)"
prs: []
---

# DPF-native skill equivalents

## Execution note (operator decision, 2026-05-30)

**This work is done directly in this repo, not promoted to Build Studio.** Build Studio is currently non-functional (self-upgrade quiescence deadlock fixed today in `bcaa30a8`, but the broader BS pipeline is not yet exercised on this host). The standing "Build Studio for ALL development" rule (`dpf-promote-to-build-studio`) is therefore **suspended for this BI** by explicit operator authorization. Claude authors the skills directly; the normal BS Ideate→Build→Verify gates are replaced by operator review of this spec plus the acceptance evidence below.

## Purpose

Make the DPF skill pack **self-sufficient**: the procedural capabilities its skills compose with must come from DPF's own kernel-governed source, not from an upstream collection that can drift, be retired, or simply be absent. Today three DPF skills declare hard `composesFrom` dependencies on upstream `obra/superpowers` skills that are present on **none** of the three surfaces, so those compositions dangle. This spec authors DPF-native equivalents so every `composesFrom` resolves from one source on every surface, and demotes the upstream collection to an optional convenience.

## Architecture review delta (folded in 2026-05-30)

This revision incorporates an advisory `dpf-architecture-review` pass. The important fixes:

1. **Live backlog state corrected.** `BI-98683E68`, `BI-90793048`, and `BI-446E169C` were checked through the live MCP backlog tools on 2026-05-30. `BI-446E169C` has retirement evidence but is still `in-progress` pending sign-off; this spec must not describe it as done.
2. **Installed-cache verification added.** The repo source can contain a skill that the contributor client's installed plugin cache does not yet expose. The current host already shows that class of drift: `dpf-architecture-review` exists under `packages/dpf-skill-pack/skills/` but was missing from the installed Codex plugin cache checked earlier. Acceptance must verify the refreshed client cache, not only the source tree.
3. **Scope narrowed.** Slice 1 owns the three hard `composesFrom` dependencies and removal of upstream references from existing DPF skill/README prose. It does **not** author generic planning or verification skills unless a follow-up BI is filed.
4. **Lint target clarified.** The no-dangling test must validate every `composesFrom` slug against the names in `packages/dpf-skill-pack/skills/*/SKILL.md`. Bare upstream slugs such as `brainstorming` or `systematic-debugging` are invalid even if a contributor happens to have an upstream plugin installed.

## Problem Statement

Verified this session (2026-05-30) against the live repo and runtime:

1. **The upstream baseline was retired without a complete replacement.** BI-446E169C recorded evidence that commit `efd0924a` deleted the manual `obra/superpowers` v5.0.5 snapshot — `docs/Reference/superpowers/` is gone and `.claude/commands/` is reduced to two DPF-only files (`build-studio-operator.md`, `tool-evaluation.md`). The item remains `in-progress` pending operator sign-off. The intended replacement was the DPF plugin auto-install path (BI-98683E68); that path installs `dpf-platform`, not upstream superpowers.

2. **Nothing provisions upstream superpowers on any surface.** Neither `scripts/dpf-bootstrap-agent-toolchain.sh` (installs only `dpf-platform@dpf-platform-local`), `codex-config.ts` (upserts only `[plugins."dpf-platform"]`), nor `seed-skills.ts` (loads only legacy `skills/` + `packages/dpf-skill-pack/skills/`) installs or seeds superpowers. The only `superpowers@openai-curated` occurrences in the implementation path are test fixtures / historical config fixtures. `install-state.ts:18` reserves a `superpowersVersion` field that is hardcoded `null`.

3. **Three skills carry dangling hard dependencies.** In `packages/dpf-skill-pack/skills/`:
   - `dpf-decision-via-kernel` → `composesFrom: ["brainstorming"]`
   - `dpf-evidence-before-diagnosis` → `composesFrom: ["systematic-debugging"]`
   - `dpf-pr-with-dco` → `composesFrom: ["finishing-a-development-branch"]`
   Plus prose references to `writing-plans` (in `dpf-file-backlog-item`) and `verification-before-completion` (in `dpf-pr-with-dco`).

4. **The regression is worst on Claude Code.** A fresh Claude Code session from repo root lists **zero** `superpowers:*` skills (confirmed: this session's available-skills list contains `dpf-platform:*` but no superpowers entries). The compositions silently resolve to nothing.

5. **Build Studio never had them.** The composed slugs are not `SkillDefinition` rows; `seed-skills.ts` has no superpowers source, so a coworker invoking a composing skill cannot follow the composition.

6. **Codex resolves them only by luck.** Resolution depends on whether the contributor's `~/.codex/config.toml` happened to already carry `[plugins."superpowers@openai-curated"]`. DPF guarantees nothing.

## The decision (WWMD / kernel)

The choice — re-import upstream vs. own the capabilities — was put through the kernel. Because the live `principle_decide` MCP tool was unreachable (the `$DPF_MCP_BEARER_TOKEN` lacks the `registry_read` scope, and the portal was wedged in a stuck quiescence drain, since fixed), the same `decide()` math (`apps/web/lib/wiki/principle-decide.ts`) was run locally over the **live commandment set** pulled from Postgres (`WikiPage`, `principleTier=commandment`, `appliesTo=external_coding_agent`).

Options scored against `PRINCIPLE_DIMENSIONS`:

| Option | Composite | Notes |
|---|---|---|
| **author-dpf-native-equivalents** | **+3.53** | winner; margin 0.55 vs 0.20 tie threshold → high confidence; no commandment conflict |
| surface-a-autoinstall | +2.98 | the fast Surface-A-only patch |
| surface-a-plus-build-studio | +2.96 | A + vendor superpowers rows into BS seed |

Top positive contributors to the winner: *All Changes Land via PR Against Main*, *Never ask the user to run commands*, *Build Gate (Mandatory)*, *DCO Sign-Off Required*. The decisive principle class is **Architecture Over Shortcuts** (rewards long-term maintainability / schema grounding, penalizes speed-to-value): this entire gap was *caused* by depending on an external snapshot that drifted and was retired with no replacement. The kernel argues against rebuilding that same fragility — own the capability instead.

The kernel **inverted the agent's initial default** (the fast Surface-A patch). That inversion is the signal the consultation added value.

**Caveat for the reviewer:** the result is a structured reproduction over commandments only; the live tool would additionally blend Qdrant-sourced core/contextual principles (lower weight, semantic). The 0.55 margin is large enough that this is very unlikely to flip, but a live re-run with a `registry_read`-scoped token is the higher-fidelity confirmation and is recommended before final ratification. Feature scores were the author's estimates and are recorded in the BI for audit.

## Relationship to existing work (not a duplicate)

- **BI-98683E68** (in-progress, child 4 of 7 under **BI-90793048**) auto-installs the *dpf-platform pack* and handles "Surface-A conflict resolution against superpowers" — it assumes upstream superpowers is present alongside. This spec **revises that assumption**: the pack becomes self-sufficient, so BI-98683E68's job narrows to installing the DPF pack (no upstream dependency to reconcile). The two should be cross-referenced, not merged; BI-98683E68 may need a scope note once this lands.
- **Bootstrap design** `2026-05-26-agent-toolchain-bootstrap-design.md` mandates both superpowers + dpf-platform on every surface (acceptance §307). That acceptance criterion is **superseded** for the superpowers half: once equivalents are DPF-native, the "lists `superpowers:*`" criterion becomes "lists the DPF-native capability skills."

## Design

### What to author

DPF-native SKILL.md files under `packages/dpf-skill-pack/skills/<slug>/`, superset frontmatter (one file feeds Claude + Codex plugin and the Build Studio seed loader), kernel-governed. Proposed slugs and scope:

| New DPF-native slug | Replaces upstream | Core procedure to carry forward + DPF deltas |
|---|---|---|
| `dpf-brainstorming` | `brainstorming` | Generate 2-4 distinct options before converging. DPF delta: hands off to `dpf-decision-via-kernel` when options are architecturally distinct; saves design docs to `docs/superpowers/specs/` and plans to `docs/superpowers/plans/` only after a filed BI exists. |
| `dpf-systematic-debugging` | `systematic-debugging` | 4-phase root-cause process, **substantially DPF-adapted** — see §"DPF debugging considerations" below. Not a generic port. |
| `dpf-finishing-a-development-branch` | `finishing-a-development-branch` | Integration-shape decision (merge / PR / stack). DPF delta: hands off to `dpf-pr-with-dco` for the DCO/overlap-sweep mechanics. |

Slice-1 authoring rule: original DPF prose only. Do not copy upstream `obra/superpowers` skill bodies verbatim unless a later tool-evaluation/licensing review explicitly approves it.

Candidates for a second slice (prose-only references today): `dpf-writing-plans` (the plan that sits behind a filed BI), `dpf-verification-before-completion`. Defer these to a follow-up BI. Slice 1 still updates existing DPF prose so it no longer instructs agents to invoke `superpowers:*`.

### Non-goals

- No new skill format, seed source, or runtime registry. `packages/dpf-skill-pack/skills/*/SKILL.md` remains the single source of truth.
- No Build Studio schema migration. The existing `SkillDefinition.composesFrom` JSON field is sufficient.
- No installer dependency on upstream `superpowers`.
- No big-bang rewrite of legacy `skills/<category>/*.skill.md`.
- No hard requirement that this work run through Build Studio while the operator has explicitly suspended that path for this BI.

### Files to change

| Area | Required edits |
|---|---|
| New skills | Add `packages/dpf-skill-pack/skills/dpf-brainstorming/SKILL.md`, `dpf-systematic-debugging/SKILL.md`, `dpf-finishing-a-development-branch/SKILL.md` with complete superset frontmatter, `assignTo: ["*"]`, and `enforces` entries. |
| Existing skill frontmatter and prose | Update `dpf-decision-via-kernel`, `dpf-evidence-before-diagnosis`, and `dpf-pr-with-dco` `composesFrom` fields and descriptions. Also clean prose-only references in `dpf-file-backlog-item`, `dpf-worktree-per-session`, and `dpf-pr-with-dco` so the pack no longer tells agents to invoke upstream `superpowers:*`. |
| Skill pack docs/catalogue | Update `packages/dpf-skill-pack/README.md` and AGENTS.md §16 entries so the shipped-skill table and trigger catalogue name the DPF-native slugs. |
| Seed/test layer | Extend `packages/db/src/seed-skills.test.ts` with a no-dangling-`composesFrom` invariant. The test should parse every plugin skill, collect frontmatter `name`, and fail on any `composesFrom` value not in that set. |
| Bootstrap state | Decide in `packages/dpf-bootstrap/src/agent-toolchain/install-state.ts` and `types.ts` whether `superpowersVersion` is removed in a migration-compatible way or retained as advisory/deprecated. If retained, readiness must not depend on it. Update fixture tests accordingly. |
| Installer/cache refresh | Ensure the DPF plugin install/refresh path updates the installed client cache when package contents change, not just when the plugin entry is first created. Acceptance evidence must include a refreshed Claude/Codex skill listing. |

### DPF debugging considerations (operator-flagged 2026-05-30)

`dpf-systematic-debugging` is the skill that diverges most from its upstream namesake. Generic systematic-debugging is "form a hypothesis, test it, isolate the variable." DPF debugging adds discipline the kernel already encodes, because the failure modes here are substrate- and concurrency-shaped, not just logic bugs. The body must encode:

1. **Evidence before diagnosis (hard gate).** Before naming any cause, query the live runtime — don't read a log line and adopt its *suggested* cause. Composes with the existing `dpf-evidence-before-diagnosis` skill as the mandatory predecessor. Enforces the `evidence-before-diagnosis` kernel principle.
2. **Structural verification is not functional.** A fix that compiles, type-checks, or passes a structural check is **not** verified. Require functional evidence the symptom is actually gone (the running thing behaves correctly), per the `structural-verification-is-not-functional` commandment. This is the single most DPF-specific debugging rule.
3. **Concurrency / peer-session check (DPF-unique).** Before diagnosing a "stuck", "wedged", or "broken" shared-substrate state, check whether another session, worktree, or agent is already acting on it. The `propose-acknowledge-reassign` discipline: a peer may have the fix in flight. *(This session's worked example: the portal was stuck `draining`; the real story was a peer session had already committed the fix and was mid-rebuild — diagnosing "the quiescence logic is broken" and re-fixing it would have collided.)*
4. **Substrate verification before "it's missing/broken".** Use the available code-search surfaces (`rg`, MCP `search_project_files`, or MCP source/version tools), the live backlog, and a main-branch sweep before concluding a component is absent or defective — the architecture is denser than first reads suggest. Composes with `dpf-verify-substrate-first`.
5. **DPF evidence-source catalog.** The body enumerates *where* to look, concretely: live Postgres (`dpf-postgres-1`), MCP `tools/list` + status fields, container logs (`docker logs`), the quiescence-state route / `QuiescenceRun` rows, Build Studio run state, `~/.dpf/install-state.json`, version/build-identity stamps. Each with the read-only command shape.
6. **A DPF worked example** (the stuck-quiescence-drain investigation: budget exceeded + null heartbeat → coordinator deadlock evidence, then the peer-session discovery) so the skill teaches the pattern, not just the rule.

This makes `dpf-systematic-debugging` the connective tissue across three skills DPF already owns (`dpf-evidence-before-diagnosis`, `dpf-verify-substrate-first`) rather than a standalone copy — which also strengthens the case for owning it natively rather than importing upstream.

### `composesFrom` resolution

Re-point the three dangling references to the new DPF-native slugs:
- `dpf-decision-via-kernel`: `["brainstorming"]` → `["dpf-brainstorming"]`
- `dpf-evidence-before-diagnosis`: `["systematic-debugging"]` → `["dpf-systematic-debugging"]`
- `dpf-pr-with-dco`: `["finishing-a-development-branch"]` → `["dpf-finishing-a-development-branch"]`

Update the prose callouts in all skill bodies and `packages/dpf-skill-pack/README.md` accordingly. Historical specs/audits may keep `superpowers` references when they are explicitly describing the old dependency; operational skill bodies and current catalogues may not.

### Upstream superpowers becomes an optional stopgap

Not a hard dependency. If a contributor has `superpowers@openai-curated` installed, the namespacing (`dpf-platform:*` vs the upstream namespace) means no collision. The optional Surface-A auto-install (BI-98683E68 territory) may remain as a convenience bridge but is no longer required for the pack to function. Decision: **stop tracking `superpowersVersion`** as a required readiness field (or mark it advisory) once equivalents land.

### Surface wiring (no new mechanism needed)

The three surfaces already consume `packages/dpf-skill-pack/skills/`. Authoring new SKILL.md files there means:
- **Claude / Codex:** picked up by the existing plugin marketplaces (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`) — no toolchain change.
- **Build Studio:** picked up by `seed-skills.ts` on the next seed run as `SkillDefinition` rows, assigned per `assignTo` frontmatter.
The mirror-field invariant test in `seed-skills.test.ts` will enforce frontmatter parity, so each new skill must carry both Surface-A and Surface-B fields.

The implementation must still prove cache refresh. A repo-level marketplace entry is not enough: after package content changes, a contributor client may still show an older cached plugin. Verification must include the installed Claude/Codex skill list after the refresh/install helper runs, and must catch missing new skills such as `dpf-architecture-review` did on this host.

## Operator decisions and remaining questions

1. **Licensing / carry-forward.** Resolved for slice 1: author original DPF procedures, do not copy upstream prose. If future work wants verbatim upstream text, run the Tool Evaluation Pipeline (EP-GOVERN-002) first.
2. **Slice scope.** Resolved for slice 1: author the 3 hard-dependency skills and clean current DPF prose/catalogue references. File `dpf-writing-plans` and `dpf-verification-before-completion` as slice 2 if still valuable after slice 1 lands.
3. **`assignTo` for Build Studio.** Resolved (operator, 2026-05-30): universal `["*"]` for all three skills. Every coworker gets brainstorming, debugging, and finishing-a-branch.
4. **Backlog shape.** Remaining: after operator review, file or update the BI under EP-REDUCTION-GEAR-ARCH. Because live backlog already has BI-98683E68 and BI-90793048 covering the surrounding substrate, prefer a scoped child/follow-up over a new epic.

## Acceptance criteria

- A DPF-native SKILL.md exists for each slice-1 capability (`dpf-brainstorming`, `dpf-systematic-debugging`, `dpf-finishing-a-development-branch`), superset frontmatter, passing the `seed-skills.test.ts` mirror-field invariant.
- All `composesFrom` references in the pack resolve to skills that exist in the pack (no dangling slugs). A unit test asserts this and fails on bare upstream slugs.
- A fresh Claude Code session and a refreshed Codex plugin cache from repo root list the new skills; the three composing skills' bodies reference the DPF-native slugs, not `superpowers:*`.
- A portal seed run produces `SkillDefinition` rows for the new skills, assigned per `assignTo`.
- `packages/dpf-skill-pack/README.md` and AGENTS.md §16 describe the DPF-native compositions and no longer present upstream `superpowers:*` as operational dependencies.
- No hard runtime dependency on `obra/superpowers`; with it installed, no collision (namespaced).
- `superpowersVersion` readiness tracking is updated (advisory or removed) and the bootstrap-spec acceptance criterion is reconciled.
- Verification evidence captured across all three surfaces: contributor client skill list, portal seed/SkillDefinition rows, and the no-dangling test.

## Verification plan

Run the narrow checks while implementing, then the normal build gate before PR:

- `pnpm --filter @dpf/db exec vitest run src/seed-skills.test.ts src/skill-quality-audit.test.ts`
- `pnpm --filter @dpf/db exec prisma validate`
- `pnpm typecheck`
- `pnpm --filter web build`
- Plugin validation for both manifests/marketplaces where the local CLIs are available.
- Portal seed verification: run `seedSkills` or the portal-init seed path against the local Postgres install and confirm `SkillDefinition` rows for the three new names with `sourceType = 'dpf-platform-plugin'`.
- Contributor-surface verification: after running the DPF plugin install/refresh helper, confirm Claude/Codex list the three new skills from the installed cache, not only from the repo source.

## Implementation phases

- **Phase 0 — operator review of this spec** (current). Confirm the remaining backlog-shape decision.
- **Phase 1 — author slice-1 skills** + re-point `composesFrom` + update all operational prose/catalogue callouts. Add the no-dangling-`composesFrom` test.
- **Phase 2 — wiring reconciliation:** update `install-state.ts` / `types.ts` `superpowersVersion` treatment; add a scope note to BI-98683E68; reconcile the bootstrap-spec acceptance criterion.
- **Phase 3 — cache and surface verification:** refresh installed plugin caches, run seed verification, and capture evidence from contributor + portal surfaces.
- **Phase 4 — PR with DCO** via `dpf-pr-with-dco` after the build gate is green.
