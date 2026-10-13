import { describe, expect, it, vi } from "vitest";

import {
  conductTriage,
  isPanelWorthy,
  type ConductorDeps,
  type TriageSubject,
} from "./triage-conductor";
import { buildPanelBrief } from "./triage-panel-brief";
import { planTriageStaffing } from "./triage-staffing";

const SUBJECT: TriageSubject = {
  interactionRowId: "row-1",
  interactionId: "DI-1",
  profileId: "org-perspective-1",
  question: "Do we ingest a third-party catalog without a signed DPA?",
  domainClass: "risk-assessment",
  gateKey: "org-business",
  riskTier: "medium",
  outcomeType: "escalate",
  resolved: false,
};

const VERDICT = {
  recommendedAction: "answer_gap",
  draft: { question: SUBJECT.question, answer: "Not without a signed DPA." },
  summary: "Decline the ingest until a data agreement exists",
  consequences: [{ optionId: "proceed", text: "Accepts the exposure until a DPA exists." }],
  dissent: [],
  confidence: 0.8,
};

function deps(overrides: Partial<ConductorDeps> = {}): ConductorDeps & { created: unknown[] } {
  const created: unknown[] = [];
  return {
    created,
    roster: async () => [{ agentId: "AGT-LEGAL", name: "compliance-officer", displayName: null }],
    runPanel: vi.fn(async () => ({
      deliberationRunId: "DR-1",
      consensusState: "consensus",
      rawVerdict: VERDICT,
    })),
    db: {
      decisionResolutionProposal: {
        async findFirst() {
          return null;
        },
        async findMany() {
          return [];
        },
        async create({ data }: { data: unknown }) {
          created.push(data);
          return data;
        },
        async updateMany() {
          return { count: 0 };
        },
      },
    },
    ...overrides,
  } as ConductorDeps & { created: unknown[] };
}

describe("isPanelWorthy", () => {
  it("spends a panel on an unresolved, consequential, answerable decision", () => {
    expect(isPanelWorthy(SUBJECT).eligible).toBe(true);
  });

  it("declines one that a human already settled", () => {
    expect(isPanelWorthy({ ...SUBJECT, resolved: true }).eligible).toBe(false);
  });

  it("declines one the gate itself settled", () => {
    expect(isPanelWorthy({ ...SUBJECT, outcomeType: "arbitrate" }).eligible).toBe(false);
  });

  it("declines a record with no question to reason about", () => {
    expect(isPanelWorthy({ ...SUBJECT, question: "   " }).eligible).toBe(false);
  });

  it("declines low risk, and accepts medium and above", () => {
    expect(isPanelWorthy({ ...SUBJECT, riskTier: "low" }).eligible).toBe(false);
    expect(isPanelWorthy({ ...SUBJECT, riskTier: null }).eligible).toBe(false);
    for (const riskTier of ["medium", "high", "critical"]) {
      expect(isPanelWorthy({ ...SUBJECT, riskTier }).eligible).toBe(true);
    }
  });
});

describe("conductTriage", () => {
  it("does not spend inference on the observed empty signin question", async () => {
    const d = deps();
    expect((await conductTriage(d, { ...SUBJECT, question: "grok signin start: " })).status).toBe("not-worth-a-panel");
    expect(d.runPanel).not.toHaveBeenCalled();
    expect(d.created).toHaveLength(0);
    expect(isPanelWorthy({ ...SUBJECT, question: "Sign in: should this account have access?" }).eligible).toBe(true);
  });

  it("blocks an unfinished panel even if the question has changed", async () => {
    const d = deps();
    expect((await conductTriage(d, { ...SUBJECT, previousPanel: { id: "old", completedAt: null, brief: "old case" } })).status).toBe("panel-pending");
    expect(d.runPanel).not.toHaveBeenCalled();
  });

  it("blocks the same completed case but admits changed evidence", async () => {
    const plan = planTriageStaffing({ domainClass: SUBJECT.domainClass, gateKey: SUBJECT.gateKey, question: SUBJECT.question });
    const previousPanel = { id: "old", completedAt: new Date(), brief: buildPanelBrief({ subject: SUBJECT, plan, optionIds: [] }) };
    const d = deps();
    expect((await conductTriage(d, { ...SUBJECT, previousPanel })).status).toBe("case-unchanged");
    expect(d.runPanel).not.toHaveBeenCalled();
    expect((await conductTriage(d, { ...SUBJECT, previousPanel, evidenceBundle: { dpaSigned: true } })).status).toBe("proposed");
    expect(d.runPanel).toHaveBeenCalledTimes(1);
  });

  it("does not treat JSON key ordering as new evidence", async () => {
    const original = { ...SUBJECT, evidenceBundle: { a: 1, b: 2 } };
    const plan = planTriageStaffing({ domainClass: SUBJECT.domainClass, gateKey: SUBJECT.gateKey, question: SUBJECT.question });
    const previousPanel = { id: "old", completedAt: new Date(), brief: buildPanelBrief({ subject: original, plan, optionIds: [] }) };
    const d = deps();
    expect((await conductTriage(d, { ...SUBJECT, evidenceBundle: { b: 2, a: 1 }, previousPanel })).status).toBe("case-unchanged");
    expect(d.runPanel).not.toHaveBeenCalled();
  });
  it("drafts a proposal from an admissible verdict", async () => {
    const d = deps();
    const outcome = await conductTriage(d, SUBJECT);
    expect(outcome).toMatchObject({ status: "proposed", proposalId: "DRP-i-row-1" });
    expect(d.created).toHaveLength(1);
    expect(d.created[0]).toMatchObject({
      actionKind: "answer_gap",
      deliberationRunId: "DR-1",
      interactionId: "row-1",
    });
  });

  it("never convenes a panel for a decision that does not warrant one", async () => {
    const d = deps();
    const outcome = await conductTriage(d, { ...SUBJECT, riskTier: "low" });
    expect(outcome.status).toBe("not-worth-a-panel");
    expect(d.runPanel).not.toHaveBeenCalled();
    expect(d.created).toHaveLength(0);
  });

  it("stands down when a human settled it first", async () => {
    const d = deps();
    const outcome = await conductTriage(d, { ...SUBJECT, resolved: true });
    expect(outcome.status).toBe("already-resolved");
    expect(d.runPanel).not.toHaveBeenCalled();
  });

  it("writes nothing when the panel could not be convened", async () => {
    const d = deps({ runPanel: async () => null });
    const outcome = await conductTriage(d, SUBJECT);
    expect(outcome.status).toBe("panel-unavailable");
    expect(d.created).toHaveLength(0);
  });

  it("takes the run's own word over its output when it reported it could not ground an answer", async () => {
    const d = deps({
      runPanel: async () => ({
        deliberationRunId: "DR-1",
        // Says it could not ground an answer, yet returns a confident draft.
        consensusState: "insufficient-evidence",
        rawVerdict: VERDICT,
      }),
    });
    const outcome = await conductTriage(d, SUBJECT);
    expect(outcome.status).toBe("panel-inconclusive");
    expect(d.created).toHaveLength(0);
  });

  it("refuses a verdict that failed the contract, and says which part failed", async () => {
    const d = deps({
      runPanel: async () => ({
        deliberationRunId: "DR-1",
        consensusState: "consensus",
        rawVerdict: { ...VERDICT, dissent: undefined },
      }),
    });
    const outcome = await conductTriage(d, SUBJECT);
    expect(outcome).toMatchObject({ status: "verdict-refused" });
    if (outcome.status !== "verdict-refused") return;
    expect(outcome.detail).toContain("disagreed");
    expect(d.created).toHaveLength(0);
  });

  it("does not pile a second draft onto a decision that already has one open", async () => {
    const d = deps();
    d.db.decisionResolutionProposal.findFirst = async () => ({ status: "proposed" });
    const outcome = await conductTriage(d, SUBJECT);
    expect(outcome.status).toBe("already-proposed");
    expect(d.created).toHaveLength(0);
  });

  it("yields to a ruling that landed while the panel was running", async () => {
    const d = deps();
    d.db.decisionResolutionProposal.findFirst = async () => ({ status: "rejected" });
    const outcome = await conductTriage(d, SUBJECT);
    expect(outcome).toMatchObject({ status: "already-resolved" });
    expect(d.created).toHaveLength(0);
  });

  it("reports an uncovered panel so the card can say no specialist applied", async () => {
    const d = deps();
    const outcome = await conductTriage(d, {
      ...SUBJECT,
      domainClass: "kernel-consult",
      question: "Should we do the thing?",
      riskTier: "high",
    });
    expect(outcome).toMatchObject({ status: "proposed", uncovered: true });
  });

  it("seats the coworkers the plan justifies, and only those", async () => {
    const d = deps();
    await conductTriage(d, SUBJECT);
    expect(d.runPanel).toHaveBeenCalledWith(
      expect.objectContaining({ staffedAgentIds: ["AGT-LEGAL"] }),
    );
  });
});
