import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  findUnique: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  assertDeletable: vi.fn(),
  completeTerminal: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: { findUnique: mocks.findUnique, update: mocks.updateItem, delete: mocks.deleteItem },
  },
}));
vi.mock("@/lib/api/auth-middleware", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/backlog/initiative-governance-deletion", () => ({
  assertBacklogItemGovernanceDeletable: mocks.assertDeletable,
}));
vi.mock("@/lib/backlog/initiative-readiness/backlog-terminal-transition", () => ({
  completeBacklogItemTransition: mocks.completeTerminal,
}));

import { DELETE, PATCH } from "./route";
import { apiError } from "@/lib/api/error";

describe("PATCH /api/v1/ops/backlog/:id terminal readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findUnique.mockResolvedValue({ id: "bi-row", itemId: "BI-123", status: "open", organizationId: "org-1" });
    mocks.completeTerminal.mockResolvedValue({
      ok: false,
      code: "INITIATIVE_NOT_READY",
      authorityDecisionId: "auth-1",
      decision: {
        decisionId: "IRD-1",
        blockers: [],
        unmet: [{ code: "OBJECTIVE_RECONCILIATION_REQUIRED" }],
      },
    });
  });

  it("returns a stable conflict and never directly writes done when readiness denies completion", async () => {
    const response = await PATCH(new Request("http://localhost/api/v1/ops/backlog/bi-row", {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
      headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ id: "bi-row" }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "INITIATIVE_NOT_READY",
      decisionId: "IRD-1",
      unmet: ["OBJECTIVE_RECONCILIATION_REQUIRED"],
    });
    expect(mocks.completeTerminal).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "BI-123",
      expectedStatus: "open",
      actor: expect.objectContaining({ actorRef: "user-1" }),
    }));
    expect(mocks.updateItem).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/ops/backlog/:id initiative retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findUnique.mockResolvedValue({ id: "bi-row" });
    mocks.deleteItem.mockResolvedValue({ id: "bi-row" });
  });

  it("stops before backlog access when authentication fails", async () => {
    mocks.authenticateRequest.mockRejectedValueOnce(apiError("UNAUTHORIZED", "Unauthorized", 401));

    const response = await DELETE(new Request("http://localhost/api/v1/ops/backlog/bi-row", { method: "DELETE" }), {
      params: Promise.resolve({ id: "bi-row" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.assertDeletable).not.toHaveBeenCalled();
    expect(mocks.deleteItem).not.toHaveBeenCalled();
  });

  it("authenticates before returning a stable conflict for permanent governance evidence", async () => {
    mocks.assertDeletable.mockRejectedValue(Object.assign(new Error("retained"), { code: "INITIATIVE_GOVERNANCE_RETENTION" }));
    const response = await DELETE(new Request("http://localhost/api/v1/ops/backlog/bi-row", { method: "DELETE" }), {
      params: Promise.resolve({ id: "bi-row" }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "INITIATIVE_GOVERNANCE_RETENTION" });
    expect(mocks.authenticateRequest.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertDeletable.mock.invocationCallOrder[0],
    );
    expect(mocks.deleteItem).not.toHaveBeenCalled();
  });

  it("preserves ordinary deletion when no governance evidence exists", async () => {
    mocks.assertDeletable.mockResolvedValue(undefined);
    const response = await DELETE(new Request("http://localhost/api/v1/ops/backlog/bi-row", { method: "DELETE" }), {
      params: Promise.resolve({ id: "bi-row" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.deleteItem).toHaveBeenCalledWith({ where: { id: "bi-row" } });
  });
});
