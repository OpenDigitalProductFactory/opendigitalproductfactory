import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  findUnique: vi.fn(),
  updateEpic: vi.fn(),
  completeTerminal: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: { epic: { findUnique: mocks.findUnique, update: mocks.updateEpic } },
}));
vi.mock("@/lib/api/auth-middleware", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/backlog/initiative-readiness/epic-terminal-transition", () => ({
  completeEpicTransition: mocks.completeTerminal,
}));

import { PATCH } from "./route";

describe("PATCH /api/v1/ops/epics/:id terminal readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findUnique.mockResolvedValue({ id: "epic-row", epicId: "EP-123", status: "open", originatingBacklogItem: { organizationId: "org-1" } });
    mocks.completeTerminal.mockResolvedValue({
      ok: false,
      code: "INITIATIVE_NOT_READY",
      authorityDecisionId: "auth-1",
      decision: {
        decisionId: "IRD-2",
        blockers: [{ code: "DEPENDENCY_UNRESOLVED" }],
        unmet: [],
      },
    });
  });

  it("returns a stable conflict and never directly writes done when readiness denies completion", async () => {
    const response = await PATCH(new Request("http://localhost/api/v1/ops/epics/epic-row", {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
      headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ id: "epic-row" }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "INITIATIVE_NOT_READY",
      decisionId: "IRD-2",
      blockers: ["DEPENDENCY_UNRESOLVED"],
    });
    expect(mocks.completeTerminal).toHaveBeenCalledWith(expect.objectContaining({
      epicId: "EP-123",
      expectedStatus: "open",
      actor: expect.objectContaining({ actorRef: "user-1" }),
    }));
    expect(mocks.updateEpic).not.toHaveBeenCalled();
  });
});
