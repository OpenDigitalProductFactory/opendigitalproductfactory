import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  provider: vi.fn(),
  connection: vi.fn(),
  ensureSandboxNodeUser: vi.fn(),
  writeSandboxFile: vi.fn(),
  runSandboxAgentCli: vi.fn(),
  recordBuildDispatchAttempt: vi.fn(),
  recordProviderCapacityStatus: vi.fn(),
  withLocalInferenceLock: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {
  modelProvider: { findUnique: mocks.provider },
  aiProviderConnection: { findUnique: mocks.connection },
} }));
vi.mock("./sandbox/agent-cli-runtime", () => ({
  buildSpecialistInstructions: () => "Build the task.",
  buildSpecialistTaskPrompt: () => "Implement the bounded task.",
  ensureSandboxNodeUser: mocks.ensureSandboxNodeUser,
  writeSandboxFile: mocks.writeSandboxFile,
  runSandboxAgentCli: mocks.runSandboxAgentCli,
}));
vi.mock("@/lib/inference/ollama-url", () => ({ getOllamaBaseUrl: () => "http://local-model/v1" }));
vi.mock("@/lib/inference/dmr-runtime-config", () => ({
  getServedContextTokens: async () => ({ supported: true, contextTokens: 32768 }),
}));
vi.mock("@/lib/inference/ai-provider-internals", () => ({ getDecryptedCredential: vi.fn() }));
vi.mock("@/lib/build/dispatch-attempts", () => ({ recordBuildDispatchAttempt: mocks.recordBuildDispatchAttempt }));
vi.mock("./sandbox/build-branch", () => ({ resolveBuildWorkdir: () => "/workspace/build" }));
vi.mock("@/lib/queue/resource-lane", () => ({ withLocalInferenceLock: mocks.withLocalInferenceLock }));
vi.mock("@/lib/routing/provider-capacity/store", () => ({ recordProviderCapacityStatus: mocks.recordProviderCapacityStatus }));

import { dispatchOpencodeTask } from "./opencode-dispatch";
import { ProviderRoutingDeferredError } from "@/lib/inference/provider-routing-admission";
import { describeCapacityDeferral } from "./capacity-deferral";

function dispatch(providerId?: string) {
  return dispatchOpencodeTask({
    task: {
      taskIndex: 0,
      title: "Bounded coding task",
      specialist: "software-engineer",
      files: [],
      task: { title: "Bounded coding task", testFirst: "", implement: "Implement it.", verify: "Run the test." },
    },
    buildId: "build-pause-boundary",
    buildContext: "",
    model: "qwen3-coder",
    providerId,
    fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: "qwen3-coder" }] }), { status: 200 }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.provider.mockResolvedValue({ providerId: "local", status: "active" });
  mocks.connection.mockResolvedValue({ status: "active" });
  mocks.withLocalInferenceLock.mockImplementation(async (fn: () => Promise<unknown>) => fn());
  mocks.runSandboxAgentCli.mockResolvedValue({ stdout: "Task completed", durationMs: 10 });
  mocks.recordBuildDispatchAttempt.mockResolvedValue(undefined);
  mocks.recordProviderCapacityStatus.mockResolvedValue(undefined);
});

describe("OpenCode local routing admission", () => {
  it("applies local admission when an empty provider selection falls back to local", async () => {
    mocks.connection.mockResolvedValue({ status: "paused" });

    await expect(dispatch("")).rejects.toBeInstanceOf(ProviderRoutingDeferredError);

    expect(mocks.runSandboxAgentCli).not.toHaveBeenCalled();
    expect(mocks.recordBuildDispatchAttempt).not.toHaveBeenCalled();
    expect(mocks.recordProviderCapacityStatus).not.toHaveBeenCalled();
  });

  it.each(["paused", "inactive", "disabled"])("does not prepare or launch a local task for a %s account", async (status) => {
    mocks.connection.mockResolvedValue({ status });

    await expect(dispatch()).rejects.toBeInstanceOf(ProviderRoutingDeferredError);

    expect(mocks.ensureSandboxNodeUser).not.toHaveBeenCalled();
    expect(mocks.writeSandboxFile).not.toHaveBeenCalled();
    expect(mocks.runSandboxAgentCli).not.toHaveBeenCalled();
    expect(mocks.recordBuildDispatchAttempt).not.toHaveBeenCalled();
    expect(mocks.recordProviderCapacityStatus).not.toHaveBeenCalled();
  });

  it("rechecks operator pause after waiting for the resource lane", async () => {
    let admit!: () => void;
    let queued!: () => void;
    const waiting = new Promise<void>((resolve) => { queued = resolve; });
    const released = new Promise<void>((resolve) => { admit = resolve; });
    mocks.withLocalInferenceLock.mockImplementation(async (fn: () => Promise<unknown>) => {
      queued();
      await released;
      return fn();
    });
    const result = dispatch();
    const deferred = expect(result).rejects.toMatchObject({
      name: "ProviderRoutingDeferredError",
      reason: expect.stringContaining("paused by an operator"),
    });
    await waiting;
    mocks.connection.mockResolvedValue({ status: "paused" });
    admit();

    await deferred;
    expect(mocks.runSandboxAgentCli).not.toHaveBeenCalled();
    expect(mocks.recordBuildDispatchAttempt).not.toHaveBeenCalled();
    expect(mocks.recordProviderCapacityStatus).not.toHaveBeenCalled();
  });

  it.each(["entry", "after lane wait"])("defers without provider failure evidence when eligibility fails at %s", async (boundary) => {
    const failure = new Error("Routing store unavailable");
    if (boundary === "entry") {
      mocks.provider.mockRejectedValue(failure);
    } else {
      mocks.withLocalInferenceLock.mockImplementation(async (fn: () => Promise<unknown>) => {
        mocks.provider.mockRejectedValue(failure);
        return fn();
      });
    }

    const error: unknown = await dispatch().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ProviderRoutingDeferredError);
    expect(error).toMatchObject({ code: "transient", cause: failure });
    expect(describeCapacityDeferral(error)).toMatchObject({
      expectedFreeAt: null,
      message: expect.stringMatching(/eligibility.*(?:unavailable|could not be verified)/i),
    });
    expect(describeCapacityDeferral(error)?.message).not.toMatch(/paused|disabled|GPU|local-CI/i);
    expect(mocks.runSandboxAgentCli).not.toHaveBeenCalled();
    expect(mocks.recordBuildDispatchAttempt).not.toHaveBeenCalled();
    expect(mocks.recordProviderCapacityStatus).not.toHaveBeenCalled();
  });

  it("launches an enabled local task and records its successful result", async () => {
    await expect(dispatch()).resolves.toMatchObject({ success: true, content: "Task completed" });

    expect(mocks.runSandboxAgentCli).toHaveBeenCalledOnce();
    expect(mocks.recordBuildDispatchAttempt).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(mocks.provider).toHaveBeenCalledTimes(2);
    expect(mocks.connection).toHaveBeenCalledTimes(2);
    expect(mocks.recordProviderCapacityStatus).not.toHaveBeenCalled();
  });
});
