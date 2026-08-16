import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  findUnique: vi.fn(),
  deleteItem: vi.fn(),
  assertDeletable: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: { findUnique: mocks.findUnique, delete: mocks.deleteItem },
  },
}));
vi.mock("@/lib/api/auth-middleware", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/backlog/initiative-governance-deletion", () => ({
  assertBacklogItemGovernanceDeletable: mocks.assertDeletable,
}));

import { DELETE } from "./route";
import { apiError } from "@/lib/api/error";

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
