// GPP Phase 2 PR-H characterization (BI-69415B68): what the /ops/demand server
// actions do, pinned at the executeTool boundary. Written against the direct
// executeTool call BEFORE the site moved behind the reference monitor, and
// required to pass unchanged after: same tool, arguments, acting user and
// handler-visible route/agent context, same returned value, same revalidation.
// Audit rows the monitor adds are asserted separately in
// demand-activation.governed.test.ts, never here.
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  linkEvidenceToDemand,
  requestDemandFunding,
  supersedeEvidenceFromDemand,
  transitionDemand,
} from "./demand-activation";

const backlogManager = { id: "user-pm", platformRole: "HR-500", isSuperuser: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: backlogManager });
  mocks.executeTool.mockResolvedValue({ success: true, message: "Moved to screened." });
  mocks.prisma.toolExecution.create.mockResolvedValue({ id: "TE-1" });
  mocks.prisma.toolExecution.update.mockResolvedValue({});
  mocks.prisma.toolExecutionReceipt.create.mockResolvedValue({ id: "TER-1" });
  mocks.prisma.toolExecutionReceipt.update.mockResolvedValue({});
  mocks.prisma.principalAlias.findFirst.mockResolvedValue({
    principal: { principalId: "PRN-PM", aliases: [] },
  });
});

function onlyCall() {
  expect(mocks.executeTool).toHaveBeenCalledTimes(1);
  const [toolName, params, userId, context] = mocks.executeTool.mock.calls[0]!;
  return { toolName, params, userId, context: (context ?? {}) as Record<string, unknown> };
}

const cases = [
  {
    label: "transitionDemand",
    run: () => transitionDemand({ itemId: "BI-1", to: "screened", rationale: "evidence linked" }),
    toolName: "transition_demand_item",
    params: { itemId: "BI-1", to: "screened", rationale: "evidence linked" },
  },
  {
    label: "linkEvidenceToDemand",
    run: () => linkEvidenceToDemand({
      itemId: "BI-1", sourceKind: "research", sourceRef: "wiki:demand-1", title: "Interview", confidence: 0.7,
    }),
    toolName: "link_demand_evidence",
    params: { itemId: "BI-1", sourceKind: "research", sourceRef: "wiki:demand-1", title: "Interview", confidence: 0.7 },
  },
  {
    label: "supersedeEvidenceFromDemand (irreversible)",
    run: () => supersedeEvidenceFromDemand({ evidenceLinkId: "DEL-1", rationale: "duplicate" }),
    toolName: "supersede_demand_evidence",
    params: { evidenceLinkId: "DEL-1", rationale: "duplicate" },
  },
  {
    label: "requestDemandFunding",
    run: () => requestDemandFunding({ itemId: "BI-1", rationale: "scored" }),
    toolName: "approve_demand_for_funding",
    params: { itemId: "BI-1", rationale: "scored" },
  },
] as const;

describe("demand activation actions — characterization", () => {
  for (const c of cases) {
    it(`${c.label}: runs ${c.toolName} as the session user from /ops/demand and returns the tool message`, async () => {
      const result = await c.run();

      expect(result).toEqual({ ok: true, message: "Moved to screened." });
      const call = onlyCall();
      expect(call.toolName).toBe(c.toolName);
      expect(call.params).toEqual(c.params);
      expect(call.userId).toBe("user-pm");
      expect(call.context.routeContext).toBe("/ops/demand");
      expect(call.context.agentId).toBeUndefined();
      expect(call.context.threadId).toBeUndefined();
      expect(mocks.revalidatePath.mock.calls).toEqual([["/ops/demand"], ["/portfolio"]]);
    });

    it(`${c.label}: a tool failure is returned as ok:false with the tool message and revalidates nothing`, async () => {
      mocks.executeTool.mockResolvedValue({ success: false, error: "invalid_transition", message: "Evidence is required first." });

      const result = await c.run();

      expect(result).toEqual({ ok: false, error: "Evidence is required first." });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    });
  }

  it("a tool failure with no message falls back to the generic sentence", async () => {
    mocks.executeTool.mockResolvedValue({ success: false, error: "x" });
    await expect(transitionDemand({ itemId: "BI-1", to: "raw" })).resolves.toEqual({
      ok: false,
      error: "The demand update could not be completed.",
    });
  });

  it("a success with no message falls back to 'Demand updated.'", async () => {
    mocks.executeTool.mockResolvedValue({ success: true });
    await expect(transitionDemand({ itemId: "BI-1", to: "raw" })).resolves.toEqual({ ok: true, message: "Demand updated." });
  });

  it("refuses a session without manage_backlog before any tool runs", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-viewer", platformRole: "HR-600", isSuperuser: false } });
    await expect(transitionDemand({ itemId: "BI-1", to: "raw" })).rejects.toThrow("Unauthorized");
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("refuses an anonymous call before any tool runs", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(requestDemandFunding({ itemId: "BI-1" })).rejects.toThrow("Unauthorized");
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });
});
