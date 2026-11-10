import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-97EE6DE9: the coworker panel's Stop also stops the work its turn delegated.

const { auth, prisma, stopThreadTurn } = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: { agentThread: { findUnique: vi.fn() } },
  stopThreadTurn: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@dpf/db", () => ({ prisma }));
vi.mock("@/lib/tak/thread-cancellation", () => ({ stopThreadTurn }));

import { POST } from "./route";

const request = (body: unknown) => new Request("http://localhost/api/agent/cancel", { method: "POST", body: JSON.stringify(body) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: "user-1" } });
  prisma.agentThread.findUnique.mockResolvedValue({ userId: "user-1" });
  stopThreadTurn.mockResolvedValue({ ok: true, cancelledThreadIds: ["child-1"] });
});

describe("POST /api/agent/cancel", () => {
  it("stops the owner's turn and the children it delegated", async () => {
    const response = await POST(request({ threadId: "parent-1" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, cancelledThreadIds: ["child-1"] });
    expect(stopThreadTurn).toHaveBeenCalledWith("parent-1", "user-1");
  });

  it("refuses another user's thread without touching it", async () => {
    prisma.agentThread.findUnique.mockResolvedValue({ userId: "user-2" });
    expect((await POST(request({ threadId: "parent-1" }))).status).toBe(403);
    expect(stopThreadTurn).not.toHaveBeenCalled();
  });
});
