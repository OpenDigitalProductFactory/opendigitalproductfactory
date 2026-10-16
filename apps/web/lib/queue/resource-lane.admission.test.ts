import { afterEach, expect, it, vi } from "vitest";

const checks = vi.hoisted(() => ({ lease: vi.fn(), gpu: vi.fn() }));
vi.mock("@/lib/routing/local-provider-capacity", () => ({ assertLocalProviderCapacityAvailable: checks.lease }));
vi.mock("@/lib/inference/host-gpu-admission", () => ({ assertLocalGpuFree: checks.gpu }));
import { withLocalInferenceLock } from "./resource-lane";
import { chatAdapter } from "@/lib/routing/chat-adapter";
import { currentGovernedInferenceDeadline, withGovernedInferenceDeadline,
  withInferenceCancellation } from "@/lib/routing/governed-inference-deadline";

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it("ends a caller's post-admission authority wait without revoking its parent", async () => {
  const caller = new AbortController();
  const reason = new Error("caller expired while checking authority");
  let entered!: () => void;
  let finishAuthority!: (value: boolean) => void;
  const enteredAuthority = new Promise<void>(resolve => { entered = resolve; });
  const authority = new Promise<boolean>(resolve => { finishAuthority = resolve; });
  let checks = 0;
  let observed: unknown;
  let parentWasAborted: boolean | undefined;
  const dispatch = vi.fn(async () => "answer");
  const running = withGovernedInferenceDeadline({
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    verifyAuthority: async () => {
      if (++checks === 1) return true;
      entered();
      return authority;
    },
  }, () => withInferenceCancellation(caller.signal, async () => {
    const parent = currentGovernedInferenceDeadline()!;
    try {
      return await withLocalInferenceLock(dispatch, { signal: caller.signal });
    } catch (error) {
      observed = error;
      parentWasAborted = parent.signal.aborted;
      throw error;
    }
  }));
  const settled = running.catch(() => undefined);
  await enteredAuthority;
  caller.abort(reason);
  try {
    await vi.waitFor(() => expect(observed).toBe(reason), { timeout: 1_000 });
    expect(parentWasAborted).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  } finally {
    finishAuthority(true);
    await settled;
  }
});

it.each(["local", "ollama"])("%s provider dispatch waits behind a local build before checking the GPU", async (providerId) => {
  vi.stubEnv("VITEST", "false");
  vi.stubEnv("DPF_LOCAL_INFERENCE_MAX_QUEUE_DEPTH", "");
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const build = withLocalInferenceLock(async () => { started(); await held; });
  await entered;
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: "complete answer" }, finish_reason: "stop" }],
  }), { status: 200 }));
  // callProvider owns this lane; the adapter must not take a nested lock.
  const chat = withLocalInferenceLock(() => chatAdapter.execute({
    providerId, modelId: "local-model",
    plan: { providerId, modelId: "local-model", recipeId: null, contractFamily: "sync.greeting",
      executionAdapter: "chat", maxTokens: 100, providerSettings: {}, toolPolicy: {}, responsePolicy: {} },
    provider: { baseUrl: "http://localhost:12434/v1", headers: {} },
    messages: [{ role: "user", content: "Hello" }], systemPrompt: "Answer", fetchImpl,
  }));
  await Promise.resolve();
  await Promise.resolve();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(checks.gpu).toHaveBeenCalledTimes(1);
  release();
  await build;
  await expect(chat).resolves.toMatchObject({ text: "complete answer" });
  expect(checks.gpu).toHaveBeenCalledTimes(2);
});

it("waits for the active local caller before rechecking host safety", async () => {
  vi.stubEnv("VITEST", "false");
  vi.stubEnv("DPF_LOCAL_INFERENCE_MAX_QUEUE_DEPTH", "");
  let busy = false;
  checks.gpu.mockImplementation(async () => { if (busy) throw new Error("local-runner-busy"); });
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = withLocalInferenceLock(async () => {
    busy = true; started();
    await held;
    busy = false;
  });
  await entered;
  const second = withLocalInferenceLock(async () => "answer");
  await Promise.resolve();
  await Promise.resolve();
  expect(checks.gpu).toHaveBeenCalledTimes(1);
  expect(checks.lease).toHaveBeenCalledTimes(1);
  release();
  await first;
  await expect(second).resolves.toBe("answer");
  expect(checks.lease).toHaveBeenCalledTimes(2);
  expect(checks.gpu).toHaveBeenCalledTimes(2);
});

it("releases the lane when a host lease refuses dispatch", async () => {
  vi.stubEnv("VITEST", "false");
  vi.stubEnv("DPF_LOCAL_INFERENCE_MAX_QUEUE_DEPTH", "");
  checks.lease.mockRejectedValueOnce(new Error("lease occupied"));
  const call = vi.fn(async () => "answer");
  await expect(withLocalInferenceLock(call)).rejects.toThrow("lease occupied");
  expect(call).not.toHaveBeenCalled();
  await expect(withLocalInferenceLock(call)).resolves.toBe("answer");
});
