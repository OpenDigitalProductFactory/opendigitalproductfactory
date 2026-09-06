import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    asyncInferenceOp: {
      create: mocks.create,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    modelProvider: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/agent-event-bus", () => ({ agentEventBus: { emit: mocks.emit } }));
vi.mock("@/lib/ai-provider-internals", () => ({
  getDecryptedCredential: vi.fn(),
  getProviderExtraHeaders: vi.fn(() => ({})),
  getProviderBearerToken: vi.fn(),
}));

import {
  cancelAsyncOperation,
  createAsyncOperation,
  getAsyncOperationInfo,
  getAsyncOperationResult,
  pollAsyncOperation,
} from "./async-inference";

const now = new Date("2026-09-04T12:00:00.000Z");

describe("legacy async inference compatibility boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: "legacy-op-1" });
  });

  it("marks the pre-existing provider-handle writer as legacy instead of forging durable authority", async () => {
    await createAsyncOperation({
      providerId: "gemini",
      modelId: "deep-research",
      operationId: "provider-op-1",
      contractFamily: "research",
      requestContext: { prompt: "screened" },
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identityVersion: 0,
        providerId: "gemini",
        operationId: "provider-op-1",
        status: "running",
      }),
    });
  });

  it.each([
    ["poll", () => pollAsyncOperation("durable-op-1")],
    ["info", () => getAsyncOperationInfo("durable-op-1")],
    ["result", () => getAsyncOperationResult("durable-op-1")],
    ["cancel", () => cancelAsyncOperation("durable-op-1")],
  ])("does not let the bare-id legacy %s surface access a durable operation", async (_name, call) => {
    mocks.findUnique.mockResolvedValue({
      id: "durable-op-1",
      identityVersion: 1,
      status: "running",
      expiresAt: new Date(now.getTime() + 60_000),
    });

    await expect(call()).rejects.toThrow("ASYNC_OPERATION_AUTHORIZED_SCOPE_REQUIRED");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not coerce an unknown legacy status into cancelled", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "legacy-op-1",
      identityVersion: 0,
      status: "provider_maybe_started",
      expiresAt: new Date(now.getTime() + 60_000),
    });

    await expect(cancelAsyncOperation("legacy-op-1"))
      .rejects.toThrow("Invalid async inference operation status");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
