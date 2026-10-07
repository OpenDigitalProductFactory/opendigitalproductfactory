import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@dpf/db", () => ({ Prisma: { DbNull: Symbol("DbNull") } }));

import { loadAiDecisionItems } from "./ai-decision";

/**
 * BI-7FFFBEE3 slice B. On 2026-10-07 the owner inbox held 25+ "Make this
 * business decision? … build FB-… stays blocked" cards. Each was a plan-gate
 * verdict recorded while the gate ran in shadow, so none of those builds was
 * blocked: they advanced anyway. A verdict that cannot block is audit evidence,
 * not a question for a person.
 */
function row(over: Record<string, unknown> = {}) {
  return {
    interactionId: "DI-1",
    question: "Should FB-1 advance from plan to build?",
    outcomeType: "escalate",
    riskTier: "high",
    principleConflict: false,
    rationale: "Escalate: high risk exceeds the delegated policy.",
    buildId: "FB-1",
    taskRunId: null,
    routeContext: "/build",
    domainClass: "plan-readiness",
    gateKey: "build-studio",
    createdAt: new Date("2026-10-07T00:00:00Z"),
    outcomePayload: {},
    resolutionProposals: [],
    ...over,
  };
}

function db(rows: unknown[], phases: Record<string, string> = {}) {
  return {
    decisionInteraction: { findMany: async () => rows },
    featureBuild: {
      findMany: async ({ where }: { where: { buildId: { in: string[] } } }) =>
        where.buildId.in.filter((id) => id in phases).map((buildId) => ({ buildId, phase: phases[buildId] })),
    },
  } as never;
}

describe("shadow and moot gate verdicts stay out of the owner inbox", () => {
  it("drops a verdict recorded in shadow enforcement", async () => {
    const items = await loadAiDecisionItems(db([
      row({ interactionId: "DI-shadow", outcomePayload: { enforcement: "shadow" } }),
      row({ interactionId: "DI-real", buildId: "FB-2", question: "Should FB-2 advance?" }),
    ], { "FB-2": "plan" }));
    expect(items.map((item) => item.id)).toEqual(["ai-decision:DI-real"]);
  });

  it("drops a plan-gate escalation whose build has already left plan, or was abandoned", async () => {
    const items = await loadAiDecisionItems(db([
      row({ interactionId: "DI-advanced", buildId: "FB-3", question: "Should FB-3 advance?" }),
      row({ interactionId: "DI-abandoned", buildId: "FB-4", question: "Should FB-4 advance?" }),
      row({ interactionId: "DI-waiting", buildId: "FB-5", question: "Should FB-5 advance?" }),
    ], { "FB-3": "build", "FB-4": "abandoned", "FB-5": "plan" }));
    expect(items.map((item) => item.id)).toEqual(["ai-decision:DI-waiting"]);
  });

  it("keeps a blocking escalation with no build attached", async () => {
    const items = await loadAiDecisionItems(db([
      row({ interactionId: "DI-org", buildId: null, domainClass: "org-business", gateKey: "org-business", question: "Approve the partner discount?" }),
    ]));
    expect(items.map((item) => item.id)).toEqual(["ai-decision:DI-org"]);
  });
});
