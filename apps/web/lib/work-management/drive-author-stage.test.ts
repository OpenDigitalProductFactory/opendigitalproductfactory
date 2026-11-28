import { describe, expect, it } from "vitest";

import type { InvestmentItemRow } from "@/lib/portfolio/investment-read-model";
import type { PortfolioBudgetStatus } from "@/lib/portfolio/portfolio-budget";
import { AUTHOR_STAGE_AGENT_REF, buildAuthorStageFunding, decideAuthorStageAutonomy } from "./author-stage-autonomy";
import { DELIVERY_SHAPES } from "./delivery-shapes";
import { resolveDrivePlan } from "./drive-resolution";
import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";
import { readWorkShapeDefinitionContract } from "./work-shapes";

// BI-8A32EBFF: the drive runs a role:author delivery stage with an agent only
// under the operator pre-authorisation and within budget; otherwise it raises
// attention as before and its ledger names the missing condition.

function participant(principalRef: string, roles: WorkroomParticipantRole[], kind: WorkroomParticipantView["kind"]): WorkroomParticipantView {
  return {
    principalRef, displayName: principalRef, kind, roles, workState: "unknown", presence: "unknown",
    currentWorkSummary: null, enteredReason: null, sponsorPrincipalRef: null, authoritySummary: "", sourceRefs: [],
    assignmentSource: "explicit", coordinatorSource: roles.includes("coordinator") ? "explicit" : "none",
  };
}

const IN_FORCE = { state: "in-force" as const, setByUserId: "user-op", setAt: "2026-10-07T00:00:00.000Z", reason: "all shapes" };
const FUNDED = { funded: true as const, portfolioId: "pf", summary: "funded" };

function plan(
  shapeKey: keyof typeof DELIVERY_SHAPES,
  stageKey: string,
  autonomy: ReturnType<typeof decideAuthorStageAutonomy>,
  receipts: { stageKey: string; kind: string }[] = [],
) {
  return resolveDrivePlan({
    roomId: "WC-DELIVERY",
    definition: readWorkShapeDefinitionContract(DELIVERY_SHAPES[shapeKey]),
    collaborationShape: null,
    postureLevel: "balanced",
    participants: [
      participant("PRN-COORD", ["coordinator"], "agent"),
      participant("PRN-OWNER", ["accountable"], "person"),
      participant("PRN-REVIEWER", ["reviewer"], "person"),
    ],
    currentStageKey: stageKey,
    proposedStageKey: stageKey,
    receipts,
    budgetUsage: [],
    stopConditionHits: [],
    reviewDue: false,
    substrateReachable: true,
    substrateEmpty: false,
    coordinatorHasProcessCoordinationAuthority: true,
    coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
    now: new Date("2026-10-07T12:00:00.000Z"),
    roleBindings: autonomy.roleBindings,
    authorStageWithheldBecause: autonomy.withheldBecause,
    authorStagePlanningAdvisory: autonomy.planningAdvisory ?? null,
  });
}

describe("drive: role:author delivery stages under the operator pre-authorisation (BI-8A32EBFF)", () => {
  it("AC-1: dispatches the author stage to the coworker when pre-authorised and funded", () => {
    const autonomy = decideAuthorStageAutonomy({ shapeKey: "delivery-medium", preauthorisation: IN_FORCE, funding: FUNDED });
    const result = plan("delivery-medium", "design-note", autonomy);
    expect(result).toMatchObject({ action: "dispatch_agent", reason: "agent_stage", stageKey: "design-note", accountablePrincipalRef: AUTHOR_STAGE_AGENT_REF });
  });

  it("AC-1: without funding the stage raises attention as before, and the ledger names the missing condition", () => {
    const autonomy = decideAuthorStageAutonomy({
      shapeKey: "delivery-medium",
      preauthorisation: IN_FORCE,
      funding: { funded: false, because: "No budget is set for Foundational this quarter; unfunded work is not pre-authorised." },
    });
    const result = plan("delivery-medium", "design-note", autonomy);
    expect(result).toMatchObject({ action: "attention", reason: "role_stage", attentionPrincipalRef: "role:author" });
    expect(result.ledger.join(" ")).toMatch(/An agent may not run it: No budget is set for Foundational/);
  });

  it("AC-1: without the pre-authorisation the stage raises attention, naming it", () => {
    const autonomy = decideAuthorStageAutonomy({
      shapeKey: "delivery-break-fix",
      preauthorisation: { state: "not-in-force", because: "No operator pre-authorisation is recorded (workroom-drive.author-stage-preauthorisation)." },
      funding: FUNDED,
    });
    const result = plan("delivery-break-fix", "reproduce", autonomy);
    expect(result).toMatchObject({ action: "attention", reason: "role_stage" });
    expect(result.ledger.join(" ")).toMatch(/No operator pre-authorisation is recorded/);
  });

  it("AC-2: a governed author stage (merge) still escalates to a person even when pre-authorised and funded", () => {
    const autonomy = decideAuthorStageAutonomy({ shapeKey: "delivery-medium", preauthorisation: IN_FORCE, funding: FUNDED });
    const done = (key: string) => ({ stageKey: key, kind: "completed" });
    const result = plan("delivery-medium", "merge", autonomy, [done("design-note"), done("implement")]);
    expect(result).toMatchObject({ action: "attention", reason: "governed_decision", agentId: null });
  });
});

describe("drive: quarterly planning overage and missing planning data are advisory, not stops (BI-A59837E5)", () => {
  const NOW = new Date("2026-10-07T12:00:00.000Z");
  const item = (overrides: Partial<InvestmentItemRow> = {}): InvestmentItemRow => ({
    itemId: "BI-1", status: "in-progress", effortSize: "medium", jobSize: null, estimateAgreed: null,
    activeBuildId: null, hasActiveWorkroom: true, deliveredAt: null, deliverySurface: "external", traced: true,
    completedAt: null, storedPortfolioId: "pf-found", storedPortfolioDangling: false, productPortfolioId: null,
    taxonomyPortfolioId: null, coworkerNeedPortfolioId: null, epicPortfolioId: null, scopeKind: "platform",
    platformDefaultPortfolioId: "pf-found", ...overrides,
  });
  const budget = (allocatedPoints: number | null): PortfolioBudgetStatus => ({
    id: "pf-found", slug: "foundational", name: "Foundational",
    budget: allocatedPoints === null ? null : {
      id: "b1", allocatedPoints, usdPerPoint: null, wipAllowancePoints: null,
      setById: "user-op", setByAgentId: null, reason: "plan", supersedesId: null, createdAt: NOW,
    },
  });

  it("dispatches below, at, and above the quarterly planning threshold and records the advisory warning only when over", () => {
    const delivered = item({ itemId: "BI-DONE", status: "done", hasActiveWorkroom: false, deliveredAt: NOW, completedAt: NOW, effortSize: "large" });
    const inFlight = item({ itemId: "BI-1", status: "in-progress", effortSize: "medium" });

    for (const [allocated, expectWarning] of [[20, false], [11, false], [8, true]] as const) {
      const funding = buildAuthorStageFunding({ items: [delivered, inFlight], budgets: [budget(allocated)], now: NOW })("BI-1");
      const autonomy = decideAuthorStageAutonomy({ shapeKey: "delivery-medium", preauthorisation: IN_FORCE, funding });
      const result = plan("delivery-medium", "design-note", autonomy);
      expect(result).toMatchObject({ action: "dispatch_agent", reason: "agent_stage", accountablePrincipalRef: AUTHOR_STAGE_AGENT_REF });
      if (expectWarning) {
        expect(result.ledger.join(" ")).toMatch(/11 of 8 points.*3 over.*8 delivered, 3 in flight.*unknown/i);
      } else {
        expect(result.ledger.join(" ")).not.toMatch(/Planning warning/i);
      }
    }
  });

  it("dispatches when planning-only data is missing (no budget set, unsized, unallocated) and records the advisory diagnostic", () => {
    const cases: Array<[InvestmentItemRow[], PortfolioBudgetStatus[], string, RegExp]> = [
      [[item()], [budget(null)], "BI-1", /No quarterly plan is set/i],
      [[item({ effortSize: null })], [budget(20)], "BI-1", /no size/i],
      [[item({ storedPortfolioId: null, scopeKind: "archetype-leaf" })], [budget(20)], "BI-1", /reaches no portfolio/i],
    ];
    for (const [items, budgets, id, pattern] of cases) {
      const funding = buildAuthorStageFunding({ items, budgets, now: NOW })(id);
      const autonomy = decideAuthorStageAutonomy({ shapeKey: "delivery-medium", preauthorisation: IN_FORCE, funding });
      const result = plan("delivery-medium", "design-note", autonomy);
      expect(result).toMatchObject({ action: "dispatch_agent", reason: "agent_stage", accountablePrincipalRef: AUTHOR_STAGE_AGENT_REF });
      expect(result.ledger.join(" ")).toMatch(pattern);
    }
  });

  it("never lets a planning warning bypass revoked pre-authorisation, xlarge exclusion, or governed merge", () => {
    const over = buildAuthorStageFunding({
      items: [item({ itemId: "BI-DONE", status: "done", hasActiveWorkroom: false, deliveredAt: NOW, completedAt: NOW, effortSize: "large" }), item()],
      budgets: [budget(8)],
      now: NOW,
    })("BI-1");

    const revoked = decideAuthorStageAutonomy({
      shapeKey: "delivery-medium",
      preauthorisation: { state: "not-in-force", because: "Pre-authorisation revoked." },
      funding: over,
    });
    expect(plan("delivery-medium", "design-note", revoked)).toMatchObject({ action: "attention", reason: "role_stage", agentId: null });

    const xlargeStage = DELIVERY_SHAPES["delivery-xlarge"].stages[0]!.key;
    const xlarge = decideAuthorStageAutonomy({ shapeKey: "delivery-xlarge", preauthorisation: IN_FORCE, funding: over });
    expect(plan("delivery-xlarge", xlargeStage, xlarge)).toMatchObject({ action: "attention", reason: "role_stage", agentId: null });

    const allowedOver = decideAuthorStageAutonomy({ shapeKey: "delivery-medium", preauthorisation: IN_FORCE, funding: over });
    const done = (key: string) => ({ stageKey: key, kind: "completed" });
    expect(plan("delivery-medium", "merge", allowedOver, [done("design-note"), done("implement")]))
      .toMatchObject({ action: "attention", reason: "governed_decision", agentId: null });
  });
});
