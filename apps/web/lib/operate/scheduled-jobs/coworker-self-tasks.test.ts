import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    scheduledAgentTask: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    scheduledJob: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    userFact: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    marketingCampaignBrief: { findFirst: vi.fn().mockResolvedValue(null) },
    knowledgeArticle: { findFirst: vi.fn().mockResolvedValue(null) },
    document: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

// Imported after the mock so the module picks up mocked prisma. The cron /
// allocator helpers it imports are pure (no DB), so they run for real.
import {
  reconcileCoworkerSelfTask,
  reconcileAllCoworkerSelfTasks,
  coworkerSelfTaskId,
  coworkerSelfTaskRequiredTool,
  inferLevelFromSelfTaskSchedule,
  COWORKER_SELF_TASKS,
  DOCS_HEALTH_DOCUMENT_ID,
} from "./coworker-self-tasks";

const MKT = "marketing-specialist";
const INV = "inventory-specialist";
const DOC = "doc-specialist";
const PLT = "platform-engineer";
const PROACTIVITY_KEY = (agentId: string) => `aiCoworkerProactivity:agent:${agentId}`;
const factRow = (userId: string, agentId: string, level: string) => ({
  userId,
  key: PROACTIVITY_KEY(agentId),
  value: JSON.stringify({ level }),
});

describe("coworkerSelfTaskId", () => {
  it("is deterministic per (agent, user) so reconcile stays idempotent", () => {
    expect(coworkerSelfTaskId(MKT, "u1")).toBe("self-marketing-specialist-u1");
    expect(coworkerSelfTaskId(MKT, "u1")).toBe(coworkerSelfTaskId(MKT, "u1"));
    expect(coworkerSelfTaskId(MKT, "u1")).not.toBe(coworkerSelfTaskId(MKT, "u2"));
  });
});

describe("reconcileCoworkerSelfTask", () => {
  it("does nothing for a coworker with no registered self-task", async () => {
    const { prisma } = await import("@dpf/db");
    const upsert = prisma.scheduledAgentTask.upsert as ReturnType<typeof vi.fn>;
    upsert.mockClear();

    const r = await reconcileCoworkerSelfTask("u1", "some-other-coworker", "assertive");

    expect(r).toEqual({ ok: true, action: "none" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("assertive schedules a daily task owned by the caller", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.scheduledAgentTask.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const upsert = prisma.scheduledAgentTask.upsert as ReturnType<typeof vi.fn>;
    upsert.mockClear();

    const r = await reconcileCoworkerSelfTask("u1", MKT, "assertive");

    expect(r.action).toBe("scheduled");
    expect(r.taskId).toBe("self-marketing-specialist-u1");
    const call = upsert.mock.calls[0]![0];
    expect(call.where).toEqual({ taskId: "self-marketing-specialist-u1" });
    expect(call.create.ownerUserId).toBe("u1");
    expect(call.create.agentId).toBe(MKT);
    expect(call.create.routeContext).toBe("/customer/marketing");
    expect(call.create.isActive).toBe(true);
    // Daily cadence: cron day-of-week field is a wildcard.
    expect(call.create.schedule.split(" ")[4]).toBe("*");
  });

  it("balanced schedules a weekly task (day-of-week pinned)", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.scheduledAgentTask.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const upsert = prisma.scheduledAgentTask.upsert as ReturnType<typeof vi.fn>;
    upsert.mockClear();

    const r = await reconcileCoworkerSelfTask("u1", MKT, "balanced");

    expect(r.action).toBe("scheduled");
    const call = upsert.mock.calls[0]![0];
    // Weekly cadence: day-of-week field is a specific day, not a wildcard.
    expect(call.create.schedule.split(" ")[4]).not.toBe("*");
  });

  it("quiet stands the coworker down without creating a task", async () => {
    const { prisma } = await import("@dpf/db");
    const upsert = prisma.scheduledAgentTask.upsert as ReturnType<typeof vi.fn>;
    const updateMany = prisma.scheduledAgentTask.updateMany as ReturnType<typeof vi.fn>;
    upsert.mockClear();
    updateMany.mockClear();

    const r = await reconcileCoworkerSelfTask("u1", MKT, "quiet");

    expect(r.action).toBe("removed");
    expect(upsert).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { taskId: "self-marketing-specialist-u1" },
      data: { isActive: false },
    });
  });

  it("registers the Marketing Strategist seed self-task", () => {
    expect(COWORKER_SELF_TASKS[MKT]).toBeDefined();
    expect(COWORKER_SELF_TASKS[MKT]!.routeContext).toBe("/customer/marketing");
    expect(COWORKER_SELF_TASKS[MKT]!.prompt).toMatch(/create_marketing_campaign_brief/);
  });
});

describe("rollout registry (BI-E962B9CD)", () => {
  it("registers the Estate Specialist knowledge-article self-task on /inventory", () => {
    const entry = COWORKER_SELF_TASKS[INV];
    expect(entry).toBeDefined();
    expect(entry!.routeContext).toBe("/inventory");
    expect(entry!.prompt).toMatch(/create_knowledge_article/);
  });

  it("registers the Documentation Specialist doc-overview self-task on /workspace/documents", () => {
    const entry = COWORKER_SELF_TASKS[DOC];
    expect(entry).toBeDefined();
    expect(entry!.routeContext).toBe("/workspace/documents");
    expect(entry!.prompt).toMatch(/doc_save/);
    // The stable upsert id must appear in the prompt so the coworker refreshes the
    // one overview instead of creating a new document each run.
    expect(entry!.prompt).toContain(DOCS_HEALTH_DOCUMENT_ID);
  });

  it("registers the AI Ops Engineer platform-posture self-task on /platform", () => {
    const entry = COWORKER_SELF_TASKS[PLT];
    expect(entry).toBeDefined();
    expect(entry!.routeContext).toBe("/platform");
    expect(entry!.title).toMatch(/host resource/i);
    expect(entry!.prompt).toMatch(/create_knowledge_article/);
    // Grounded on real AI-layer data, not invented.
    expect(entry!.prompt).toMatch(/provider|model|cost|agent/i);
    expect(entry!.prompt).toMatch(/do not invent/i);
    // BI-1C88254D: scheduled sweep must own host resource health, not only AI spend.
    expect(entry!.prompt).toMatch(/host resource|disk|container sprawl|host alerts/i);
    expect(entry!.prompt).toMatch(/BI-1C88254D|create_backlog_item/i);
  });

  it("keeps the new coworkers sub-daily even at Assertive (conservative cadence)", () => {
    for (const agentId of [INV, DOC, PLT]) {
      const dowField = COWORKER_SELF_TASKS[agentId]!.cadence.assertive.split(" ")[4];
      // A daily task has a wildcard day-of-week; these must NOT (sub-daily).
      expect(dowField).not.toBe("*");
    }
  });
});

describe("coworkerSelfTaskRequiredTool (anti-fabrication floor)", () => {

  it("resolves the CANONICAL agent id the scheduler actually passes (BI-B05E5D30 third site)", async () => {
    // ScheduledAgentTask.agentId holds AGT-WS-MARKETING, because the proactivity
    // roster collapses the slug row and can only write the canonical form. Before
    // this resolution the lookup returned null, the required-tool guarantee never
    // fired, and a stuck run produced no artifact while reporting ok.
    // Inventory IS dual-seeded and DOES have a guarantee: before this resolution
    // the canonical form returned null and its fallback silently never fired.
    expect(coworkerSelfTaskRequiredTool("AGT-WS-INVENTORY")?.name).toBe("create_knowledge_article");
    // Marketing stays null in BOTH id forms — the placeholder brief was removed
    // deliberately (an honest empty state beats a fabricated brief); resolving
    // the alias must not resurrect it.
    expect(coworkerSelfTaskRequiredTool("AGT-WS-MARKETING")).toBeNull();
    expect(coworkerSelfTaskRequiredTool("marketing-specialist")).toBeNull();
  });

  it("still returns null for a coworker with no procedural guarantee", () => {
    // The resolution must not invent a fallback for a coworker that has none.
    expect(coworkerSelfTaskRequiredTool("coo")).toBeNull();
    expect(coworkerSelfTaskRequiredTool("AGT-WS-EA")).toBeNull();
  });


  it("forces a knowledge article for the Estate Specialist, recency-guarded on KnowledgeArticle", async () => {
    const { prisma } = await import("@dpf/db");
    const tool = coworkerSelfTaskRequiredTool(INV);
    expect(tool?.name).toBe("create_knowledge_article");
    expect(tool!.args).toHaveProperty("title");
    expect(tool!.args).toHaveProperty("body");

    (prisma.knowledgeArticle.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ articleId: "KA-001" });
    expect(await tool!.hasRecentArtifact!()).toBe(true);
    (prisma.knowledgeArticle.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect(await tool!.hasRecentArtifact!()).toBe(false);
  });

  it("forces an idempotent doc_save (stable id) for the Documentation Specialist", async () => {
    const { prisma } = await import("@dpf/db");
    const tool = coworkerSelfTaskRequiredTool(DOC);
    expect(tool?.name).toBe("doc_save");
    // Stable documentId → upsert, so the fallback never duplicates the overview.
    expect(tool!.args["documentId"]).toBe(DOCS_HEALTH_DOCUMENT_ID);
    expect(tool!.args).toHaveProperty("contentText");

    const findFirst = prisma.document.findFirst as ReturnType<typeof vi.fn>;
    findFirst.mockResolvedValueOnce({ id: "d1" });
    expect(await tool!.hasRecentArtifact!()).toBe(true);
    // Guard must scope to the stable overview id.
    expect(findFirst.mock.calls[0]![0].where.documentId).toBe(DOCS_HEALTH_DOCUMENT_ID);
  });

  it("forces a knowledge article for the AI Ops Engineer, deduped per-topic (not global)", async () => {
    const { prisma } = await import("@dpf/db");
    const tool = coworkerSelfTaskRequiredTool(PLT);
    expect(tool?.name).toBe("create_knowledge_article");
    expect(tool!.args["title"]).toMatch(/^AI platform posture summary/);

    const findFirst = prisma.knowledgeArticle.findFirst as ReturnType<typeof vi.fn>;
    findFirst.mockClear();
    findFirst.mockResolvedValueOnce({ articleId: "KA-PLT" });
    expect(await tool!.hasRecentArtifact!()).toBe(true);
    // The dedup MUST scope on this topic's title prefix — a global "any article"
    // check would let the Estate Specialist's article stand down this task.
    expect(findFirst.mock.calls.at(-1)![0].where.title).toEqual({ startsWith: "AI platform posture summary" });
  });

  it("scopes the Estate Specialist dedup to its OWN title prefix (no cross-topic collision)", async () => {
    const { prisma } = await import("@dpf/db");
    const findFirst = prisma.knowledgeArticle.findFirst as ReturnType<typeof vi.fn>;
    findFirst.mockClear();
    findFirst.mockResolvedValueOnce(null);
    await coworkerSelfTaskRequiredTool(INV)!.hasRecentArtifact!();
    expect(findFirst.mock.calls.at(-1)![0].where.title).toEqual({ startsWith: "Estate posture summary" });
    // The two knowledge-article coworkers query DISJOINT title prefixes.
    expect(coworkerSelfTaskRequiredTool(INV)!.args["title"]).not.toEqual(
      coworkerSelfTaskRequiredTool(PLT)!.args["title"],
    );
  });

  it("returns null for a coworker with no self-task", () => {
    expect(coworkerSelfTaskRequiredTool("some-advisor")).toBeNull();
  });

  // BI-71D945CD. The Marketing Strategist USED to be forced to create a
  // placeholder "Acquisition campaign brief (needs refresh)" whenever its loop
  // produced nothing, on the reasoning that a provisional brief beat an empty
  // Campaigns page. The canonical marketing operating snapshot (BI-CEA797A1) now
  // renders an honest, actionable empty state for exactly that case — next step
  // "establish-campaign" plus a no-campaign blocker carrying one recovery action
  // — so the fabricated brief is strictly worse than the truth. Observed live on
  // 2026-07-31 creating real placeholder rows because model dispatch was failing.
  it("does NOT force a placeholder brief for the Marketing Strategist", () => {
    expect(coworkerSelfTaskRequiredTool(MKT)).toBeNull();
  });

  // The removal is deliberately marketing-only: the other three surfaces have no
  // equivalent honest empty state, so dropping their fallbacks would trade a
  // placeholder for a genuine wall of zeros. This pins the scope so a future
  // edit cannot silently widen or narrow it.
  it("leaves the other coworkers' procedural guarantees intact", () => {
    expect(coworkerSelfTaskRequiredTool(INV)?.name).toBe("create_knowledge_article");
    expect(coworkerSelfTaskRequiredTool(PLT)?.name).toBe("create_knowledge_article");
    expect(coworkerSelfTaskRequiredTool(DOC)?.name).toBe("doc_save");
  });
});

describe("inferLevelFromSelfTaskSchedule", () => {
  it("reads a daily cron (day-of-week wildcard) as assertive", () => {
    expect(inferLevelFromSelfTaskSchedule("7 14 * * *")).toBe("assertive");
  });
  it("reads a pinned day-of-week (weekly / twice-weekly) as balanced", () => {
    expect(inferLevelFromSelfTaskSchedule("7 14 * * 1")).toBe("balanced");
    expect(inferLevelFromSelfTaskSchedule("31 15 * * 2,5")).toBe("balanced");
  });
});

describe("reconcileAllCoworkerSelfTasks (toggle ⇆ task convergence)", () => {
  beforeEach(async () => {
    const { prisma } = await import("@dpf/db");
    for (const fn of [
      prisma.userFact.findMany,
      prisma.userFact.findFirst,
      prisma.userFact.update,
      prisma.userFact.create,
      prisma.scheduledAgentTask.findMany,
      prisma.scheduledAgentTask.findUnique,
      prisma.scheduledAgentTask.upsert,
      prisma.scheduledAgentTask.updateMany,
    ]) {
      (fn as ReturnType<typeof vi.fn>).mockClear();
    }
    (prisma.userFact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.scheduledAgentTask.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.scheduledAgentTask.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.userFact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it("Direction A: creates a missing task for an active Assertive fact (idle coworker)", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.userFact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      factRow("u1", INV, "assertive"),
    ]);
    (prisma.scheduledAgentTask.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const r = await reconcileAllCoworkerSelfTasks();

    expect(r.created).toBe(1);
    const upsert = prisma.scheduledAgentTask.upsert as ReturnType<typeof vi.fn>;
    expect(upsert.mock.calls[0]![0].where).toEqual({ taskId: coworkerSelfTaskId(INV, "u1") });
  });

  it("Direction A: leaves an already-active task untouched (no schedule churn)", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.userFact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      factRow("u1", INV, "assertive"),
    ]);
    (prisma.scheduledAgentTask.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ isActive: true });

    const r = await reconcileAllCoworkerSelfTasks();

    expect(r.created).toBe(0);
    expect(prisma.scheduledAgentTask.upsert as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("Direction A: deactivates a live task whose toggle is now quiet", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.userFact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      factRow("u1", INV, "quiet"),
    ]);
    (prisma.scheduledAgentTask.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ isActive: true });

    const r = await reconcileAllCoworkerSelfTasks();

    expect(r.deactivated).toBe(1);
    expect(prisma.scheduledAgentTask.updateMany as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
      where: { taskId: coworkerSelfTaskId(INV, "u1") },
      data: { isActive: false },
    });
  });

  it("ignores facts for coworkers with no registered self-task", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.userFact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      factRow("u1", "coo", "assertive"),
    ]);
    const r = await reconcileAllCoworkerSelfTasks();
    expect(r.created).toBe(0);
    expect(prisma.scheduledAgentTask.upsert as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("Direction B: restores a missing toggle from an orphaned daily self-task", async () => {
    const { prisma } = await import("@dpf/db");
    // No facts, but a live daily marketing self-task exists (fact went missing).
    (prisma.userFact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.scheduledAgentTask.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { taskId: coworkerSelfTaskId(MKT, "u1"), agentId: MKT, ownerUserId: "u1", schedule: "7 14 * * *" },
    ]);

    const r = await reconcileAllCoworkerSelfTasks();

    expect(r.backfilledFacts).toBe(1);
    // A daily orphan → Assertive toggle restored via a UserFact write.
    const created = prisma.userFact.create as ReturnType<typeof vi.fn>;
    expect(created).toHaveBeenCalledTimes(1);
    expect(JSON.parse(created.mock.calls[0]![0].data.value).level).toBe("assertive");
    expect(created.mock.calls[0]![0].data.key).toBe(PROACTIVITY_KEY(MKT));
  });

  it("Direction B: does NOT backfill a task that already has an active fact", async () => {
    const { prisma } = await import("@dpf/db");
    (prisma.userFact.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      factRow("u1", MKT, "assertive"),
    ]);
    (prisma.scheduledAgentTask.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ isActive: true });
    (prisma.scheduledAgentTask.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { taskId: coworkerSelfTaskId(MKT, "u1"), agentId: MKT, ownerUserId: "u1", schedule: "7 14 * * *" },
    ]);

    const r = await reconcileAllCoworkerSelfTasks();

    expect(r.backfilledFacts).toBe(0);
    expect(prisma.userFact.create as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
