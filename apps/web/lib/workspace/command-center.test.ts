import { describe, expect, it } from "vitest";
import {
  buildWorkspaceCommandCenterView,
  deriveContainmentState,
  deriveReadinessCell,
  type WorkspaceCommandCenterInput,
} from "./command-center";

function makeInput(overrides: Partial<WorkspaceCommandCenterInput> = {}): WorkspaceCommandCenterInput {
  return {
    metrics: {
      activeProductCount: 2,
      portfolioCount: 1,
      agentCount: 4,
      providerCount: 2,
      activeProviderCount: 1,
      epicCount: 3,
      openBacklogCount: 5,
      inProgressBacklogCount: 2,
      doneBacklogCount: 11,
      employeeCount: 6,
      activeEmployeeCount: 5,
      customerAccountCount: 9,
      improvementCount: 4,
      actionableImprovementCount: 2,
      userCount: 7,
      eaViewCount: 3,
      buildCount: 8,
      documentCount: 5,
      activeObligationCount: 10,
      openIncidentCount: 1,
      implementedControlCount: 12,
      totalControlCount: 14,
      overdueActionCount: 1,
      publishedPolicyCount: 6,
      pendingAlertCount: 1,
      financeOutstandingCount: 4,
      financeOverdueCount: 1,
      financeUnpaidBillCount: 2,
    },
    agentsWithBrokenProviders: 1,
    activeTaskRuns: [
      {
        id: "tr-1",
        taskRunId: "TR-1",
        title: "Reconcile overdue invoices",
        status: "working",
        source: "coworker",
        actor: "Finance coworker",
        routeContext: "/finance",
      },
    ],
    activeScheduledTaskCount: 2,
    overdueScheduledTaskCount: 1,
    blockedTaskRunCount: 1,
    recentFailedTaskRunCount: 1,
    pendingActionProposalCount: 2,
    recentFailedToolExecutionCount: 1,
    recentReceiptCount: 3,
    openCapabilityNeedCount: 1,
    lowConfidenceAssessmentCount: 1,
    ...overrides,
  };
}

describe("workspace command center readiness", () => {
  it("marks confidence as attention when evidence is stale or missing", () => {
    expect(
      deriveReadinessCell("confidence", {
        hasFreshEvidence: false,
        hasActiveConnection: true,
        hasActor: true,
        hasCadence: true,
        hasContainment: true,
      }).state,
    ).toBe("attention");
  });

  it("marks containment as blocked when an action-capable signal lacks approval or route scope", () => {
    expect(
      deriveContainmentState({
        hasSideEffectAction: true,
        hasApprovalPath: false,
        hasRouteScope: true,
      }),
    ).toBe("blocked");
  });

  it("builds severity-sorted command strip items and a six-C matrix", () => {
    const view = buildWorkspaceCommandCenterView(makeInput());

    expect(view.commandStrip[0]?.severity).toBe("critical");
    expect(view.commandStrip.map((item) => item.id)).toContain("ai-broken-providers");
    expect(view.readiness.length).toBeGreaterThanOrEqual(5);
    expect(view.readiness.every((row) => row.cells.length === 6)).toBe(true);
    expect(view.readiness[0]?.cells.map((cell) => cell.key)).toEqual([
      "context",
      "connections",
      "capabilities",
      "cadence",
      "confidence",
      "containment",
    ]);
  });

  it("routes readiness context cells to the canonical wiki surface", () => {
    const view = buildWorkspaceCommandCenterView(makeInput());

    const contextHrefs = view.readiness
      .flatMap((row) => row.cells)
      .filter((cell) => cell.key === "context")
      .map((cell) => cell.href);

    expect(contextHrefs).not.toContain("/platform/wiki");
    expect(new Set(contextHrefs)).toEqual(new Set(["/wiki"]));
  });

  it("routes workspace KPI snapshot tiles to canonical shell destinations", () => {
    const view = buildWorkspaceCommandCenterView(makeInput());

    expect(Object.fromEntries(view.snapshot.map((item) => [item.id, item.href]))).toEqual({
      ai: "/platform/ai",
      work: "/ops",
      customers: "/customer",
      finance: "/finance",
      compliance: "/compliance",
      delivery: "/build",
    });
  });

  it("describes six-C readiness cells in operator language", () => {
    expect(
      deriveReadinessCell("context", {
        hasFreshEvidence: true,
      }).description,
    ).toBe("Evidence, docs, and operating knowledge");
  });

  it("includes AI work in motion when active task runs exist", () => {
    const view = buildWorkspaceCommandCenterView(makeInput());

    expect(view.workInMotion).toContainEqual(
      expect.objectContaining({
        id: "tr-1",
        label: "Reconcile overdue invoices",
        actor: "Finance coworker",
        status: "working",
        href: "/platform/ai/operations-map",
      }),
    );
  });

  it("renders a quiet empty state when no human or AI work is active", () => {
    const view = buildWorkspaceCommandCenterView(
      makeInput({
        activeTaskRuns: [],
        activeScheduledTaskCount: 0,
        overdueScheduledTaskCount: 0,
        pendingActionProposalCount: 0,
      }),
    );

    expect(view.workInMotion).toEqual([
      expect.objectContaining({
        id: "no-active-work",
        label: "No active AI coworker runs",
      }),
    ]);
  });
});
