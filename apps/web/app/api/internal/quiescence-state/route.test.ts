import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getQuiescenceConfig: vi.fn(),
  getDeployedSha: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ getQuiescenceConfig: mocks.getQuiescenceConfig }));
vi.mock("@/lib/self-upgrade/completion", () => ({ getDeployedSha: mocks.getDeployedSha }));
vi.mock("@dpf/db", () => ({ prisma: { quiescenceRun: { findUnique: mocks.findUnique } } }));

import { GET } from "./route";

const base = "https://example.invalid/api/internal/quiescence-state";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getQuiescenceConfig.mockResolvedValue({ runId: "QR-test", level: "draining", enteredAt: new Date().toISOString() });
});

describe("quiescence deadline display", () => {
  it("keeps the proxy's sessionless base read and does not look up the deadline", async () => {
    const result = await GET(new Request(base));
    expect(result.status).toBe(200);
    expect(await result.json()).not.toHaveProperty("readyToSwapDeadlineAt");
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a sessionless deadline request before reading either state store", async () => {
    mocks.auth.mockResolvedValue(null);
    const result = await GET(new Request(base + "?display=1"));
    expect(result.status).toBe(401);
    expect(mocks.getQuiescenceConfig).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("returns the exact recorded timestamp to the signed-in banner", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "operator" } });
    const deadline = new Date(Date.now() + 60_000);
    mocks.findUnique.mockResolvedValue({ readyToSwapDeadlineAt: deadline, swapStartedAt: new Date() });
    const result = await GET(new Request(base + "?display=1"));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ runId: "QR-test", readyToSwapDeadlineAt: deadline.toISOString(), swapStarted: true });
  });
});
