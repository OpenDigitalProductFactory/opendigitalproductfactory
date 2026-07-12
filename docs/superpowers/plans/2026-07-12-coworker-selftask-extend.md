# Plan — Extend the autonomous self-task pattern to a new coworker (BI-E962B9CD)

**Kernel decision (2026-07-12, external_coding_agent, high confidence 11.67):** `curated-artifact-expansion` — add a *few* more curated registry entries, only for coworkers that genuinely meet the anti-fabrication floor, over capability-derived auto-registration or a propose-boundary-universal rollout.

## What the anti-fabrication floor actually is (evidence)

A rigorous sweep found the naïve floor (`coworkerArtifact: true`) is wrong: of the 3 existing self-tasks, only marketing's tool carries `coworkerArtifact`. Inventory (`create_knowledge_article`) and docs (`doc_save`) qualify via the **forced-fallback + `hasRecentArtifact` dedup** mechanism, not the artifact exemption. The real, functional floor is: the coworker (a) holds a grounded artifact-write tool on its route, (b) has a real data source to ground it, and (c) has a Prisma model for an idempotent dedup. Under that floor the eligible set is small — most coworkers are correctly excluded (business-fact writes like CRM `create_*`; no route, e.g. SOC subagents; or no artifact writer, e.g. finance).

## The one clean new candidate: AI Ops Engineer (`platform-engineer`, `/platform`)

- Holds `registry_write` → `create_knowledge_article` (grant-gated; autonomous tool resolution keys on `agentId`, not route, so the tool attaches exactly as it does for inventory-specialist).
- Real data source: `agent_control_read` over provider status, model profiles/tiers, token spend, failover chains, agent assignments, scheduled jobs.
- Idempotent artifact: a "AI platform posture" knowledge article, deduped per-topic on a stable title prefix.

## The collision fix (necessary + hardening)

Inventory's `hasRecentArtifact` deduped on **any** recent `KnowledgeArticle` — a latent bug that would make a second knowledge-article coworker's article stand down inventory's task (and vice-versa). Fixed by scoping the dedup to a **stable title prefix** per topic:
- `ESTATE_POSTURE_ARTICLE_TITLE_PREFIX = "Estate posture summary"` (inventory)
- `AI_PLATFORM_POSTURE_ARTICLE_TITLE_PREFIX = "AI platform posture summary"` (platform)

Shared `hasRecentKnowledgeArticle(prefix)` helper; each self-task's fallback title AND its loop prompt use the matching prefix so the dedup recognizes the coworker's own article. `KnowledgeArticle` has no slug, so a title prefix is the stable per-topic key.

## Changes

- `coworker-self-tasks.ts`: add the `platform-engineer` registry entry (grounded prompt, `/platform`, conservative sub-daily cadence Thu / Thu+Sun); add its required-tool fallback; scope both knowledge-article dedups to their title prefix via the shared helper; refine inventory's prompt to emit the stable title prefix.
- Tests: platform entry registration + grounding assertions; per-topic dedup asserts each coworker queries its OWN disjoint title prefix (the collision guard); cadence stays sub-daily.

## Non-goals / documented exclusions

- `licensing-specialist` — strong data grounding but its `save_licensing_investigation` writes posture *fields*, not a standing content artifact; deferred until a content-artifact tool exists.
- CRM / customer-advisor — business-fact rows, excluded by the existing rationale.
- SOC agents — the only grounded `coworkerArtifact: true` tools, but no interactive route.
- finance — `financial_report_create` maps only to a read tool; no artifact writer / model.

## Verification

Worktree typecheck green; scheduled-jobs + proactivity suites 80/80 (incl. the per-topic dedup collision guard). Runtime: `pnpm run pregate`; live — set the AI Ops Engineer to Balanced/Assertive on /platform, trigger the scheduled run, confirm a grounded "AI platform posture summary …" KnowledgeArticle appears and does NOT stand down the estate-posture task.
