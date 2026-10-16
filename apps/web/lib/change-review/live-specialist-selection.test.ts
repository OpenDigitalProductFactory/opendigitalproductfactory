import { selectableCoworkerIdentityRefs } from "@/lib/coworker-record/selectable-coworker";
import { describe, expect, it, vi } from "vitest";
import { resolveLiveReviewSpecialists, isLiveReviewSpecialistSelectionCurrent, liveReviewSpecialistSelectionSchema } from "./live-specialist-selection";

const agent = (agentId: string, role: string) => ({ agentId, name: role, slugId: role, status: "active", archived: false, lifecycleStage: "production" });
describe("live profession reviewer selection", () => {
  it("retains every required registered family beyond the resident roster and the old cap", async () => {
    const rows = ["data-architect", "ux-design-critic", "security-engineer", "finance-controller"].flatMap(role => [...new Set(Object.values(selectableCoworkerIdentityRefs(role)))].map(id => agent(id, role)));
    const result = await resolveLiveReviewSpecialists({ userId: "user-1", capsuleId: "WC-TEST", changedFiles: [], requiredProfessions: ["data-architect", "ux-design", "security", "finance"], authorAgentIds: [], db: { agent: { findMany: vi.fn().mockResolvedValue(rows) } } });
    expect(result.specialists).toHaveLength(4);
    expect(result.unavailableProfessions).toEqual([]);
    expect(result.specialists.map(row => row.professionKey)).toContain("finance");
  });
  it("binds selection to the authenticated person and exact room, using human craft labels", async () => {
    const result = await resolveLiveReviewSpecialists({ userId: "user-1", capsuleId: "WC-TEST", changedFiles: [], requiredProfessions: ["finance"], authorAgentIds: [], db: { agent: { findMany: vi.fn().mockResolvedValue([agent("review-finance", "finance-controller")]) } } });
    expect(result).toMatchObject({ userId: "user-1", capsuleId: "WC-TEST" });
    expect(result.specialists[0]?.displayName).toMatch(/finance/i);
    expect(result.specialists[0]?.displayName).not.toBe("review-finance");
  });
  it("uses the recorded UX design steward rather than substituting accessibility for design critique", async () => {
    const rows = [agent("AGT-903", "ux-accessibility-agent"), agent("ux-accessibility-agent", "ux-accessibility-agent"), agent("AGT-906", "ux-design-critic"), agent("ux-design-critic", "ux-design-critic")];
    const result = await resolveLiveReviewSpecialists({ userId: "user-1", capsuleId: "WC-TEST", changedFiles: ["prototype.html"], authorAgentIds: [], db: { agent: { findMany: vi.fn().mockResolvedValue(rows) } } });
    expect(result.specialists[0]?.agentId).toBe("AGT-906");
    const missing = await resolveLiveReviewSpecialists({ userId: "user-1", capsuleId: "WC-TEST", changedFiles: ["prototype.html"], authorAgentIds: [], db: { agent: { findMany: vi.fn().mockResolvedValue(rows.slice(0, 2)) } } });
    expect(missing.unavailableProfessions).toContain("ux-design");
  });
  it("recognizes UX-bearing HTML deliverables and keeps missing providers explicitly outstanding", async () => {
    const result = await resolveLiveReviewSpecialists({ userId: "user-1", capsuleId: "WC-TEST", changedFiles: ["docs/ux-fit/prototype.html"], authorAgentIds: [], db: { agent: { findMany: vi.fn().mockResolvedValue([]) } } });
    expect(result.requiredProfessions).toContain("ux-design");
    expect(result.unavailableProfessions).toContain("ux-design");
  });
  it("does not select the author through its canonical/runtime alias", async () => {
    const result = await resolveLiveReviewSpecialists({ userId: "user-1", capsuleId: "WC-TEST", changedFiles: [], requiredProfessions: ["ux-design"], authorAgentIds: ["ux-design-critic"], db: { agent: { findMany: vi.fn().mockResolvedValue([agent("AGT-906", "ux-design-critic"), agent("ux-design-critic", "ux-design-critic")]) } } });
    expect(result.specialists).toEqual([]);
    expect(result.unavailableProfessions).toEqual(["ux-design"]);
  });
  it("refuses unknown declared families and never falls back to an unrelated reviewer", async () => {
    await expect(resolveLiveReviewSpecialists({ userId: "user-1", capsuleId: "WC-TEST", changedFiles: [], requiredProfessions: ["invented-profession"], authorAgentIds: [], db: { agent: { findMany: vi.fn() } } })).rejects.toThrow(/registered profession/i);
  });
  it("requires current selectable state for both canonical and runtime records", async () => {
    const result = await resolveLiveReviewSpecialists({ userId: "user-1", capsuleId: "WC-TEST", changedFiles: [], requiredProfessions: ["ux-design"], authorAgentIds: [], db: { agent: { findMany: vi.fn().mockResolvedValue([agent("AGT-906", "ux-design-critic"), { ...agent("ux-design-critic", "ux-design-critic"), archived: true }]) } } });
    expect(result.specialists).toEqual([]);
    expect(result.unavailableProfessions).toEqual(["ux-design"]);
  });
  it("refuses a canonical/runtime pair that no longer belongs to the same craft", async () => {
    const result = await resolveLiveReviewSpecialists({ userId: "user-1", capsuleId: "WC-TEST", changedFiles: [], requiredProfessions: ["ux-design"], authorAgentIds: [], db: { agent: { findMany: vi.fn().mockResolvedValue([agent("AGT-906", "ux-design-critic"), agent("ux-design-critic", "security-engineer")]) } } });
    expect(result.specialists).toEqual([]);
    expect(result.unavailableProfessions).toEqual(["ux-design"]);
  });
  it("rejects a saved self-review selection even when the author uses its runtime alias", () => {
    expect(liveReviewSpecialistSelectionSchema.safeParse({ schemaVersion: 1, userId: "user-1", capsuleId: "WC-TEST", registryVersion: "1", authorAgentIds: ["ux-design-critic"], requiredProfessions: ["ux-design"], specialists: [{ professionKey: "ux-design", agentId: "AGT-906", displayName: "UX Design" }], unavailableProfessions: [] }).success).toBe(false);
  });
});


it("revalidates the saved provider without silently replacing it with a new candidate", async () => {
  const rows = [agent("review-finance", "finance-controller")];
  const db = { agent: { findMany: vi.fn().mockResolvedValue(rows) } };
  const selection = await resolveLiveReviewSpecialists({ userId: "user-1", capsuleId: "WC-TEST", changedFiles: [], requiredProfessions: ["finance"], authorAgentIds: [], db });
  db.agent.findMany.mockResolvedValue([agent("a-new-reviewer", "finance-controller"), ...rows]);
  expect(await isLiveReviewSpecialistSelectionCurrent(selection, db)).toBe(true);
  db.agent.findMany.mockResolvedValue([{ ...rows[0]!, archived: true }]);
  expect(await isLiveReviewSpecialistSelectionCurrent(selection, db)).toBe(false);
});
