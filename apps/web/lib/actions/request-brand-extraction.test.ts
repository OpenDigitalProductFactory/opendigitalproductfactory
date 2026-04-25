import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  threadUpsert: vi.fn(),
  messageCreate: vi.fn(),
  executeTool: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    agentThread: {
      upsert: mocks.threadUpsert,
    },
    agentMessage: {
      create: mocks.messageCreate,
    },
  },
}));

vi.mock("@/lib/mcp-tools", () => ({
  executeTool: mocks.executeTool,
}));

import { requestBrandExtraction } from "./request-brand-extraction";

describe("requestBrandExtraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { id: "user-1" },
    });
    mocks.threadUpsert.mockResolvedValue({ id: "thread-1" });
    mocks.messageCreate.mockResolvedValue({});
  });

  it("returns the queued task payload when the tool call succeeds", async () => {
    mocks.executeTool.mockResolvedValue({
      success: true,
      data: { taskRunId: "TR-BRAND-12345678", status: "queued" },
    });

    await expect(
      requestBrandExtraction({
        url: "https://example.com",
        includeCodebase: true,
      }),
    ).resolves.toEqual({
      success: true,
      taskRunId: "TR-BRAND-12345678",
      status: "queued",
      threadId: "thread-1",
    });
  });

  it("surfaces thrown executeTool errors as structured failures", async () => {
    mocks.executeTool.mockRejectedValue(new Error("Organization lookup failed"));

    await expect(
      requestBrandExtraction({
        url: "https://example.com",
        includeCodebase: true,
      }),
    ).resolves.toEqual({
      success: false,
      error: "Organization lookup failed",
    });
  });
});
