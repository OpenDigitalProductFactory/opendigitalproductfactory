import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(), callProvider: vi.fn(), provider: vi.fn(), update: vi.fn(),
  poolLimit: vi.fn(), poolClear: vi.fn(),
}));
vi.mock("@/lib/ai-inference", () => {
  class InferenceError extends Error {
    constructor(message: string, public code: string, public providerId: string) { super(message); }
  }
  return { InferenceError, callProvider: mocks.callProvider };
});
vi.mock("@dpf/db", () => ({ prisma: {
  modelProvider: { findUnique: mocks.provider, update: mocks.update },
  modelProfile: { updateMany: mocks.update },
} }));
vi.mock("@/lib/inference/ai-provider-internals", () => ({
  getProviderBearerToken: vi.fn(async () => ({ token: "test-only" })),
  getDecryptedCredential: vi.fn(),
}));
vi.mock("@/lib/shared/lazy-node", () => ({
  lazyUtil: () => ({ promisify }),
  lazyChildProcess: () => ({
    spawn: mocks.spawn,
    exec: (_cmd: string, _opts: unknown, cb: Function) => cb(null, { stdout: "", stderr: "" }),
  }),
}));
vi.mock("@/lib/build/sandbox/agent-cli-runtime", () => ({ writeSandboxFile: vi.fn(async () => {}) }));
vi.mock("./execution-adapter-registry", () => ({ registerExecutionAdapter: vi.fn() }));
vi.mock("./cli-pool-status", () => ({ recordCliRateLimit: mocks.poolLimit, clearCliRateLimit: mocks.poolClear }));
vi.mock("./rate-tracker", () => ({
  recordRequest: vi.fn(), learnFromRateLimitResponse: vi.fn(),
  extractRetryAfterMs: vi.fn(() => 1), markEndpointUnavailable: vi.fn(),
  clearEndpointUnavailable: vi.fn(), getEndpointRuntimeState: vi.fn(() => ({ unavailable: false })),
}));
vi.mock("./rate-recovery", () => ({ scheduleRecovery: vi.fn() }));
vi.mock("./loader", () => ({ invalidateRoutingLoaderCache: vi.fn() }));
vi.mock("./local-tool-fidelity", () => ({ resolveLocalToolFidelityCeiling: vi.fn(async () => null) }));
vi.mock("./route-outcome", () => ({ recordRouteOutcome: vi.fn(async () => {}) }));
vi.mock("@/lib/ai-provider-internals", () => ({ autoDiscoverAndProfile: vi.fn() }));
vi.mock("@/lib/provider-oauth", () => ({ refreshOAuthToken: vi.fn() }));

import { cliAdapter } from "./cli-adapter";
import { callWithFallbackChain } from "./fallback";
import type { AdapterRequest } from "./adapter-types";
import type { RouteDecision } from "./types";

const quota = "You've hit your org's monthly spend limit · ask your admin to raise it at claude.ai/admin-settings/usage · your weekly limit resets Sep 29, 4pm (UTC)";
const request: AdapterRequest = {
  providerId: "anthropic-sub", modelId: "claude-opus-4-6",
  provider: { baseUrl: "cli://local", headers: {} }, fetchImpl: globalThis.fetch,
  messages: [{ role: "user", content: "Review this change" }], systemPrompt: "Independent review",
  plan: { providerId: "anthropic-sub", modelId: "claude-opus-4-6", recipeId: null,
    contractFamily: "build-review", executionAdapter: "claude-cli", maxTokens: 4096,
    providerSettings: {}, toolPolicy: {}, responsePolicy: {} },
};

function output(payload: unknown) {
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
    setTimeout(() => { child.stdout.emit("data", Buffer.from(JSON.stringify(payload))); child.emit("close", 0); }, 1);
    return child;
  });
}
function decision(alternative?: string): RouteDecision {
  return { selectedEndpoint: "anthropic-sub", selectedModelId: "claude-opus-4-6",
    reason: "eligible review candidates", fitnessScore: 1, candidates: [],
    fallbackChain: alternative ? [alternative] : [],
    excludedCount: 0, excludedReasons: [], policyRulesApplied: [], taskType: "build-review",
    sensitivity: "internal", timestamp: new Date() };
}
async function settle<T>(promise: Promise<T>) {
  const result = promise.then(value => ({ value }), error => ({ error }));
  await vi.runAllTimersAsync();
  return result;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.provider.mockResolvedValue({ providerId: "test", name: "Test", authMethod: "oauth" });
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.callProvider.mockImplementation(async (providerId: string) => {
    if (providerId !== "anthropic-sub") return { content: "independent review result", inferenceMs: 1 };
    const result = await cliAdapter.execute(request);
    return { content: result.text, toolCalls: result.toolCalls, inferenceMs: result.inferenceMs };
  });
});
afterEach(() => vi.useRealTimers());

it("classifies the exact live org-spend banner as rate_limit even without envelope metadata", async () => {
  output({ result: quota, usage: {} });
  expect(await settle(cliAdapter.execute(request))).toMatchObject({ error: { code: "rate_limit" } });
  expect(mocks.poolClear).not.toHaveBeenCalled();
});
it.each(["codex", "local"])("fails over from actual Claude adapter to eligible %s", async alternative => {
  output({ type: "result", is_error: true, result: quota, usage: {} });
  expect(await settle(callWithFallbackChain(decision(alternative), request.messages, request.systemPrompt)))
    .toMatchObject({ value: { providerId: alternative, content: "independent review result", downgraded: true } });
  expect(mocks.callProvider.mock.calls.map(call => call[0])).toContain(alternative);
});
it("reports exhaustion when no alternate candidate was admitted", async () => {
  output({ type: "result", is_error: true, result: quota });
  const result = await settle(callWithFallbackChain(decision(), request.messages, request.systemPrompt));
  expect(result).toHaveProperty("error");
  expect(mocks.callProvider.mock.calls.every(call => call[0] === "anthropic-sub")).toBe(true);
});
it.each([
  { type: "result", is_error: true, result: "Unfamiliar failed response" },
  { type: "result", subtype: "error_during_execution", errors: ["Unfamiliar failure"] },
])("never returns a structured CLI failure as successful content: %j", async payload => {
  output(payload);
  expect(await settle(cliAdapter.execute(request))).toMatchObject({ error: { code: "provider_error" } });
});
it("preserves successful prose discussing organization limits", async () => {
  output({ type: "result", is_error: false, result: "The organization's monthly spend limit is an accounting control." });
  expect(await settle(cliAdapter.execute(request))).toMatchObject({ value: { text: "The organization's monthly spend limit is an accounting control." } });
});
