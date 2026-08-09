import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/routing/local-provider-capacity", () => ({
  assertProviderDispatchCapacity: vi.fn(),
}));

import { callProvider, classifyHttpError, InferenceError } from "./ai-inference";
import { assertProviderDispatchCapacity } from "@/lib/routing/local-provider-capacity";

beforeEach(() => {
  vi.mocked(assertProviderDispatchCapacity).mockReset();
  vi.mocked(assertProviderDispatchCapacity).mockResolvedValue(undefined);
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
