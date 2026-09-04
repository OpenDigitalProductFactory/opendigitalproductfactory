import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOperation: vi.fn(),
  updateOperation: vi.fn(),
  findProvider: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    asyncInferenceOp: {
      findUnique: mocks.findOperation,
      update: mocks.updateOperation,
    },
    modelProvider: {
      findUnique: mocks.findProvider,
    },
  },
}));

vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: mocks.emit },
}));

vi.mock("@/lib/ai-provider-internals", () => ({
  getDecryptedCredential: vi.fn(),
  getProviderExtraHeaders: vi.fn(() => ({})),
  getProviderBearerToken: vi.fn(),
}));

import { pollAsyncOperation } from "./async-inference";

const runningOperation = {
  id: "async-op-1",
  providerId: "gemini",
  modelId: "deep-research-pro-preview-12-2025",
  operationId: "interaction/id with spaces",
  status: "running",
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  threadId: null,
};

function response(body: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    headers: new Headers(),
  } as Response;
}

describe("pollAsyncOperation Gemini Interactions API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOperation.mockResolvedValue(runningOperation);
    mocks.findProvider.mockResolvedValue({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      authMethod: "none",
      authHeader: null,
    });
    mocks.updateOperation.mockResolvedValue({});
  });

  it("polls the opaque interaction ID and preserves an in-progress operation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      id: "interaction/id with spaces",
      object: "interaction",
      status: "in_progress",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(pollAsyncOperation("async-op-1")).resolves.toBe("running");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/interactions/interaction%2Fid%20with%20spaces",
      expect.objectContaining({ method: "GET" }),
    );
    expect(mocks.updateOperation).toHaveBeenCalledWith({
      where: { id: "async-op-1" },
      data: {
        progressPct: undefined,
        progressMessage: "in_progress",
      },
    });
  });

  it("stores completed interaction text and normalized token usage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "interaction/id with spaces",
      object: "interaction",
      status: "completed",
      steps: [
        { type: "model_output", content: [{ type: "text", text: "First" }] },
        { type: "tool_result", content: [{ type: "text", text: "ignored" }] },
        { type: "model_output", content: [{ type: "text", text: " second" }] },
      ],
      usage: { total_input_tokens: 31, total_output_tokens: 12 },
    })));

    await expect(pollAsyncOperation("async-op-1")).resolves.toBe("completed");
    expect(mocks.updateOperation).toHaveBeenCalledWith({
      where: { id: "async-op-1" },
      data: expect.objectContaining({
        status: "completed",
        progressPct: 100,
        progressMessage: "Complete",
        resultText: " second",
        resultData: expect.objectContaining({
          usage: { inputTokens: 31, outputTokens: 12 },
        }),
      }),
    });
  });

  it("fails closed when the provider returns a different interaction identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "different-interaction",
      object: "interaction",
      status: "completed",
      steps: [],
    })));

    await expect(pollAsyncOperation("async-op-1")).resolves.toBe("failed");
    expect(mocks.updateOperation).toHaveBeenCalledWith({
      where: { id: "async-op-1" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: expect.stringContaining("identity mismatch"),
      }),
    });
  });

  it("fails closed on a terminal provider failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "interaction/id with spaces",
      object: "interaction",
      status: "failed",
      errors: [{ code: "provider-failure", message: "Research could not complete" }],
    })));

    await expect(pollAsyncOperation("async-op-1")).resolves.toBe("failed");
    expect(mocks.updateOperation).toHaveBeenCalledWith({
      where: { id: "async-op-1" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: expect.stringContaining("Research could not complete"),
      }),
    });
  });

  it("fails closed on requires_action when no continuation path exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "interaction/id with spaces",
      object: "interaction",
      status: "requires_action",
    })));

    await expect(pollAsyncOperation("async-op-1")).resolves.toBe("failed");
    expect(mocks.updateOperation).toHaveBeenCalledWith({
      where: { id: "async-op-1" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: expect.stringMatching(/requires_action.*continuation/i),
      }),
    });
  });

  it("preserves a queued interaction as nonterminal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "interaction/id with spaces",
      object: "interaction",
      status: "queued",
    })));

    await expect(pollAsyncOperation("async-op-1")).resolves.toBe("running");
    expect(mocks.updateOperation).toHaveBeenCalledWith({
      where: { id: "async-op-1" },
      data: {
        progressPct: undefined,
        progressMessage: "queued",
      },
    });
  });

  it("persists a provider cancellation as cancelled rather than failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "interaction/id with spaces",
      object: "interaction",
      status: "cancelled",
    })));

    await expect(pollAsyncOperation("async-op-1")).resolves.toBe("cancelled");
    expect(mocks.updateOperation).toHaveBeenCalledWith({
      where: { id: "async-op-1" },
      data: expect.objectContaining({
        status: "cancelled",
        progressPct: 100,
        progressMessage: "Cancelled",
      }),
    });
  });

  it("preserves an incomplete interaction's partial result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "interaction/id with spaces",
      object: "interaction",
      status: "incomplete",
      steps: [
        { type: "model_output", content: [{ type: "text", text: "Partial research" }] },
      ],
      usage: { total_input_tokens: 17, total_output_tokens: 4 },
    })));

    await expect(pollAsyncOperation("async-op-1")).resolves.toBe("completed");
    expect(mocks.updateOperation).toHaveBeenCalledWith({
      where: { id: "async-op-1" },
      data: expect.objectContaining({
        status: "completed",
        progressPct: 100,
        progressMessage: "Incomplete",
        resultText: "Partial research",
        resultData: expect.objectContaining({ status: "incomplete" }),
      }),
    });
  });
});
