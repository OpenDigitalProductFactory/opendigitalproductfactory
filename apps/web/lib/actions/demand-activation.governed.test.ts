// GPP Phase 2 PR-H (BI-69415B68): the /ops/demand actions run through the REAL
// reference monitor. What the monitor adds (audit rows, the irreversible
// supersede's receipt) is asserted here; the unchanged outcome is pinned in
// demand-activation.characterization.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  executeTool: vi.fn(),
  revalidatePath: vi.fn(),
  prisma: {
    toolExecution: { create: vi.fn(), update: vi.fn() },
    toolExecutionReceipt: { create: vi.fn(), update: vi.fn() },
    principalAlias: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/mcp-tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp-tools")>()),
  executeTool: mocks.executeTool,
}));

import { _setGovernanceForTests } from "@/lib/mcp-governed-execute";
import { supersedeEvidenceFromDemand, transitionDemand } from "./demand-activation";

beforeEach(() => {
  vi.clearAllMocks();
  _setGovernanceForTests({});
  mocks.auth.mockResolvedValue({ user: { id: "user-pm", platformRole: "HR-500", isSuperuser: false } });
  mocks.executeTool.mockResolvedValue({ success: true, message: "Done." });
  mocks.prisma.toolExecution.create.mockResolvedValue({ id: "TE-1" });
  mocks.prisma.toolExecution.update.mockResolvedValue({});
  mocks.prisma.toolExecutionReceipt.create.mockResolvedValue({ id: "TER-1" });
  mocks.prisma.toolExecutionReceipt.update.mockResolvedValue({});
  mocks.prisma.principalAlias.findFirst.mockResolvedValue({ principal: { principalId: "PRN-PM", aliases: [] } });
});
afterEach(() => _setGovernanceForTests({}));

describe("demand activation through the reference monitor", () => {
  it("an ordinary demand write is audited as a direct human call from /ops/demand", async () => {
    await expect(transitionDemand({ itemId: "BI-1", to: "screened" })).resolves.toEqual({ ok: true, message: "Done." });

    expect(mocks.executeTool).toHaveBeenCalledWith(
      "transition_demand_item",
      { itemId: "BI-1", to: "screened" },
      "user-pm",
      expect.objectContaining({
        routeContext: "/ops/demand",
        governedSource: "rest",
        userContext: { platformRole: "HR-500", isSuperuser: false },
      }),
    );
    expect(mocks.prisma.toolExecution.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.toolExecution.create.mock.calls[0]![0].data).toMatchObject({
      toolName: "transition_demand_item",
      userId: "user-pm",
      agentId: "unknown",
      executionMode: "rest",
      routeContext: "/ops/demand",
      success: true,
    });
    expect(mocks.prisma.toolExecutionReceipt.create).not.toHaveBeenCalled();
  });

  it("an audit write failure on an ordinary write never changes the outcome", async () => {
    mocks.prisma.toolExecution.create.mockRejectedValue(new Error("audit table unavailable"));
    await expect(transitionDemand({ itemId: "BI-1", to: "screened" })).resolves.toEqual({ ok: true, message: "Done." });
    expect(mocks.executeTool).toHaveBeenCalledTimes(1);
  });

  it("the irreversible supersede reserves an audit row and a receipt before it runs, then finalises both", async () => {
    await expect(supersedeEvidenceFromDemand({ evidenceLinkId: "DEL-1", rationale: "duplicate" })).resolves.toEqual({
      ok: true,
      message: "Done.",
    });

    expect(mocks.prisma.toolExecution.create.mock.calls[0]![0].data).toMatchObject({
      toolName: "supersede_demand_evidence",
      success: false,
      result: expect.objectContaining({ error: "execution_reserved" }),
    });
    expect(mocks.prisma.toolExecutionReceipt.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.toolExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "TE-1" }, data: expect.objectContaining({ success: true }) }),
    );
    expect(mocks.prisma.toolExecutionReceipt.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "TER-1" }, data: expect.objectContaining({ executionStatus: "succeeded" }) }),
    );
  });

  // The one refusal the monitor can make on this site, recorded as the residual
  // risk in the PR-H notes: the supersede's receipt needs the human's Principal.
  // Sign-in materialises that Principal (authorizePrincipalForSession), so a
  // session that reached this action has one; this pins the fail-closed shape.
  it("the supersede fails closed, before running, only when its receipt cannot be reserved", async () => {
    mocks.prisma.principalAlias.findFirst.mockResolvedValue(null);

    const result = await supersedeEvidenceFromDemand({ evidenceLinkId: "DEL-1", rationale: "duplicate" });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringMatching(/receipt/i) });
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
