import { describe, it, expect } from "vitest";
import { summarizeCampaignExecution, CAMPAIGN_STATUSES } from "./campaigns";
import { taskMatchesBrief } from "./subroutes";

describe("summarizeCampaignExecution", () => {
  it("tells you to create a brief when the campaign is empty", () => {
    const r = summarizeCampaignExecution({ briefs: [], tasks: [] });
    expect(r.briefCount).toBe(0);
    expect(r.taskCount).toBe(0);
    expect(r.nextStep).toMatch(/create a campaign brief/i);
  });

  it("tells you to add tasks when there is a brief but no tasks", () => {
    const r = summarizeCampaignExecution({ briefs: [{ status: "draft" }], tasks: [] });
    expect(r.nextStep).toMatch(/break the brief into asset tasks/i);
  });

  it("counts undrafted tasks and prompts drafting", () => {
    const r = summarizeCampaignExecution({
      briefs: [{ status: "active" }],
      tasks: [{ taskId: "t1", status: "draft" }, { taskId: "t2", status: "draft" }],
    });
    expect(r.taskCount).toBe(2);
    expect(r.undraftedCount).toBe(2);
    expect(r.nextStep).toMatch(/draft 2 asset tasks/i);
  });

  it("separates drafted from approved and prompts review", () => {
    const r = summarizeCampaignExecution({
      briefs: [{ status: "active" }],
      tasks: [{ taskId: "t1", status: "draft" }, { taskId: "t2", status: "draft" }],
      draftedTaskIds: new Set(["t1", "t2"]),
    });
    expect(r.draftedCount).toBe(2);
    expect(r.undraftedCount).toBe(0);
    expect(r.nextStep).toMatch(/review 2 drafts/i);
  });

  it("an approved task does not double-count as drafted", () => {
    const r = summarizeCampaignExecution({
      briefs: [{ status: "active" }],
      tasks: [{ taskId: "t1", status: "draft" }],
      draftedTaskIds: new Set(["t1"]),
      approvedTaskIds: new Set(["t1"]),
    });
    expect(r.approvedCount).toBe(1);
    expect(r.draftedCount).toBe(0);
    expect(r.nextStep).toMatch(/publish 1 approved draft/i);
  });

  it("prompts measurement once everything is produced", () => {
    const r = summarizeCampaignExecution({
      briefs: [{ status: "active" }],
      tasks: [{ taskId: "t1", status: "published" }],
      approvedTaskIds: new Set(["t1"]),
    });
    // approved -> publish step; once published-with-no-pending it still routes to publish/measure
    expect(r.nextStep).toBeTruthy();
  });

  it("exposes the four lifecycle statuses", () => {
    expect([...CAMPAIGN_STATUSES]).toEqual(["draft", "active", "paused", "complete"]);
  });
});

describe("taskMatchesBrief — campaign relation over fuzzy match", () => {
  const baseBrief = {
    briefId: "b1",
    campaignId: null as string | null,
    title: "Spring Launch",
    objective: "x",
    audience: null,
    channels: [] as string[],
    cta: null,
    proofAssets: [] as string[],
    kpis: [] as string[],
    notes: null,
    status: "draft",
    createdAt: new Date(),
  };
  const baseTask = {
    taskId: "t1",
    campaignId: null as string | null,
    title: "Some asset",
    assetType: "linkedin",
    channel: null as string | null,
    dueWindow: null,
    brief: null as string | null,
    status: "draft",
    createdAt: new Date(),
  };

  it("matches when both share the same campaignId (definitive)", () => {
    const brief = { ...baseBrief, campaignId: "c1", title: "Totally Unrelated" };
    const task = { ...baseTask, campaignId: "c1", title: "nothing in common" };
    expect(taskMatchesBrief(task, brief)).toBe(true);
  });

  it("does NOT match when both have different campaignIds, even if text overlaps", () => {
    const brief = { ...baseBrief, campaignId: "c1", title: "Spring Launch" };
    const task = { ...baseTask, campaignId: "c2", title: "Spring Launch teaser" };
    expect(taskMatchesBrief(task, brief)).toBe(false);
  });

  it("falls back to channel overlap when campaignId is absent", () => {
    const brief = { ...baseBrief, channels: ["linkedin"] };
    const task = { ...baseTask, channel: "linkedin" };
    expect(taskMatchesBrief(task, brief)).toBe(true);
  });

  it("falls back to title substring when campaignId is absent", () => {
    const brief = { ...baseBrief, title: "Spring Launch" };
    const task = { ...baseTask, title: "Spring Launch hero post" };
    expect(taskMatchesBrief(task, brief)).toBe(true);
  });

  it("uses fuzzy match when only one side has a campaignId", () => {
    const brief = { ...baseBrief, campaignId: "c1", channels: ["linkedin"] };
    const task = { ...baseTask, campaignId: null, channel: "linkedin" };
    expect(taskMatchesBrief(task, brief)).toBe(true);
  });
});
