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

import { pollAsyncOperation, pollAsyncProviderOperation } from "./async-inference";

const runningOperation = {
  id: "async-op-1",
  identityVersion: 0,
  providerId: "gemini",
  modelId: "deep-research-pro-preview-12-2025",
  operationId: "interaction/id with spaces",
  status: "running",
  // clock-bomb-guard: allow far-future sentinel keeps the polling fixture unexpired
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
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "Api-Revision": "2026-05-20",
        }),
      }),
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
    const fetchMock = vi.fn().mockResolvedValue(response({
      id: "interaction/id with spaces",
      object: "interaction",
      status: "failed",
      errors: [{ code: "provider-failure", message: "Bearer secret-token customer prompt" }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const providerResult = await pollAsyncProviderOperation(
      "gemini",
      "interaction/id with spaces",
    );
    expect(providerResult).toMatchObject({
      done: true,
      terminalStatus: "failed",
      errorMessage: "Gemini interaction failed",
    });
    expect(providerResult).not.toHaveProperty("raw");

    await expect(pollAsyncOperation("async-op-1")).resolves.toBe("failed");
    expect(mocks.updateOperation).toHaveBeenCalledWith({
      where: { id: "async-op-1" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "Gemini interaction failed",
      }),
    });
    expect(JSON.stringify(mocks.updateOperation.mock.calls.at(-1)?.[0]))
      .not.toContain("secret-token");
  });

  it("does not retain a provider error body in a poll failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Bearer secret-token customer prompt text",
      headers: new Headers(),
    } as Response));

    const result = await pollAsyncOperation("async-op-1");

    expect(result).toBe("failed");
    const durableWrite = mocks.updateOperation.mock.calls.at(-1)?.[0];
    expect(durableWrite).toMatchObject({
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "Provider poll failed with HTTP 503",
      }),
    });
    expect(JSON.stringify(durableWrite)).not.toContain("secret-token");
    expect(JSON.stringify(durableWrite)).not.toContain("customer prompt text");
  });

  it("maps an unknown Gemini state to a terminal typed failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "interaction/id with spaces",
      object: "interaction",
      status: "new_provider_state",
    })));

    await expect(pollAsyncProviderOperation(
      "gemini",
      "interaction/id with spaces",
    )).resolves.toMatchObject({
      done: true,
      terminalStatus: "failed",
      errorMessage: "Gemini interaction returned an unsupported status",
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

  it("fails an incomplete interaction without persisting its partial provider payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "interaction/id with spaces",
      object: "interaction",
      status: "incomplete",
      steps: [
        { type: "model_output", content: [{ type: "text", text: "Partial research" }] },
      ],
      usage: { total_input_tokens: 17, total_output_tokens: 4 },
    })));

    await expect(pollAsyncOperation("async-op-1")).resolves.toBe("failed");
    expect(mocks.updateOperation).toHaveBeenCalledWith({
      where: { id: "async-op-1" },
      data: expect.objectContaining({
        status: "failed",
        progressPct: 100,
        progressMessage: "Failed",
        errorMessage: "Gemini interaction was incomplete",
      }),
    });
    const durableWrite = mocks.updateOperation.mock.calls.at(-1)?.[0]?.data;
    expect(durableWrite).not.toHaveProperty("resultText");
    expect(durableWrite).not.toHaveProperty("resultData");
  });
});

describe("pollAsyncProviderOperation generic terminal states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProvider.mockResolvedValue({
      baseUrl: "https://provider.example/v1",
      authMethod: "none",
      authHeader: null,
    });
  });

  it("maps an explicit provider failure to a closed failed result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "provider-op-1",
      status: "failed",
      error: { message: "Bearer secret-token customer prompt" },
    })));

    await expect(pollAsyncProviderOperation("other", "provider-op-1")).resolves.toEqual({
      done: true,
      terminalStatus: "failed",
      errorMessage: "Provider operation failed",
      progressMessage: "Failed",
    });
  });

  it("maps cancellation terminally instead of polling forever", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      operation_id: "provider-op-1",
      status: "cancelled",
      message: "Bearer secret-token customer prompt",
    })));

    await expect(pollAsyncProviderOperation("other", "provider-op-1")).resolves.toEqual({
      done: true,
      terminalStatus: "cancelled",
      progressMessage: "Cancelled",
    });
  });

  it("rejects a mismatched or unknown provider operation state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "different-op",
      status: "running",
    })));
    await expect(pollAsyncProviderOperation("other", "provider-op-1"))
      .rejects.toThrow("identity mismatch");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "provider-op-1",
      status: "mystery",
    })));
    await expect(pollAsyncProviderOperation("other", "provider-op-1"))
      .rejects.toThrow("unsupported status");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "provider-op-1",
      status: "mystery",
      done: true,
      result: { text: "must not be accepted" },
    })));
    await expect(pollAsyncProviderOperation("other", "provider-op-1"))
      .rejects.toThrow("unsupported status");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "provider-op-1",
      status: "mystery",
      done: false,
    })));
    await expect(pollAsyncProviderOperation("other", "provider-op-1"))
      .rejects.toThrow("unsupported status");
  });
});
