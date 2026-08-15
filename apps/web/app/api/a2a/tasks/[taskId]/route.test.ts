import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const { mockAuth, mockReadCoworkerA2aTask } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockReadCoworkerA2aTask: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/coworker-service-catalog/a2a-tasks", () => ({
  readCoworkerA2aTask: mockReadCoworkerA2aTask,
}));

describe("A2A coworker task route", () => {
  it("rejects an unauthenticated task read before revealing whether it exists", async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET(new Request("http://test/api/a2a/tasks/CE-A2A"), {
      params: Promise.resolve({ taskId: "CE-A2A" }),
    });

    expect(response.status).toBe(401);
    expect(mockReadCoworkerA2aTask).not.toHaveBeenCalled();
  });

  it("returns a task lifecycle projection", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockReadCoworkerA2aTask.mockResolvedValue({
      id: "CE-A2A",
      contextId: "ctx-1",
      status: { state: "working", timestamp: "2026-06-30T00:01:00.000Z" },
      providerAgentId: "sales-coworker",
      offerId: "offer-sales",
      serviceId: "svc-sales",
      messages: [],
      artifacts: [],
      metadata: { actingAgentGaid: "gaid:public:buyer", delegatingAgentGaid: "gaid:public:buyer", delegatedAgentId: "sales-coworker", approvalContext: {} },
    });

    const response = await GET(new Request("http://test/api/a2a/tasks/CE-A2A"), {
      params: Promise.resolve({ taskId: "CE-A2A" }),
    });

    expect(response.status).toBe(200);
    expect(mockReadCoworkerA2aTask).toHaveBeenCalledWith("CE-A2A");
    await expect(response.json()).resolves.toMatchObject({
      id: "CE-A2A",
      status: { state: "working" },
    });
  });

  it("returns 404 for missing tasks", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockReadCoworkerA2aTask.mockResolvedValue(null);

    const response = await GET(new Request("http://test/api/a2a/tasks/missing"), {
      params: Promise.resolve({ taskId: "missing" }),
    });

    expect(response.status).toBe(404);
  });
});
