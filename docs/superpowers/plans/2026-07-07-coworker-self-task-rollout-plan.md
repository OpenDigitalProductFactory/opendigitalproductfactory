# Coworker Proactivity → autonomous self-task rollout (BI-E962B9CD)

**Epic:** EP-B9DD37C7 — Coworker chat: runtime truthfulness, transparency & controls
**BI:** BI-E962B9CD (large / build) — extend the Marketing Strategist autonomous self-task pattern to all *applicable* interactive coworkers, with a per-coworker anti-fabrication floor.
**Author:** Claude (in-platform coworker) · 2026-07-07
**Kernel decision:** `principle_decide` → **moderate** rollout (composite 7.43 vs conservative 7.29 vs aggressive 4.05; governing profile "organization"; ringScope ring-2-workflow + ring-5-hive). The thin moderate↔conservative margin is resolved by the BI's own guardrails ("where applicable", "fabrication is the failure mode").

---

## 1. What already exists (verified substrate)

- **Registry:** `apps/web/lib/operate/scheduled-jobs/coworker-self-tasks.ts`
  - `COWORKER_SELF_TASKS` (agentId → `{title, prompt, routeContext, cadence:{balanced,assertive}}`) — only `marketing-specialist` before this change.
  - `coworkerSelfTaskRequiredTool(agentId)` — the anti-fabrication FLOOR: a forced-fallback artifact tool + `hasRecentArtifact()` recency guard, so a real DB row is guaranteed even if the model produces nothing, and duplicates are suppressed.
  - `reconcileCoworkerSelfTask(userId, agentId, level)` — fires from `saveCoworkerProactivityPreference` (`proactivity.ts`): quiet → deactivate, balanced → weekly cron, assertive → daily cron, de-conflicted against `SCHEDULING_MAP`.
- **Dispatch:** Inngest `agent/task-dispatch` (`*/5`) → `executeScheduledAgentTask` → `executeAutonomousAgenticLoop`. #2685 plumbs the route `modelRequirements` (frontier floor) + the required-tool guarantee.
- **Tool/agent binding (decisive):** the scheduled loop binds the acting coworker and its tool surface to **`task.agentId` (explicit)** via `resolveAutonomousWorkTools({ agentId })` and `resolveAutonomousWorkAgent({ agentId, routeContext })`. `routeContext.domainTools` is only a **prompt hint** (`prompt-assembler.ts`); the hard gate is the coworker's capability **grant**. The force-execute floor runs through `governedExecuteTool`, which enforces grants. → A coworker qualifies only if it is **granted** the artifact capability.

## 2. The applicability bar (why "where applicable", not "for all")

The marketing brief works because it is a **planning/analysis artifact** the coworker regenerates from real org context — benign if generic, useful when grounded. Most other write-tools create **business-fact rows** (Opportunity, Quote, CustomerAccount, Employee, EaElement). Auto-generating *those* on a cadence **is** the fabrication failure mode — inventing deals, employees, or architecture. A coworker earns a self-task only when it has:

1. a role-appropriate **recurring artifact that is safe to regenerate** (an internal analysis/reference/plan, not a business-fact and not a false-alarm-risk finding);
2. a **granted** create/write MCP tool for it;
3. a primary **routeContext** surface; and
4. it is **not already autonomous** by another path.

The only domain-agnostic "save review/analysis" artifact class in the codebase is marketing's (`save_marketing_review`, `create_marketing_campaign_brief`, `record_marketing_kpi_checkpoint`). So the safely-applicable additive set is small — this is a genuine finding, not under-delivery.

## 3. Per-coworker determination (all 12 evaluated)

| coworker | grant | verdict | rationale |
|---|---|---|---|
| **inventory-specialist** | registry_write | **INCLUDE** | `create_knowledge_article` → `KnowledgeArticle` (no dedup → recency guard). Internal reference doc grounded in the real discovered estate. `/inventory`. Distinct from its already-autonomous discovery-triage. |
| **doc-specialist** | document_write | **INCLUDE** | `doc_save` with a **stable documentId** (`DOC-COWORKER-DOCS-HEALTH`) → upsert = one living "docs-health overview", versioned, never duplicated. `/workspace/documents`. |
| marketing-specialist | marketing_write | (baseline) | Already shipped (#2674/#2685). |
| customer-advisor | crm_write | SKIP | `create_opportunity`/`create_quote`/`create_customer_account` are **business-fact rows** — auto-creating = fabricating deals/accounts. No safe CRM analysis artifact exists. |
| ops-coordinator / coo / platform-engineer | backlog_write | SKIP | Only `create_backlog_item` (deduped). Auto-filing backlog items is work-creation noise, not a "keep-my-surface-fresh" artifact. |
| compliance-officer | policy_write | SKIP | `create_licensing_readiness_issue` is a **finding**; a fabricated compliance flag is a false alarm (worse than an empty page — implies legal exposure that isn't real). Fails "safe-if-fabricated". |
| ea-architect | ea_graph_write | SKIP | `create_ea_element` = fabricating architecture; `/ea` has no agent tools. |
| storefront-advisor | marketing_write | SKIP | Its marketing artifacts surface on `/customer/marketing` (marketing-specialist's page), not `/storefront` — page/artifact mismatch. |
| hr-specialist | consumer_write | SKIP | `create_employee` = fabricating people. |
| dispatcher | consumer_write | SKIP | No field-service/dispatch create tool exists; `consumer_write` reaches only HR `create_employee`. |
| data-steward | crm_write | SKIP | Already autonomous — dedicated Inngest `mdmStewardSweepScheduled` cron. |

Neither included coworker needs a **new grant** (both already granted) — lowest blast radius.

## 4. Toggle ⇆ self-task desync fix (BI guardrail: "must not silently desync")

Live DB confirmed **both** desync directions:
- **A.** 5 coworkers set to Assertive (ops-coordinator, coo, customer-advisor, inventory-specialist, build-specialist) had **no self-task** — `reconcileCoworkerSelfTask` only fires on *save*, and pre-existing facts never re-trigger it.
- **B.** `marketing-specialist` had a **running daily self-task but zero proactivity facts** — the task ran decoupled from the (missing) toggle.

**Fix:** `reconcileAllCoworkerSelfTasks()` — a periodic, additive, non-destructive convergence from the UserFact (operator intent):
- Direction A: active non-quiet fact for a registered coworker with no active task → create it; quiet fact with a live task → deactivate. Already-active tasks are **left untouched** (no schedule/nextRunAt churn).
- Direction B: active self-task with no backing fact → **restore the toggle** from the task's cadence (`inferLevelFromSelfTaskSchedule`: daily→assertive, else balanced) so the UI tells the truth, rather than silently stopping the coworker mid-demo.

**Host:** an hourly-gated step at the top of `agent/task-dispatch` (`now.getUTCMinutes() < 5`), isolated in its own Inngest step — no new cron, no catalog/parity churn.

## 5. Cadences (conservative, de-conflicted, off-peak)

| coworker | balanced | assertive |
|---|---|---|
| marketing-specialist (existing) | `7 14 * * 1` | `7 14 * * *` (daily) |
| inventory-specialist | `31 15 * * 2` (Tue) | `31 15 * * 2,5` (Tue+Fri) |
| doc-specialist | `43 16 * * 3` (Wed) | `43 16 * * 3,6` (Wed+Sat) |

The new coworkers stay **sub-daily even at Assertive** — knowledge/docs don't need a daily refresh (BI: "Balanced-weekly default, daily only where useful"). `deconflictCron` shifts on any tick collision.

## 6. Tests (`coworker-self-tasks.test.ts`, 20 cases)

Registry (routeContext + prompt names the exact tool + stable doc id + sub-daily Assertive); required-tool floor (correct tool, honest placeholder args, recency guard scoped to the right table/id); `inferLevelFromSelfTaskSchedule`; and `reconcileAllCoworkerSelfTasks` Direction-A create/leave-alone/deactivate + Direction-B restore-vs-skip. All green locally (97/97 across scheduled-jobs + proactivity suites).

## 7. Deploy & live-verify

1. DCO PR → babysit CI to green → self-upgrade deploy.
2. Live-verify each included coworker produces a **REAL DB row** on dispatch (not a chat claim): trigger the self-task and confirm a fresh `KnowledgeArticle` / `Document` (`DOC-COWORKER-DOCS-HEALTH`) row, per the marketing-run lesson.
3. Confirm the desync sweep on the hourly tick: inventory-specialist's pre-existing Assertive fact gains a task (Direction A); marketing's orphaned task gets its toggle restored to Assertive (Direction B).
4. If dispatch isn't firing, drain the Inngest executor wedge (BI-0AB96FE7).
