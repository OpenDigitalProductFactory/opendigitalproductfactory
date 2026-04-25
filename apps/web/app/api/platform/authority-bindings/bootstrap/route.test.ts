import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockCan, mockBootstrapAuthorityBindings } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCan: vi.fn(),
  mockBootstrapAuthorityBindings: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/permissions", () => ({
  can: mockCan,
}));

vi.mock("@/lib/authority/bootstrap-bindings", () => ({
  bootstrapAuthorityBindings: mockBootstrapAuthorityBindings,
}));

import { POST } from "./route";

beforeEach(() => {
  mockAuth.mockReset();
  mockCan.mockReset();
  mockBootstrapAuthorityBindings.mockReset();

  mockAuth.mockResolvedValue({
    user: {
      id: "user-1",
      platformRole: "HR-000",
      isSuperuser: true,
    },
  });
  mockCan.mockReturnValue(true);
  mockBootstrapAuthorityBindings.mockResolvedValue({
    created: 2,
    skippedExisting: 1,
    wouldCreate: 0,
    candidates: [],
    lowConfidence: [],
  });
});

describe("POST /api/platform/authority-bindings/bootstrap", () => {
  it("runs binding inference in commit mode for authorized editors", async () => {
    const response = await POST(
      new Request("http://test/api/platform/authority-bindings/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writeMode: "commit" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockBootstrapAuthorityBindings).toHaveBeenCalledWith({ writeMode: "commit" });
    await expect(response.json()).resolves.toMatchObject({
      report: expect.objectContaining({
        created: 2,
        skippedExisting: 1,
      }),
    });
  });

  it("rejects unauthorized callers", async () => {
    mockCan.mockReturnValue(false);

    const response = await POST(
      new Request("http://test/api/platform/authority-bindings/bootstrap", { method: "POST" }),
    );

    expect(response.status).toBe(403);
    expect(mockBootstrapAuthorityBindings).not.toHaveBeenCalled();
  });
});
