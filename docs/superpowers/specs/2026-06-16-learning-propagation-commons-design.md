# Learning Propagation — the Shared Commons Routing Path

- **Status:** design / ready-to-implement (artifacts in this PR)
- **Date:** 2026-06-16
- **Epic:** EP-LEARNING-COMMONS
- **Kernel principle ratified:** [`learnings-belong-in-the-shared-commons`](../../founder-kernel/wiki/principles/learnings-belong-in-the-shared-commons.md)
- **Related epics:** EP-REDUCTION-GEAR-ARCH (ring-5-hive), EP-WWMD-MCP, EP-WSID, EP-CLIENT-HOOK-PLANE, EP-INTAKE-UNIFY

## 1. Problem

Learnings confirmed in a session land in **client-local memory** (Claude Code's `~/.claude` memory dir, a Codex note, or nowhere) instead of the shared substrate. The three pillars —

- **WWMD** = shared decision rules (founder kernel; `principle_decide` / `wiki_query`),
- **WWWD** = shared org/platform facts (platform knowledge; `searchPlatformKnowledge` / `search_knowledge`),
- **WSID** = shared profession technique (profession corpus; `SkillDefinition` + `WikiPage.metadata`)

— are already the right home and are **already queried server-side by every agent** (Claude, Codex, Build Studio coworkers, the local model). The gap is **capture and routing**: it is manual and lossy, so knowledge stays "selfish" to one client. This is the knowledge-layer sibling of `one-data-model` and `native-cohesion-over-interfacing`: storing a learning where only one client can use it is a **defect**. Only genuinely install-specific **config** stays local.

This is the meta-capability behind "the platform gets robust on its own": a problem solved once should never be solved again, by anyone.

## 2. Substrate verification — no new tables

Per `verify-substrate-before-proposing-new`, every destination and channel already exists. **No new tables, types, or parallel stores.**

| Need | Existing substrate | Evidence |
|---|---|---|
| Shared decision rules (WWMD) | `WikiPage` (`pageKind=principle`, `isKernel`), seeded from `docs/founder-kernel/wiki/principles/*.md` by `seedWikiKernel()`; read by `principle_decide` / `wiki_query` | `packages/db/src/seed-wiki-kernel.ts`; `apps/web/lib/mcp-tools.ts` (`principle_decide`) |
| Shared org/platform facts (WWWD) | `WikiPage` org overlays (draft→review→publish) + `KnowledgeArticle`; indexed in Qdrant; written via `propose_improvement` / `doc_save` | `apps/web/lib/inference/semantic-memory.ts` (`searchPlatformKnowledge`); `mcp-tools.ts` |
| Shared profession technique (WSID) | `SkillDefinition` + `SkillAssignment` from `SKILL.md`; `WikiPage.metadata` profession axes; written via `propose_skill_improvement` / authoring a skill | `packages/db/src/seed-skills.ts`; `apps/web/lib/coworker-record/variant-axes.ts` |
| Code contract | repo + `AGENTS.md`, filed via `create_backlog_item` + PR | AGENTS.md §6 |
| Governed review gate | `ImprovementProposal` intake; `WikiPage` overlay draft→publish (`list_wiki_overlay_drafts` / `publish_wiki_overlay_pages`); kernel PR ratification; `WikiPageRevision` audit | `apps/web/lib/wiki/wiki-publish.ts`; `mcp-tools.ts` |
| Cross-install propagation | `contribute_to_hive` → `FeaturePack` + upstream PR → `run_hive_scout_ingest` (weekly) → backlog on other installs; `escalate_feedback_upstream` + `HiveContributionLedger` | `mcp-tools.ts` (`contribute_to_hive`, `run_hive_scout_ingest`); `apps/web/lib/actions/hive-scout/` |

What was **missing** was not storage — it was (a) a **ratified principle** stating local-only knowledge is a defect, and (b) a single **capture→classify→route step** stitching the existing tools together as the path of least resistance. Adjacent specs imply the doctrine but never ratify it: `2026-05-15-governed-hermes-learning-loop-design.md`, `2026-05-14-hive-scout-wikipage-synthesis-design.md`, `2026-05-14-coworker-memory-shape-contracts-design.md`.

## 3. Design

Three artifacts, all reusing existing substrate:

1. **Kernel principle (WWMD)** — `learnings-belong-in-the-shared-commons` (core tier, universal archetype, all three populations, `principlePublic: true`). Auto-seeded by `seedWikiKernel()` (no manifest edit). Ratified on PR merge per `all-changes-land-via-pr`.
2. **Routing skill** — `packages/dpf-skill-pack/skills/dpf-route-learning-to-commons/SKILL.md`. Dual-surface (Claude Code/Codex plugin + in-portal coworker via `seed-skills.ts`). Auto-discovered (`plugin.json` globs `./skills/`). Reuses `propose_improvement`, `doc_save`, `propose_skill_improvement`, `create_backlog_item`, `save_build_notes`, `contribute_to_hive`, `escalate_feedback_upstream`, `flag_stale_knowledge`. Composes after `dpf-evidence-before-diagnosis`; reuses `dpf-capture-kernel-gap`, `dpf-record-decision-outcome`, `dpf-file-backlog-item`.
3. **Path of least resistance** — a First Principle pointer + a §16 skill-catalogue entry in `AGENTS.md` (the always-read rulebook), so an agent defaults to sharing rather than hoarding.

### 3.1 Classify → route decision table

| If the learning is a… | Lane | Route via | Then |
|---|---|---|---|
| Decision rule / durable judgment | **WWMD** | PR a kernel principle page; or `save_build_notes` + `dpf-capture-kernel-gap` when the kernel can't yet answer | `contribute_to_hive` |
| Durable org / platform fact | **WWWD** | `propose_improvement` (reviewable proposal + platform-knowledge index); `doc_save`; `flag_stale_knowledge` to supersede | `contribute_to_hive` |
| Role / profession technique | **WSID** | `propose_skill_improvement`; or author a `SKILL.md` | `contribute_to_hive` |
| Code contract / invariant | **repo + AGENTS.md** | `create_backlog_item` (BI) → PR code + doc together | `contribute_to_hive` |
| **Install-specific config** | **(stays local)** | local memory / env — explicitly named as the one correct local outcome | — |

### 3.2 Cross-install propagation flow

```
Confirmed finding (any agent: Claude / Codex / BS coworker / local model)
  → classify (WWMD | WWWD | WSID | code)
  → route through the governed channel for that lane (review gate; approves on evidence, not provenance)
  → contribute_to_hive  → FeaturePack + upstream PR
        → (other install) run_hive_scout_ingest (weekly) → backlog suggestion / pull
  → surfaced server-side to every agent on THIS install via WWMD/WWWD/WSID queries
```

Local memory is, at most, a **staging/origin record** — a pointer to the commons entry, never the source of truth.

## 4. Research & Benchmarking

- **Karpathy "LLM OS" / procedural-memory pattern** (adopted by `2026-05-15-governed-hermes-learning-loop-design.md`): skills are procedural memory; learning is a background, reviewed loop, not a self-mutation. *Adopted:* learnings leave a run only through auditable, attributed, reviewed channels. *Rejected:* direct agent self-write to shared state (no review, no provenance).
- **Cline / Cursor "rules" files and Claude Code memory** (the incumbent local-memory pattern): per-client, per-machine, not shared, lost on reinstall. *Anti-pattern identified:* this is exactly the silo this principle names as a defect. *Gap filled:* a governed promotion path from local origin to shared commons.
- **Wikipedia / org-wiki review model** (mirrored by DPF's `WikiPage` draft→review→publish): a fact has one canonical home, edits are revisioned, promotion is gated. *Adopted:* `single-source-of-truth` + overlay review gate.
- **Federated knowledge / "hive" upstreaming** (DPF `contribute_to_hive` + `run_hive_scout_ingest`): contributions flow to an upstream and are pulled/ingested by peers, with consent gating and rate limits. *Adopted as-is:* the cross-install plane already exists; this design routes into it rather than building a new one.

## 5. Acceptance

A finding confirmed by Claude, Codex, a Build Studio coworker, **or the local model** can be captured once and then surfaces to **all** of them on the same install (via WWMD/WWWD/WSID server-side queries) and to **other installs** (via the hive) — with a governed review gate, not a manual "remember to promote." Verified with three real session learnings:

- "single-GPU local inference must be serialized" → **WWWD** fact.
- "check tool return values before blaming the model" → **WWMD** (kernel `check-tool-signals-first`).
- DPF portal-driving technique → **WSID** / skill.

See the PR's worked-example section for the routed proposal/PR/BI ids and the hive contribution id.

## 6. Out of scope / follow-ups

- A `SessionEnd` hook that *prompts* the route step automatically belongs to **EP-CLIENT-HOOK-PLANE** (six lifecycle-event hooks). This design makes the skill the path of least resistance; auto-firing it at session end is a separate, hook-plane BI so the orchestration lands where that epic owns it.
- Consolidation of the WWMD/WWWD decision surfaces (the Decision Perspective Gate, BI-E1FB2307) is unchanged by this work.
