import { beforeEach, describe, expect, it, vi } from "vitest";

// prisma is used by several handlers; stub the surfaces the delegation tests hit.
const db = vi.hoisted(() => ({
  employeeProfile: { findUnique: vi.fn() },
  feedbackNote: { create: vi.fn() },
  improvementProposal: { create: vi.fn(), update: vi.fn() },
  agentMessage: { findMany: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));

const skillSvc = vi.hoisted(() => ({ submitSkillImprovementProposal: vi.fn() }));
vi.mock("@/lib/skills/proposals", () => ({
  submitSkillImprovementProposal: (...a: unknown[]) => skillSvc.submitSkillImprovementProposal(...a),
}));

const backlogSvc = vi.hoisted(() => ({
  ingestBacklogItem: vi.fn(),
  improvementCategoryToWorkType: vi.fn((_category: unknown) => "feature"),
}));
vi.mock("@/lib/operate/backlog-ingest", () => ({
  ingestBacklogItem: (...a: unknown[]) => backlogSvc.ingestBacklogItem(...a),
  improvementCategoryToWorkType: (category: unknown) => backlogSvc.improvementCategoryToWorkType(category),
}));

// Fire-and-forget semantic index — keep it inert so the handler under test does
// not touch a real embedding pipeline.
vi.mock("@/lib/semantic-memory", () => ({ storePlatformKnowledge: vi.fn().mockResolvedValue(undefined) }));

import { contributionHivePack } from "./contribution-hive-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "assess_contribution",
  "contribute_to_hive",
  "submit_feedback",
  "propose_improvement",
  "propose_skill_improvement",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("contribution-hive pack — registration", () => {
  it("exposes exactly the five contribution & hive tools with a handler each", () => {
    expect(contributionHivePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(contributionHivePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("has a stable packId", () => {
    expect(contributionHivePack.packId).toBe("contribution-hive");
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of contributionHivePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants TOOL_TO_GRANTS for every tool", () => {
    expect(contributionHivePack.grants.assess_contribution).toEqual(["backlog_read"]);
    expect(contributionHivePack.grants.contribute_to_hive).toEqual(["backlog_write"]);
    expect(contributionHivePack.grants.submit_feedback).toEqual(["backlog_write"]);
    expect(contributionHivePack.grants.propose_improvement).toEqual(["decision_record_create"]);
    expect(contributionHivePack.grants.propose_skill_improvement).toEqual(["decision_record_create"]);

    expect(isToolAllowedByGrants("assess_contribution", ["backlog_read"])).toBe(true);
    expect(isToolAllowedByGrants("contribute_to_hive", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("submit_feedback", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("propose_improvement", ["decision_record_create"])).toBe(true);
    expect(isToolAllowedByGrants("propose_skill_improvement", ["decision_record_create"])).toBe(true);
  });
});

describe("contribution-hive pack — handler behavior (delegation preserved)", () => {
  it("submit_feedback errors without an employee profile, before writing a note", async () => {
    db.employeeProfile.findUnique.mockResolvedValue(null);
    const res = await contributionHivePack.handlers.submit_feedback(
      { toEmployeeId: "EMP-2", content: "nice", feedbackType: "praise" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Your employee profile not found");
    expect(db.feedbackNote.create).not.toHaveBeenCalled();
  });

  it("submit_feedback writes a FeedbackNote from the caller's profile", async () => {
    db.employeeProfile.findUnique.mockResolvedValue({ id: "EMP-FROM" });
    db.feedbackNote.create.mockResolvedValue({});
    const res = await contributionHivePack.handlers.submit_feedback(
      { toEmployeeId: "EMP-TO", content: "great work", feedbackType: "praise", visibility: "shared" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toMatch(/^FB-/);
    const [arg] = db.feedbackNote.create.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(arg.data).toMatchObject({
      fromEmployeeId: "EMP-FROM",
      toEmployeeId: "EMP-TO",
      content: "great work",
      feedbackType: "praise",
      visibility: "shared",
    });
  });

  it("propose_skill_improvement rejects missing required fields before delegating", async () => {
    const res = await contributionHivePack.handlers.propose_skill_improvement(
      { skillId: "build-page", title: "", description: "", proposedContent: "" },
      "u1",
      {},
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Missing required fields");
    expect(skillSvc.submitSkillImprovementProposal).not.toHaveBeenCalled();
  });

  it("propose_skill_improvement delegates to the skills service and returns the proposal id", async () => {
    skillSvc.submitSkillImprovementProposal.mockResolvedValue({ proposalId: "SKP-1" });
    const res = await contributionHivePack.handlers.propose_skill_improvement(
      { skillId: "build-page", title: "Tighten", description: "why", proposedContent: "new body", severity: "high" },
      "actor-9",
      { agentId: "AGT-7", routeContext: "/build", threadId: "THR-1" },
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("SKP-1");
    const [arg] = skillSvc.submitSkillImprovementProposal.mock.calls[0] as [Record<string, unknown>];
    expect(arg).toMatchObject({
      skillId: "build-page",
      proposedContent: "new body",
      title: "Tighten",
      severity: "high",
      submittedById: "actor-9",
      agentId: "AGT-7",
      routeContext: "/build",
      threadId: "THR-1",
    });
  });

  it("propose_improvement records the proposal and auto-files it to the backlog", async () => {
    db.agentMessage.findMany.mockResolvedValue([]);
    db.improvementProposal.create.mockResolvedValue({
      proposalId: "IP-ABCDE",
      title: "Faster search",
      description: "desc",
      observedFriction: null,
      severity: "medium",
    });
    backlogSvc.ingestBacklogItem.mockResolvedValue({ itemId: "IMP-1" });
    db.improvementProposal.update.mockResolvedValue({});

    const res = await contributionHivePack.handlers.propose_improvement(
      { title: "Faster search", description: "desc", category: "performance" },
      "u1",
      { agentId: "AGT-7", routeContext: "/build", threadId: "THR-1" },
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("IP-ABCDE");
    expect(res.message).toContain("IMP-1");
    expect(backlogSvc.ingestBacklogItem).toHaveBeenCalledTimes(1);
  });
});
