// Proactivity → autonomous coworker self-tasks (BI-3F09BDD4, EP-B9DD37C7).
//
// The per-coworker Proactivity setting (quiet | balanced | assertive) is a promise
// about how hard a coworker works. Until now it only shaped the in-conversation
// prompt (the Initiative block) and notification cadence — an Assertive coworker
// that no one messaged still did nothing, so pages like /customer/marketing stayed
// empty. This wires the setting into the existing ScheduledAgentTask engine so an
// Assertive coworker self-drives a recurring, role-appropriate task without a human
// in the loop; the every-5-min agent-task-dispatch cron runs it.
//
// This is intentionally a small curated registry, NOT "every coworker gets a cron".
// A coworker earns an autonomous self-task only when there is a concrete,
// idempotent, non-destructive unit of work that is genuinely useful to run on a
// cadence. The seed entry is the Marketing Strategist producing/refreshing a
// campaign brief so the Campaigns page fills itself.

import { prisma } from "@dpf/db";
import { CANONICAL_AGENT_ID_TO_COWORKER_SLUG } from "@dpf/db/agent-identity";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import { isProactivityLevel } from "@/lib/proactivity/proactivity-types";
import {
  PROACTIVITY_FACT_CATEGORY,
  PROACTIVITY_OVERRIDE_FACT_PREFIX,
  persistProactivityFact,
} from "@/lib/proactivity/proactivity-override-preferences";
import { SCHEDULING_MAP } from "@/lib/operate/scheduled-jobs/scheduling-map";
import { occupiedTicks, deconflictCron } from "@/lib/operate/scheduled-jobs/scheduling-allocator";
import { computeNextCronRun } from "@/lib/operate/cron-next-run";

/**
 * A coworker self-task definition. `cadence` maps the two work-producing
 * proactivity levels to a cron expression; `quiet` never produces a task.
 * Balanced runs weekly, Assertive runs daily — the operator's setting picks
 * the intensity, the coworker does the same unit of work either way.
 */
export type CoworkerSelfTask = {
  title: string;
  /** The prompt the coworker runs on each tick. Must describe idempotent work. */
  prompt: string;
  /** Drives which coworker + which page-scoped tools the agentic loop attaches. */
  routeContext: string;
  cadence: {
    balanced: string;
    assertive: string;
  };
};

/**
 * Stable documentId the Documentation Specialist self-task upserts. A fixed id
 * makes the refresh idempotent: doc_save updates this one overview (appending a
 * version) instead of creating a fresh Document every run. Declared before the
 * registry so the prompt template can reference it at module load.
 */
export const DOCS_HEALTH_DOCUMENT_ID = "DOC-COWORKER-DOCS-HEALTH";

/**
 * Stable title prefixes for the knowledge-article self-tasks. `KnowledgeArticle`
 * has no slug/stable id, so a per-topic `hasRecentArtifact` dedup scopes on the
 * article title starting with its topic prefix. Each such self-task's fallback
 * title AND its loop prompt use the matching prefix so the dedup recognizes the
 * coworker's own article and never stands down a *different* topic's task — the
 * fix that lets more than one coworker publish knowledge articles without the
 * old global "any recent article" dedup colliding across topics.
 */
export const ESTATE_POSTURE_ARTICLE_TITLE_PREFIX = "Estate posture summary";
export const AI_PLATFORM_POSTURE_ARTICLE_TITLE_PREFIX = "AI platform posture summary";

/**
 * Registry of coworkers that self-drive when their Proactivity is turned up.
 * Keyed by agentId (the interactive coworker slug, e.g. "marketing-specialist").
 */
export const COWORKER_SELF_TASKS: Record<string, CoworkerSelfTask> = {
  "marketing-specialist": {
    title: "Refresh the acquisition campaign brief",
    prompt: [
      "You are running as a scheduled, autonomous task — no human is watching this",
      "turn, so finish the work rather than asking questions.",
      "",
      "Goal: keep a current acquisition campaign brief on the Campaigns page so the",
      "marketing surface is never empty. Steps:",
      "1. Review the saved acquisition assumptions / ICP / positioning available to you",
      "   (org context, prior campaigns, product catalog).",
      "2. If there is NO active or recent campaign brief, create one with",
      "   create_marketing_campaign_brief: a focused brief for the most promising",
      "   segment, with objective, audience, channels, core message, and 3–5 concrete",
      "   next actions.",
      "3. If a recent brief already exists, do NOT duplicate it — instead refresh it",
      "   only if assumptions have changed, otherwise stop.",
      "Keep it grounded in real saved context; do not invent customers or numbers.",
    ].join("\n"),
    routeContext: "/customer/marketing",
    cadence: {
      // Weekly Monday and daily, both at 14:07 UTC — an off-peak minute the
      // allocator is unlikely to collide, and deconflictCron shifts it if it does.
      balanced: "7 14 * * 1",
      assertive: "7 14 * * *",
    },
  },

  // Finance Controller reviews money health on a cadence (BI-090221E7). The
  // /finance dashboard now says "unknown" out loud when the books are empty and
  // flags pre-revenue burn — this self-task is the proactive half: the coworker
  // looks at the same state and TELLS the owner what needs recording or
  // attention instead of waiting to be asked. Keyed on the ROSTER coworker
  // (LIFE-009); the finance-agent chat persona has no Agent row (BI-79298169).
  // Read-and-report work: it records nothing on its own, so a weak model run
  // degrades to a bland summary, never to invented business facts.
  "finance-controller": {
    title: "Review burn, revenue, and runway",
    prompt: [
      "You are running as a scheduled, autonomous task — no human is watching this",
      "turn, so finish the work rather than asking questions.",
      "",
      "Goal: keep the owner ahead of their money position. Steps:",
      "1. Review the real recorded finance state available to you (paid invoices,",
      "   bills, expenses, bank balances, supplier commitments) using your read tools.",
      "2. Report, in plain language addressed to the owner:",
      "   - monthly burn and monthly revenue IF they are measurable from recorded",
      "     data, saying what window they cover;",
      "   - what is UNKNOWN and exactly what to record to make it known (e.g. 'no",
      "     supplier bills are recorded, so burn is unknown — record your recurring",
      "     supplier costs');",
      "   - a clear flag when money is going out with no revenue recorded",
      "     (pre-revenue with burn), including how many months of cash remain if",
      "     that is computable.",
      "3. Never present an absent number as zero, and never invent amounts — an",
      "   honest 'unknown, here is what to record' is the deliverable when the",
      "   books are empty.",
    ].join("\n"),
    routeContext: "/finance",
    cadence: {
      // Weekly (Wed) and twice-weekly (Mon+Thu) at 13:23 UTC — off-peak minute,
      // deconflictCron shifts it on collision. Money review does not need daily
      // cadence even for Assertive (BI-E962B9CD: prefer sub-daily by default).
      balanced: "23 13 * * 3",
      assertive: "23 13 * * 1,4",
    },
  },

  // Digital Product Estate Specialist keeps a current estate-posture knowledge
  // article on /inventory. This is a DISTINCT artifact from its existing
  // discovery-taxonomy-gap-triage-daily autonomy (that files backlog gaps; this
  // publishes a human-readable posture summary). A knowledge article is an
  // internal reference doc — benign if the model produces a generic one — which
  // is why this coworker qualifies where CRM/HR/EA coworkers (whose write tools
  // create business-fact rows) do not. registry_write is already granted.
  "inventory-specialist": {
    title: "Refresh the estate-posture knowledge article",
    prompt: [
      "You are running as a scheduled, autonomous task — no human is watching this",
      "turn, so finish the work rather than asking questions.",
      "",
      "Goal: keep a current estate-posture knowledge article on the Discovery /",
      "Inventory surface so the estate's health is legible without a human asking.",
      "Steps:",
      "1. Review the real discovered estate available to you (posture, freshness,",
      "   attribution confidence, support/version risks) using your read tools.",
      "2. Search existing knowledge articles first (search_knowledge_base). If there",
      "   is NO recent estate-posture article, create ONE with create_knowledge_article:",
      `   a concise reference article (category 'reference') whose title STARTS WITH`,
      `   "${ESTATE_POSTURE_ARTICLE_TITLE_PREFIX}" (this stable prefix is how the`,
      "   platform recognizes your own article), summarizing the top risks and what",
      "   needs review, grounded ONLY in real discovered evidence.",
      "3. If a recent posture article already exists, do NOT duplicate it — refresh",
      "   the assessment only if the estate has materially changed, otherwise stop.",
      "Do not invent products, vendors, or numbers; cite only real discovered data.",
    ].join("\n"),
    routeContext: "/inventory",
    cadence: {
      // Weekly (Tue) and twice-weekly (Tue+Fri) at 15:31 UTC. Knowledge does not
      // need a daily refresh, so even Assertive stays sub-daily — conservative by
      // design (BI-E962B9CD: prefer Balanced-weekly, daily only where useful).
      balanced: "31 15 * * 2",
      assertive: "31 15 * * 2,5",
    },
  },

  // Documentation Specialist keeps a single living "documentation health" overview
  // document fresh on the Workspace documents surface. doc_save UPSERTS by a stable
  // documentId, so refreshing this overview never accumulates duplicates — it just
  // appends a new version. document_write is already granted.
  "doc-specialist": {
    title: "Refresh the documentation-health overview",
    prompt: [
      "You are running as a scheduled, autonomous task — no human is watching this",
      "turn, so finish the work rather than asking questions.",
      "",
      "Goal: keep ONE living documentation-health overview document current so the",
      "Workspace documents surface reflects real doc coverage and gaps. Steps:",
      "1. Review the real documentation available to you (doc_search, and the project",
      "   docs you can read) to assess coverage, staleness, and structural gaps.",
      `2. Refresh the SAME overview document by calling doc_save with documentId`,
      `   "${DOCS_HEALTH_DOCUMENT_ID}" (a stable id — this UPDATES the one overview,`,
      "   it does NOT create a new document each run): documentKind 'overview',",
      "   contentFormat 'markdown', a contentText summary of what is well-documented,",
      "   what is stale, and the top 3 documentation gaps to close next.",
      "Ground every claim in real docs; do not invent documents or coverage numbers.",
    ].join("\n"),
    routeContext: "/workspace/documents",
    cadence: {
      // Weekly (Wed) and twice-weekly (Wed+Sat) at 16:43 UTC. Documentation health
      // changes slowly, so Assertive stays sub-daily.
      balanced: "43 16 * * 3",
      assertive: "43 16 * * 3,6",
    },
  },

  // AI Ops Engineer keeps a current "AI platform posture" knowledge article on the
  // Platform surface so the AI layer's health (providers, model routing, cost,
  // failover, unassigned agents) is legible without a human asking. It holds
  // registry_write (create_knowledge_article) + agent_control_read for the real
  // AI-layer data, and its article is deduped on a stable title prefix so it never
  // collides with the Digital Product Estate Specialist's estate-posture article.
  //
  // BI-1C88254D: the same coworker also OWNS host resource health (disk free-space
  // floors, Docker/container sprawl, critical host alerts). Charter alone was not
  // enough — a scheduled sweep must notice firing host alerts and file work, so a
  // disk alert cannot sit ownerless for days.
  "platform-engineer": {
    title: "Refresh AI platform posture and host resource health",
    prompt: [
      "You are running as a scheduled, autonomous task — no human is watching this",
      "turn, so finish the work rather than asking questions.",
      "",
      "Goal: keep a current AI platform posture knowledge article on the Platform",
      "surface so the AI layer's health is legible without a human asking, AND act as",
      "owner of host resource health (BI-1C88254D). Steps:",
      "1. Review the REAL AI-layer state available to you (provider status, model",
      "   profiles and tiers, token spend, failover chains, agent-to-provider",
      "   assignments, scheduled jobs) using your read tools.",
      "2. Review host resource health with the tools you have (platform notifications",
      "   and alerts, telemetry, scheduled jobs such as infra-prune, any disk /",
      "   container / filesystem free-space signals). Note open critical/warning",
      "   host alerts and whether infra pruning or other jobs already cover them.",
      "3. Search existing knowledge articles first (search_knowledge_base). If there",
      "   is NO recent AI-platform-posture article, create ONE with",
      `   create_knowledge_article: a concise reference article (category`,
      `   'reference') whose title STARTS WITH "${AI_PLATFORM_POSTURE_ARTICLE_TITLE_PREFIX}"`,
      "   (this stable prefix is how the platform recognizes your own article),",
      "   summarizing provider health, cost posture, underpowered or unassigned",
      "   agents, host disk/container posture, open host alerts, and what needs",
      "   review — grounded ONLY in real data.",
      "4. If a recent posture article already exists, do NOT duplicate it — refresh",
      "   the assessment only if the AI layer or host resource picture has materially",
      "   changed, otherwise stop after step 5.",
      "5. For each open critical host-resource alert with no recent backlog item,",
      "   file or update a backlog item (create_backlog_item / update path) so disk",
      "   free-space floors, container sprawl, and critical host alerts have an owner",
      "   and a tracked next action. Do not invent hosts, paths, or free-space numbers.",
      "Do not invent providers, models, costs, agents, disks, or alerts; cite only real data.",
    ].join("\n"),
    routeContext: "/platform",
    cadence: {
      // Weekly (Thu) and twice-weekly (Thu+Sun) at 17:19 UTC. Platform posture
      // changes slowly, so even Assertive stays sub-daily (matches the estate /
      // docs knowledge tasks); off-peak minute the allocator can shift on collision.
      balanced: "19 17 * * 4",
      assertive: "19 17 * * 4,0",
    },
  },

  // Compliance Officer — the `decide` stage of the obligation-assurance-watch
  // work shape (apps/web/lib/work-management/work-shapes.ts, TAK §8.11).
  //
  // The DETERMINISTIC half of that shape is the daily obligation-assurance-watch
  // cron: it sweeps the six recorded cadence columns and raises findings. This
  // self-task is the coworker half — it reads what the sweep raised and puts a
  // decision in front of the accountable owner. Until this entry existed the
  // compliance officer had a Proactivity control that changed nothing at all:
  // an autonomy dial with no shape and no cadence behind it (§8.11.2).
  //
  // Read-and-report by construction. It records no compliance conclusion and
  // takes no consequential action on its own; a weak model run degrades to a
  // bland summary, never to invented obligations or dates.
  "compliance-officer": {
    title: "Review obligations and control reviews falling due",
    prompt: [
      "You are running as a scheduled, autonomous task — no human is watching this",
      "turn, so finish the work rather than asking questions.",
      "",
      "Goal: make sure nothing recorded as due is quietly going past its date.",
      "",
      "The obligation assurance watch runs daily and has already swept the recorded",
      "obligations, control reviews, and licence requirements, raising a finding for",
      "each one inside the 30-day horizon. Your job is the NEXT step, not the sweep.",
      "",
      "Steps:",
      "1. Read the current compliance posture available to you — obligations, their",
      "   owners and review dates, controls and their review cadence, and open",
      "   findings.",
      "2. Report to the owner, in plain language:",
      "   - what is OVERDUE, oldest first, and who is recorded as accountable;",
      "   - what falls due in the next 30 days;",
      "   - anything that declares a recurrence with NO next date — that is a",
      "     control that reads as in force and is not, and it is the most important",
      "     thing on the list because nobody will ever be told about it again.",
      "3. For each item, say what the owner must do and by when. Do NOT decide the",
      "   response yourself: accepting, deferring, or remediating an obligation is",
      "   the accountable owner's decision, and the work shape requires a governed",
      "   decision for it.",
      "4. If NOTHING is recorded — no obligations and no controls — say exactly that",
      "   and say what to record first. Do not report a clean compliance position",
      "   from an empty database; an unread estate and a clear one look identical",
      "   and are not the same.",
      "",
      "Ground every date and every owner in recorded data. Never estimate a due",
      "date, and never name a regulation you cannot point at a record for.",
    ].join("\n"),
    routeContext: "/compliance",
    cadence: {
      // Weekly Monday and daily at 06:11 UTC — after the 05:40 sweep, so the
      // findings the coworker reads are from that morning's run rather than
      // yesterday's. Off-peak minute the allocator can shift on collision.
      balanced: "11 6 * * 1",
      assertive: "11 6 * * *",
    },
  },
};

/** Friendly cadence label from a registry cron — "daily", "weekly", or
 *  "twice weekly" by the day-of-week field. Feeds the honest what-this-dial-
 *  changes lines (BI-AB7CD55B); a wrong guess degrades to a label, not behavior. */
function friendlyCadence(cron: string): string {
  const dayOfWeek = cron.trim().split(/\s+/)[4] ?? "*";
  if (dayOfWeek === "*") return "daily";
  return dayOfWeek.includes(",") ? "twice weekly" : "weekly";
}

/** Whether this coworker self-drives, and at what per-level cadence — the
 *  truthful self-task line for the proactivity control's effects list. */
export function coworkerSelfTaskCadenceInfo(agentId: string): {
  registered: boolean;
  cadence: { balanced: string; assertive: string } | null;
} {
  const entry = COWORKER_SELF_TASKS[agentId];
  if (!entry) return { registered: false, cadence: null };
  return {
    registered: true,
    cadence: {
      balanced: friendlyCadence(entry.cadence.balanced),
      assertive: friendlyCadence(entry.cadence.assertive),
    },
  };
}

/** Deterministic per-(agent, owner) taskId so reconcile is idempotent. */
export function coworkerSelfTaskId(agentId: string, userId: string): string {
  return `self-${agentId}-${userId}`;
}

/**
 * Resolve any coworker id — slug OR canonical AGT-* — to the key this registry
 * is actually declared under (BI-B05E5D30).
 *
 * WHY THIS EXISTS. The registry is keyed by slug ("marketing-specialist"), but
 * the proactivity roster renders through collapseDualSeedDuplicates, which for a
 * dual-seeded coworker DROPS the slug row and keeps the canonical AGT-* row. So
 * the only control the operator can reach writes the fact under
 * "AGT-WS-MARKETING", the sweep looked up that key, found nothing, and skipped —
 * the self-task was never created at ANY level. Four of the six registered
 * coworkers were unreachable this way (marketing-specialist,
 * inventory-specialist, platform-engineer, compliance-officer); the two that
 * worked are simply the two that are not dual-seeded.
 *
 * Returning the REGISTRY KEY (not the incoming id) is what keeps the derived
 * taskId stable: a fact written under either form resolves to one task, so an
 * operator toggling from either surface never ends up with two.
 */
export function selfTaskRegistryKey(agentId: string): string | null {
  if (COWORKER_SELF_TASKS[agentId]) return agentId;
  const slug = CANONICAL_AGENT_ID_TO_COWORKER_SLUG[agentId];
  if (slug && COWORKER_SELF_TASKS[slug]) return slug;
  return null;
}

/** True when a taskId is a coworker self-task (see {@link coworkerSelfTaskId}). */
export function isCoworkerSelfTaskId(taskId: string): boolean {
  return taskId.startsWith("self-");
}

/**
 * A procedural tool the scheduled runner force-executes as a LAST-RESORT
 * guarantee when the coworker's own agentic loop finished the self-task without
 * calling it (e.g. a weak model fabricated "Done" with zero tool calls). This is
 * the same "required procedural tool" mechanism the discovery-triage daily task
 * uses — extended to coworker self-tasks so an Assertive coworker never leaves
 * its page empty.
 */
export type CoworkerSelfTaskProceduralTool = {
  /** Tool name to force, resolved via governed execute. */
  name: string;
  /**
   * Args for the forced fallback call. These are honest, generic placeholders —
   * the fallback only ever fires when the page is otherwise empty, and the
   * coworker (on a capable model) produces the real, contextual artifact itself.
   */
  args: Record<string, unknown>;
  /**
   * Recency guard for the forced fallback. The self-task's artifact tool (e.g.
   * create_marketing_campaign_brief → a plain prisma.create with NO write-time
   * dedup) would otherwise create a duplicate placeholder on every tick. Returns
   * true when a fresh artifact already exists — the coworker just created one
   * this run, or a recent run did — so the fallback MUST be skipped.
   */
  hasRecentArtifact: () => Promise<boolean>;
};

// Recency windows for the sub-daily self-tasks. Each is wider than that
// coworker's Assertive cadence gap (twice-weekly) so a single placeholder is
// never re-created between two consecutive runs.
const RECENT_KNOWLEDGE_ARTICLE_WINDOW_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
const RECENT_DOCS_OVERVIEW_WINDOW_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

/**
 * Per-topic dedup: has a knowledge article whose title starts with this topic
 * prefix been created within the recency window? Scoping on the title prefix
 * (not "any recent article") is what lets multiple knowledge-article self-tasks
 * coexist — each stands down only its OWN topic's fallback.
 */
async function hasRecentKnowledgeArticle(titlePrefix: string): Promise<boolean> {
  const since = new Date(Date.now() - RECENT_KNOWLEDGE_ARTICLE_WINDOW_MS);
  const recent = await prisma.knowledgeArticle.findFirst({
    where: { createdAt: { gte: since }, title: { startsWith: titlePrefix } },
    select: { articleId: true },
  });
  return recent !== null;
}

/**
 * Required-tool guarantee for a coworker self-task, keyed by agentId. Null when
 * the coworker's self-task has no procedural guarantee (the loop's own output is
 * sufficient). Mirrors getRequiredProceduralToolForScheduledTask for the curated
 * self-task registry above.
 *
 * The Marketing Strategist deliberately has NO guarantee (BI-71D945CD). It used
 * to be forced to create a placeholder campaign brief, on the reasoning that a
 * provisional brief beat an empty Campaigns page. The canonical marketing
 * operating snapshot removed that premise: an empty marketing workspace now
 * renders an honest, actionable next step ("establish one bounded campaign")
 * plus a blocker carrying one recovery action, so a fabricated brief is strictly
 * worse than the truth. Observed creating real placeholder rows on a live
 * install while model dispatch was failing, which is exactly when the loop
 * produces nothing and the fallback fires every tick.
 *
 * Before adding a guarantee for another coworker, check whether that surface has
 * an honest empty state first — a placeholder is only ever better than a wall of
 * zeros, never better than the truth.
 */
export function coworkerSelfTaskRequiredTool(
  agentId: string,
): CoworkerSelfTaskProceduralTool | null {
  if (agentId === "inventory-specialist") {
    return {
      name: "create_knowledge_article",
      // Honest, provisional placeholder — only reached when the estate surface has
      // no recent posture article AND the coworker's loop failed to produce one.
      // required: title, body. category defaults to 'reference'.
      args: {
        title: `${ESTATE_POSTURE_ARTICLE_TITLE_PREFIX} (needs refresh)`,
        body:
          "Provisional estate-posture article created automatically because the Discovery/Inventory surface had no recent posture summary. The Digital Product Estate Specialist should replace this with a grounded assessment of real discovered posture, freshness, and top risks on its next run.",
        category: "reference",
      },
      hasRecentArtifact: () => hasRecentKnowledgeArticle(ESTATE_POSTURE_ARTICLE_TITLE_PREFIX),
    };
  }

  if (agentId === "platform-engineer") {
    return {
      name: "create_knowledge_article",
      // Honest, provisional placeholder — only reached when the Platform surface
      // has no recent AI-posture article AND the coworker's loop failed to produce
      // one. required: title, body. category defaults to 'reference'.
      args: {
        title: `${AI_PLATFORM_POSTURE_ARTICLE_TITLE_PREFIX} (needs refresh)`,
        body:
          "Provisional AI-platform-posture article created automatically because the Platform surface had no recent posture summary. The AI Ops Engineer should replace this with a grounded assessment of provider health, cost posture, model routing, underpowered or unassigned agents, and host resource health (disk free-space, container sprawl, critical host alerts — BI-1C88254D) on its next run.",
        category: "reference",
      },
      hasRecentArtifact: () => hasRecentKnowledgeArticle(AI_PLATFORM_POSTURE_ARTICLE_TITLE_PREFIX),
    };
  }

  if (agentId === "doc-specialist") {
    return {
      name: "doc_save",
      // Upsert by the stable overview id — the fallback refreshes the SAME document
      // (appending a version) rather than creating a duplicate. required by the
      // store: title, documentKind, contentFormat, contentText.
      args: {
        documentId: DOCS_HEALTH_DOCUMENT_ID,
        title: "Documentation health overview (needs refresh)",
        documentKind: "overview",
        contentFormat: "markdown",
        contentText:
          "# Documentation health overview\n\nProvisional overview created automatically because no recent documentation-health summary existed. The Documentation Specialist should replace this with a grounded assessment of coverage, staleness, and the top documentation gaps to close next.",
        summary: "Auto-generated placeholder documentation-health overview.",
      },
      hasRecentArtifact: async () => {
        // doc_save upserts by DOCS_HEALTH_DOCUMENT_ID, so duplication is already
        // impossible; this simply stands the fallback down when the coworker (or a
        // recent run) already refreshed the overview this window.
        const since = new Date(Date.now() - RECENT_DOCS_OVERVIEW_WINDOW_MS);
        const recent = await prisma.document.findFirst({
          where: { documentId: DOCS_HEALTH_DOCUMENT_ID, updatedAt: { gte: since } },
          select: { id: true },
        });
        return recent !== null;
      },
    };
  }

  return null;
}

export type ReconcileSelfTaskResult =
  | { ok: true; action: "none" | "removed" | "scheduled"; taskId?: string; schedule?: string };

/**
 * Bring the coworker's autonomous self-task in line with `level`:
 *   - no registry entry for this coworker → nothing to do;
 *   - quiet → deactivate any existing self-task (coworker goes silent);
 *   - balanced → weekly cadence; assertive → daily cadence (upsert, de-conflicted).
 *
 * Idempotent: keyed on a deterministic taskId, so flipping the setting back and
 * forth never piles up duplicate schedules. userId-parameterized and not a
 * "use server" export, so the caller must have already authorized `userId`.
 */
export async function reconcileCoworkerSelfTask(
  userId: string,
  agentId: string,
  level: ProactivityLevel,
): Promise<ReconcileSelfTaskResult> {
  const registryKey = selfTaskRegistryKey(agentId);
  if (!registryKey) return { ok: true, action: "none" };
  const entry = COWORKER_SELF_TASKS[registryKey];

  const taskId = coworkerSelfTaskId(registryKey, userId);

  // Quiet (or any non-producing level) → stand the coworker down.
  if (level === "quiet") {
    await prisma.scheduledAgentTask.updateMany({
      where: { taskId },
      data: { isActive: false },
    });
    await prisma.scheduledJob
      .update({ where: { jobId: taskId }, data: { schedule: "disabled" } })
      .catch(() => {});
    return { ok: true, action: "removed", taskId };
  }

  const baseCron = level === "assertive" ? entry.cadence.assertive : entry.cadence.balanced;
  const now = new Date();

  // De-conflict against the canonical scheduling map and other live tasks
  // (excluding this task's own row so a re-save doesn't collide with itself).
  const liveTasks = await prisma.scheduledAgentTask.findMany({
    where: { isActive: true, taskId: { not: taskId } },
    select: { schedule: true },
  });
  const occupied = occupiedTicks([
    ...SCHEDULING_MAP.map((e) => e.cron),
    ...liveTasks.map((t) => t.schedule),
  ]);
  const { cron: schedule } = deconflictCron(baseCron, occupied);
  const nextRunAt = computeNextCronRun(schedule, now);

  await prisma.scheduledAgentTask.upsert({
    where: { taskId },
    create: {
      taskId,
      agentId,
      title: entry.title,
      prompt: entry.prompt,
      routeContext: entry.routeContext,
      schedule,
      timezone: "UTC",
      ownerUserId: userId,
      nextRunAt,
      isActive: true,
    },
    update: {
      title: entry.title,
      prompt: entry.prompt,
      routeContext: entry.routeContext,
      schedule,
      nextRunAt,
      isActive: true,
    },
  });

  await prisma.scheduledJob.upsert({
    where: { jobId: taskId },
    create: { jobId: taskId, name: `Agent: ${entry.title}`, schedule, nextRunAt },
    update: { name: `Agent: ${entry.title}`, schedule, nextRunAt },
  });

  return { ok: true, action: "scheduled", taskId, schedule };
}

// ─── Toggle ⇆ self-task convergence (desync self-heal, BI-E962B9CD) ──────────
//
// reconcileCoworkerSelfTask only fires on SAVE (saveCoworkerProactivityPreference).
// That leaves two ways the Proactivity toggle and the scheduled self-task drift
// apart, both observed live:
//   A. A coworker was set to Balanced/Assertive BEFORE it had a registry entry
//      (or before the fact was ever bridged) — the fact exists but no task does,
//      and the coworker sits idle despite the UI showing it working.
//   B. A self-task keeps running after its backing Proactivity fact disappeared
//      (the Marketing Strategist's fact went missing while its daily task still
//      ran) — the toggle silently lies about what the coworker is doing.
// The periodic sweep below converges both directions from the UserFact, which is
// the operator's expressed intent. It is additive and non-destructive: it creates
// missing tasks, deactivates tasks a now-quiet toggle should stop, and — for an
// orphaned task with no fact — RESTORES the toggle from the task's cadence rather
// than silently stopping the coworker.

const PROACTIVITY_AGENT_KEY_PREFIX = `${PROACTIVITY_OVERRIDE_FACT_PREFIX}:agent:`;

/** Parse the persisted proactivity fact value → its level, or null if unreadable. */
function readSelfTaskFactLevel(value: string | null | undefined): ProactivityLevel | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { level?: unknown };
    return isProactivityLevel(parsed.level) ? parsed.level : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort level a self-task's cadence implies, for healing an orphaned task
 * (Direction B). A daily cron (day-of-week wildcard) is Assertive; anything
 * narrower is Balanced. Sub-daily Assertive cadences (e.g. twice-weekly) infer
 * Balanced — acceptable for a rare heal case; the operator can re-toggle.
 */
export function inferLevelFromSelfTaskSchedule(schedule: string): ProactivityLevel {
  const fields = schedule.trim().split(/\s+/);
  return fields[4] === "*" ? "assertive" : "balanced";
}

/** Write (or refresh) the manual Proactivity fact for a coworker to `level`. */
async function backfillProactivityFact(
  userId: string,
  agentId: string,
  level: ProactivityLevel,
): Promise<void> {
  const now = new Date();
  const value = JSON.stringify({
    scope: "agent",
    scopeKey: `agent:${agentId}`,
    level,
    source: "reconcile-backfill",
    acknowledgedByUserId: userId,
    acknowledgedAt: now.toISOString(),
  });
  await persistProactivityFact(userId, {
    category: PROACTIVITY_FACT_CATEGORY,
    key: `${PROACTIVITY_AGENT_KEY_PREFIX}${agentId}`,
    value,
    sourceRoute: "/platform/ai",
    sourceAgentId: agentId,
    lastValidatedAt: now,
  });
}

export type ReconcileAllSelfTasksResult = {
  /** Missing self-tasks created for an active non-quiet fact (Direction A). */
  created: number;
  /** Live self-tasks stood down because the toggle is now quiet (Direction A). */
  deactivated: number;
  /** Orphaned live self-tasks whose toggle was restored from cadence (Direction B). */
  backfilledFacts: number;
};

/**
 * Converge every coworker self-task with its owner's current Proactivity toggle.
 * Safe to run on a cadence: it only creates missing tasks, deactivates tasks a
 * quiet toggle should stop, and restores a missing toggle from an orphaned task —
 * it never perturbs the schedule of a task that is already correctly active.
 */
export async function reconcileAllCoworkerSelfTasks(): Promise<ReconcileAllSelfTasksResult> {
  const result: ReconcileAllSelfTasksResult = { created: 0, deactivated: 0, backfilledFacts: 0 };

  // Direction A — every active Proactivity fact for a REGISTERED coworker should
  // have a matching self-task (create when missing; stand down when quiet).
  const facts = await prisma.userFact.findMany({
    where: {
      category: PROACTIVITY_FACT_CATEGORY,
      key: { startsWith: PROACTIVITY_AGENT_KEY_PREFIX },
      supersededAt: null,
    },
    select: { userId: true, key: true, value: true },
  });

  // (taskId) that legitimately SHOULD be active — used to spot orphans below.
  const desiredActive = new Set<string>();

  for (const fact of facts) {
    // The fact may be written under either id form — the roster reaches the
    // operator with the canonical one for a dual-seeded coworker (BI-B05E5D30).
    const agentId = selfTaskRegistryKey(fact.key.slice(PROACTIVITY_AGENT_KEY_PREFIX.length));
    if (!agentId) continue;
    const level = readSelfTaskFactLevel(fact.value);
    if (!level) continue;

    const taskId = coworkerSelfTaskId(agentId, fact.userId);
    const existing = await prisma.scheduledAgentTask.findUnique({
      where: { taskId },
      select: { isActive: true },
    });

    if (level === "quiet") {
      if (existing?.isActive) {
        await reconcileCoworkerSelfTask(fact.userId, agentId, "quiet");
        result.deactivated++;
      }
      continue;
    }

    desiredActive.add(taskId);
    if (!existing?.isActive) {
      // Missing or deactivated → (re)schedule it. Leave already-active tasks
      // untouched so the sweep never churns their schedule / nextRunAt.
      await reconcileCoworkerSelfTask(fact.userId, agentId, level);
      result.created++;
    }
  }

  // Direction B — an active self-task with no backing active fact is an orphan
  // (the toggle desynced from the task). Restore the toggle from the task's
  // cadence so the UI tells the truth, rather than stopping the coworker.
  const liveSelfTasks = await prisma.scheduledAgentTask.findMany({
    where: { isActive: true, taskId: { startsWith: "self-" } },
    select: { taskId: true, agentId: true, ownerUserId: true, schedule: true },
  });
  for (const task of liveSelfTasks) {
    if (desiredActive.has(task.taskId)) continue;
    const level = inferLevelFromSelfTaskSchedule(task.schedule);
    await backfillProactivityFact(task.ownerUserId, task.agentId, level);
    result.backfilledFacts++;
    console.info(
      "[coworker-self-tasks] restored missing Proactivity toggle from orphaned self-task",
      { taskId: task.taskId, agentId: task.agentId, level },
    );
  }

  return result;
}
