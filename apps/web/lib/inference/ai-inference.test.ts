import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {
  modelProvider: { findUnique: vi.fn() },
  aiProviderConnection: { findUnique: vi.fn() },
} }));

vi.mock("@/lib/routing/local-provider-capacity", () => ({
  assertProviderDispatchCapacity: vi.fn(),
}));

const { executeAdapter, withLocalInferenceLockMock } = vi.hoisted(() => ({
  executeAdapter: vi.fn(),
  withLocalInferenceLockMock: vi.fn(),
}));
vi.mock("../routing/execution-adapter-registry", async (importOriginal) => ({
  ...await importOriginal<typeof import("../routing/execution-adapter-registry")>(),
  getExecutionAdapter: () => ({ execute: executeAdapter }),
}));
vi.mock("./inference-admission", async (importOriginal) => ({
  ...await importOriginal<typeof import("./inference-admission")>(),
  acquireInferenceSlot: vi.fn(),
}));
vi.mock("./host-gpu-admission", () => ({ assertLocalGpuFree: vi.fn() }));
vi.mock("@/lib/queue/resource-lane", () => ({
  withLocalInferenceLock: withLocalInferenceLockMock,
}));
vi.mock("../routing/adapter-telemetry-writer", () => ({ writeAdapterTelemetry: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../routing/provider-capacity/store", () => ({
  clearProviderCapacityStatus: vi.fn().mockResolvedValue(undefined),
  recordProviderCapacityStatus: vi.fn().mockResolvedValue(undefined),
}));

import { callProvider, classifyHttpError, InferenceError } from "./ai-inference";
import { assertProviderDispatchCapacity } from "@/lib/routing/local-provider-capacity";
import { prisma } from "@dpf/db";
import { acquireInferenceSlot, withInferenceCancellation } from "./inference-admission";

beforeEach(() => {
  vi.mocked(assertProviderDispatchCapacity).mockReset();
  vi.mocked(assertProviderDispatchCapacity).mockResolvedValue(undefined);
  vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status: "active" } as any);
  vi.mocked(prisma.aiProviderConnection.findUnique).mockResolvedValue({ status: "active" } as any);
  vi.mocked(acquireInferenceSlot).mockReset().mockResolvedValue(vi.fn());
  withLocalInferenceLockMock.mockReset().mockImplementation(async (fn) => fn());
  executeAdapter.mockReset().mockResolvedValue({ text: "done", toolCalls: [], inferenceMs: 1, usage: { inputTokens: 1, outputTokens: 1 } });
});

it("does not dispatch after a caller deadline races admission handoff", async () => {
  vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status: "active", baseUrl: "http://provider.test/v1", authMethod: "none" } as any);
  const controller = new AbortController();
  const release = vi.fn();
  vi.mocked(acquireInferenceSlot).mockImplementation(async () => {
    controller.abort(new DOMException("utility deadline reached", "AbortError"));
    return release;
  });
  await expect(withInferenceCancellation(controller.signal, () =>
    callProvider("openai", "test-model", [{ role: "user", content: "synthetic input" }], "")))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(executeAdapter).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it("rechecks setup removal after a cloud selection waits for admission", async () => {
  vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status: "active", baseUrl: "http://provider.test/v1", authMethod: "none" } as any);
  const release = vi.fn();
  vi.mocked(acquireInferenceSlot).mockImplementationOnce(async () => {
    vi.mocked(prisma.aiProviderConnection.findUnique).mockResolvedValue({ status: "unconfigured" } as any);
    vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status: "unconfigured" } as any);
    return release;
  });
  await expect(callProvider("openai", "model-test", [], "system")).rejects.toThrow("not enabled for routing");
  expect(executeAdapter).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it.each(["disabled", "inactive", "unconfigured"])("blocks a %s cloud provider even when its connection is active", async status => {
  vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status, baseUrl: "https://provider.example/v1", authMethod: "none" } as any);
  await expect(callProvider("openai", "model-test", [], "system")).rejects.toThrow("not enabled for routing");
  expect(executeAdapter).not.toHaveBeenCalled();
  expect(acquireInferenceSlot).not.toHaveBeenCalled();
});

it.each(["active", "degraded"])("preserves %s legacy cloud dispatch without a default account", async status => {
  vi.mocked(prisma.aiProviderConnection.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status, baseUrl: "https://provider.example/v1", authMethod: "none" } as any);
  await expect(callProvider("openai", "model-test", [], "system")).resolves.toMatchObject({ content: "done" });
  expect(executeAdapter).toHaveBeenCalledOnce();
});

it.each(["disabled", "inactive", "unconfigured"])("blocks a cloud provider that becomes %s during admission and releases its slot", async status => {
  vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status: "active", baseUrl: "https://provider.example/v1", authMethod: "none" } as any);
  const release = vi.fn();
  vi.mocked(acquireInferenceSlot).mockImplementationOnce(async () => {
    vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status } as any);
    return release;
  });
  await expect(callProvider("openai", "model-test", [], "system")).rejects.toThrow("not enabled for routing");
  expect(executeAdapter).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

describe("InferenceError", () => {
  it("has correct code and providerId", () => {
    const err = new InferenceError("test", "network", "ollama");
    expect(err.code).toBe("network");
    expect(err.providerId).toBe("ollama");
    expect(err.name).toBe("InferenceError");
  });

  it("includes statusCode when provided", () => {
    const err = new InferenceError("rate limited", "rate_limit", "openai", 429);
    expect(err.statusCode).toBe(429);
  });

  it("carries provider capacity classification when provided", () => {
    const err = new InferenceError("needs credits", "billing", "zai-coding", 429, undefined, undefined, {
      state: "billing_action_required",
      action: "add_credits_or_plan",
      safeSummary: "Z.ai needs coding credits.",
      confidence: "exact",
      isHumanActionRequired: true,
    });
    expect(err.capacity?.action).toBe("add_credits_or_plan");
  });
});

describe("callProvider host-capacity boundary", () => {
  it.each(["active", "degraded"])("dispatches an eligible %s local provider through the shared local lane", async (status) => {
    vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status, baseUrl: "http://localhost:11434/v1", authMethod: "none" } as any);
    vi.mocked(prisma.aiProviderConnection.findUnique).mockResolvedValue({ status } as any);
    await expect(callProvider("local", "qwen", [{ role: "user", content: "triage" }], "system"))
      .resolves.toMatchObject({ content: "done" });
    expect(executeAdapter).toHaveBeenCalledOnce();
    expect(withLocalInferenceLockMock).toHaveBeenCalledWith(expect.any(Function), {
      modelId: "qwen",
      origin: "interactive",
    });
    expect(acquireInferenceSlot).not.toHaveBeenCalled();
  });

  it("keeps remote providers on the per-engine inference semaphore", async () => {
    vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({
      status: "active",
      baseUrl: "https://api.example.test",
      authMethod: "none",
    } as any);
    const release = vi.fn();
    vi.mocked(acquireInferenceSlot).mockResolvedValueOnce(release);

    await expect(callProvider("openai", "gpt-test", [{ role: "user", content: "triage" }], "system"))
      .resolves.toMatchObject({ content: "done" });

    expect(withLocalInferenceLockMock).not.toHaveBeenCalled();
    expect(acquireInferenceSlot).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it.each(["provider", "connection"])("does not dispatch when the %s is disabled while waiting for the local lane", async (target) => {
    vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status: "active", baseUrl: "http://localhost:11434/v1", authMethod: "none" } as any);
    let wake!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    withLocalInferenceLockMock.mockImplementationOnce((fn) => {
      entered();
      return new Promise((resolve, reject) => {
        wake = () => { void Promise.resolve(fn()).then(resolve, reject); };
      });
    });
    const pending = callProvider("local", "qwen", [{ role: "user", content: "triage" }], "system");
    await waiting;
    if (target === "provider") vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status: "inactive" } as any);
    else vi.mocked(prisma.aiProviderConnection.findUnique).mockResolvedValue({ status: "inactive" } as any);
    wake();
    await expect(pending).rejects.toMatchObject({ code: "provider_error", message: "Local provider is not enabled for routing" });
    expect(executeAdapter).not.toHaveBeenCalled();
    expect(acquireInferenceSlot).not.toHaveBeenCalled();
  });

  it.each(["inactive", "disabled"])("rejects a stale local selection when the connection is %s before capacity wait", async (status) => {
    vi.mocked(prisma.aiProviderConnection.findUnique).mockResolvedValue({ status } as any);
    await expect(callProvider("local", "qwen", [{ role: "user", content: "triage" }], "system"))
      .rejects.toMatchObject({ code: "provider_error", message: "Local provider is not enabled for routing" });
    expect(assertProviderDispatchCapacity).not.toHaveBeenCalled();
  });
  it("rejects a cloud request paused while it waits for an inference slot", async () => {
    vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status: "active", baseUrl: "https://provider.example/v1", authMethod: "none" } as any);
    const release = vi.fn();
    let wake!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(acquireInferenceSlot).mockImplementationOnce(() => {
      entered();
      return new Promise<() => void>(resolve => { wake = () => resolve(release); });
    });
    const pending = callProvider("openai", "model-test", [], "system");
    const rejected = expect(pending).rejects.toThrow("Provider account is not enabled for routing");
    await waiting;
    vi.mocked(prisma.aiProviderConnection.findUnique).mockResolvedValue({ status: "paused" } as any);
    wake();
    await rejected;
    expect(executeAdapter).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects a disabled local provider even if its connection still appears active", async () => {
    vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ status: "inactive" } as any);
    await expect(callProvider("local", "qwen", [{ role: "user", content: "triage" }], "system"))
      .rejects.toMatchObject({ code: "provider_error" });
    expect(assertProviderDispatchCapacity).not.toHaveBeenCalled();
  });
  it("stops before provider setup when local capacity is reserved", async () => {
    const deferred = Object.assign(new Error("local capacity reserved"), {
      name: "LocalProviderCapacityDeferredError",
      reason: "local-ci-active-capacity-reservation",
    });
    vi.mocked(assertProviderDispatchCapacity).mockRejectedValueOnce(deferred);

    await expect(
      callProvider("local", "qwen3-coder", [{ role: "user", content: "triage" }], "system"),
    ).rejects.toBe(deferred);
    expect(assertProviderDispatchCapacity).toHaveBeenCalledWith("local");
  });
});

describe("classifyHttpError", () => {
  it("classifies HTTP 529 as provider overload", () => {
    const err = classifyHttpError(
      529,
      "anthropic-sub",
      "API Error: 529 Overloaded. This is a server-side issue, usually temporary.",
    );

    expect(err.code).toBe("overloaded");
    expect(err.statusCode).toBe(529);
    expect(err.message).toContain("Overloaded");
  });

  it("classifies overloaded provider text as overload even when status is generic", () => {
    const err = classifyHttpError(
      503,
      "anthropic-sub",
      "API Error: 529 Overloaded. If it persists, check status.claude.com.",
    );

    expect(err.code).toBe("overloaded");
    expect(err.statusCode).toBe(503);
  });

  it("attaches Z.ai capacity classification for insufficient coding credits", () => {
    const err = classifyHttpError(
      429,
      "zai-coding",
      JSON.stringify({
        error: {
          code: "1113",
          message: "Insufficient balance or no resource package. Please recharge.",
        },
      }),
    );

    expect(err.code).toBe("billing");
    expect(err.capacity).toMatchObject({
      state: "billing_action_required",
      action: "add_credits_or_plan",
      providerCode: "1113",
      isHumanActionRequired: true,
    });
  });
});

// Full callProvider execution requires DB + HTTP mocking and is covered through
// ai-provider-priority integration tests. The host-capacity boundary is tested
// here because it intentionally runs before provider setup.
// Format construction correctness is verified by the existing profiling tests
// (same provider-specific branching logic was extracted from callProviderForProfiling).
