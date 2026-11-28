import { describe, expect, it, vi } from "vitest";

import type { InvestmentItemRow } from "@/lib/portfolio/investment-read-model";
import type { PortfolioBudgetStatus } from "@/lib/portfolio/portfolio-budget";
import { buildAuthorStageFunding, decideAuthorStageAutonomy } from "@/lib/work-management/author-stage-autonomy";
import type { AuthorStageAutonomyFor } from "@/lib/work-management/author-stage-autonomy-live";
import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import { runWorkroomDriveJob, type WorkroomDriveEffects, type WorkroomDriveRoom } from "./workroom-drive";

// BI-8A32EBFF: the drive job asks the author-stage rule once per run and binds
// role:author for each room it allows; every other room raises attention as before.

const NOW = new Date("2026-10-07T12:00:00.000Z");
const IN_FORCE = { state: "in-force" as const, setByUserId: "user-op", setAt: NOW.toISOString(), reason: "all shapes" };

function room(over: Partial<WorkroomDriveRoom> = {}): WorkroomDriveRoom {
  return {
    id: "row-1",
    capsuleId: "WC-DELIVERY",
    backlogItemId: "BI-FUNDED",
    scopeClaims: [buildWorkShapeClaim({ key: "delivery-small", version: "1.0.0" })],
    workspaceState: {},
    leaseExpiresAt: null,
    leaseHolderPrincipalId: null,
    ownerUserId: "user-1",
    participants: [{
      workroomId: "row-1", principalRef: "PRN-COORD", roles: ["coordinator"], assignmentSource: "explicit",
      enteredReason: null, currentWorkSummary: null, displayName: "Overseer", kind: "agent",
      sponsorPrincipalRef: null, sponsorDisplayName: null, authoritySummary: "",
    }],
    currentStageKey: null,
    receipts: [],
    budgetUsage: [],
    stopConditionHits: [],
    reviewDue: false,
    substrateReachable: true,
    substrateEmpty: false,
    coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
    ...over,
  };
}

function effects() {
  return {
    persist: vi.fn<WorkroomDriveEffects["persist"]>(async () => {}),
    acquireLease: vi.fn<WorkroomDriveEffects["acquireLease"]>(async () => "acquired"),
    upsertAgentTask: vi.fn<WorkroomDriveEffects["upsertAgentTask"]>(async () => true),
    deactivateAgentTask: vi.fn<WorkroomDriveEffects["deactivateAgentTask"]>(async () => {}),
  };
}

const fundedOnly: AuthorStageAutonomyFor = (r, shapeKey) => decideAuthorStageAutonomy({
  shapeKey,
  preauthorisation: IN_FORCE,
  funding: r.backlogItemId === "BI-FUNDED"
    ? { funded: true, portfolioId: "pf", summary: "funded" }
    : { funded: false, because: "No budget is set for Foundational this quarter; unfunded work is not pre-authorised." },
});

describe("runWorkroomDriveJob: author stages under the pre-authorisation (BI-8A32EBFF)", () => {
  it("dispatches a funded room's author stage to the software-engineer coworker", async () => {
    const fx = effects();
    const loader = vi.fn(async () => fundedOnly);
    const result = await runWorkroomDriveJob(NOW, { listRooms: async () => [room()], effects: fx, authorStageAutonomy: loader });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.dispatched).toBe(1);
    expect(fx.upsertAgentTask.mock.calls[0]?.[0]).toMatchObject({ agentId: "build-specialist" });
  });

  it("raises attention for an unfunded room and records which condition is missing", async () => {
    const fx = effects();
    const result = await runWorkroomDriveJob(NOW, {
      listRooms: async () => [room({ backlogItemId: "BI-UNFUNDED" })],
      effects: fx,
      authorStageAutonomy: async () => fundedOnly,
    });
    expect(result.attention).toBe(1);
    expect(fx.upsertAgentTask).not.toHaveBeenCalled();
    const snapshot = fx.persist.mock.calls[0]?.[0]?.snapshot as { reason?: string; ledger?: string[] };
    expect(snapshot.reason).toBe("role_stage");
    expect(snapshot.ledger?.join(" ")).toMatch(/An agent may not run it: No budget is set/);
  });

  it("a caller that supplies its own rooms and no rule keeps the prior behaviour: attention", async () => {
    const fx = effects();
    const result = await runWorkroomDriveJob(NOW, { listRooms: async () => [room()], effects: fx });
    expect(result.attention).toBe(1);
    expect(fx.upsertAgentTask).not.toHaveBeenCalled();
  });

  it("dispatches through real buildAuthorStageFunding when quarterly points are over plan or planning data is missing, while preserving capacity and pre-authorisation stops (BI-A59837E5)", async () => {
    const baseItem = (over: Partial<InvestmentItemRow> = {}): InvestmentItemRow => ({
      itemId: "BI-OVER", status: "in-progress", effortSize: "medium", jobSize: null, estimateAgreed: null,
      activeBuildId: null, hasActiveWorkroom: true, deliveredAt: null, deliverySurface: "external", traced: true,
      completedAt: null, storedPortfolioId: "pf-found", storedPortfolioDangling: false, productPortfolioId: null,
      taxonomyPortfolioId: null, coworkerNeedPortfolioId: null, epicPortfolioId: null, scopeKind: "platform",
      platformDefaultPortfolioId: "pf-found", ...over,
    });
    const budget: PortfolioBudgetStatus = {
      id: "pf-found", slug: "foundational", name: "Foundational",
      budget: { id: "b1", allocatedPoints: 8, usdPerPoint: null, wipAllowancePoints: null, setById: "u", setByAgentId: null, reason: "plan", supersedesId: null, createdAt: NOW },
    };
    const items = [
      baseItem({ itemId: "BI-DONE", status: "done", hasActiveWorkroom: false, deliveredAt: NOW, completedAt: NOW, effortSize: "large" }),
      baseItem({ itemId: "BI-OVER" }),
      baseItem({ itemId: "BI-UNALLOC", storedPortfolioId: null, scopeKind: "archetype-leaf" }),
      baseItem({ itemId: "BI-UNSIZE", effortSize: null }),
    ];
    const fundingFor = buildAuthorStageFunding({ items, budgets: [budget], now: NOW });
    const liveRule: AuthorStageAutonomyFor = (r, shapeKey) => decideAuthorStageAutonomy({
      shapeKey, preauthorisation: IN_FORCE, funding: fundingFor(r.backlogItemId ?? null),
    });

    for (const id of ["BI-OVER", "BI-UNALLOC", "BI-UNSIZE"]) {
      const fx = effects();
      const result = await runWorkroomDriveJob(NOW, {
        listRooms: async () => [room({ backlogItemId: id })],
        effects: fx,
        authorStageAutonomy: async () => liveRule,
      });
      expect(result.dispatched).toBe(1);
      expect(fx.upsertAgentTask.mock.calls[0]?.[0]).toMatchObject({ agentId: "build-specialist" });
    }

    // Real runner capacity limit still holds dispatch independently.
    const capFx = effects();
    const capped = await runWorkroomDriveJob(NOW, {
      listRooms: async () => [room({ backlogItemId: "BI-OVER" })],
      effects: capFx,
      authorStageAutonomy: async () => liveRule,
      dispatchCapacity: async () => ({ cap: 0, reason: "runner capacity exhausted" }),
    });
    expect(capped.dispatched).toBe(0);
    expect(capFx.upsertAgentTask).not.toHaveBeenCalled();

    // Revoked pre-authorisation still raises attention independently.
    const revokedFx = effects();
    const revokedRule: AuthorStageAutonomyFor = (r, shapeKey) => decideAuthorStageAutonomy({
      shapeKey,
      preauthorisation: { state: "not-in-force", because: "Revoked by operator." },
      funding: fundingFor(r.backlogItemId ?? null),
    });
    const revoked = await runWorkroomDriveJob(NOW, {
      listRooms: async () => [room({ backlogItemId: "BI-OVER" })],
      effects: revokedFx,
      authorStageAutonomy: async () => revokedRule,
    });
    expect(revoked.attention).toBe(1);
    expect(revokedFx.upsertAgentTask).not.toHaveBeenCalled();
  });
});
