import { beforeEach, describe, expect, it, vi } from "vitest";

// Governed inference envelope — mocked so the runner test never makes a real
// model call. The point under test is that dpf-native routes through this
// envelope (not a vendor CLI) and shapes a well-formed AgentRunResult.
const mockCallProvider = vi.fn();
vi.mock("@/lib/inference/ai-inference", () => ({
  callProvider: (...args: unknown[]) => mockCallProvider(...args),
}));

// ToolExecution audit row — mocked to return a real-looking cuid so we can
// assert the runner surfaces it as the toolExecutionId.
const mockToolExecutionCreate = vi.fn();
vi.mock("@dpf/db", () => ({
  prisma: {
    toolExecution: { create: (...args: unknown[]) => mockToolExecutionCreate(...args) },
  },
}));

import {
  dpfNativeAgentRunner,
  parseFileEdits,
} from "./dpf-native-agent-runner";
import { assertAgentProviderCompatibility } from "../agent-runner-types";
import type {
  BuildExecutionProvider,
  BuildExecutionProviderCapabilities,
  SandboxHandle,
} from "../provider-types";

const handle: SandboxHandle = {
  id: "sbx-1",
  buildId: "build-1",
  providerId: "local-docker",
};

function makeProvider(): {
  provider: BuildExecutionProvider;
  writeFile: ReturnType<typeof vi.fn>;
} {
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const provider = {
    id: "local-docker",
    writeFile,
    // The runner only touches `id` + `writeFile` in slice 1; the rest of the
    // interface is present as no-op stubs to satisfy the type.
    createSandbox: vi.fn(),
    startSandbox: vi.fn(),
    destroySandbox: vi.fn(),
    exec: vi.fn(),
    readFile: vi.fn(),
    copyAppsWebInto: vi.fn(),
    getPreviewUrl: vi.fn(),
    launchNextDev: vi.fn(),
    capabilities: vi.fn(),
  } as unknown as BuildExecutionProvider;
  return { provider, writeFile };
}

const localDockerCaps: BuildExecutionProviderCapabilities = {
  isolation: "container",
  trustLevel: "trusted-code-only",
  workspacePersistence: "durable",
  logSink: "authority-core",
  networkPolicy: "namespaced",
  cleanupModel: "explicit",
  supportsPreviewUrl: true,
  supportsPortCallbacks: true,
  supportsFileCopy: true,
  supportsSnapshot: false,
  dockerInsideSandbox: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockToolExecutionCreate.mockResolvedValue({ id: "clz_real_cuid_123" });
});

describe("dpfNativeAgentRunner", () => {
  it("has the dpf-native capability profile (governed, portal-side loop)", () => {
    const caps = dpfNativeAgentRunner.capabilities();
    expect(dpfNativeAgentRunner.id).toBe("dpf-native");
    expect(caps.honorsLlmBaseUrl).toBe(true);
    expect(caps.requiresCredential).toBe(false);
    expect(caps.requiresPersistentSession).toBe(false);
    expect(caps.requiresCallbackPort).toBeUndefined();
    expect(caps.tier).toBe("single-file-edit");
  });

  it("satisfies provider compatibility on local Docker", () => {
    expect(() =>
      assertAgentProviderCompatibility(dpfNativeAgentRunner.capabilities(), localDockerCaps),
    ).not.toThrow();
  });

  it("dispatches a task through the governed inference envelope and applies edits", async () => {
    mockCallProvider.mockResolvedValue({
      content:
        '```dpf-edits\n[{"path":"apps/web/foo.ts","content":"export const x = 1;\\n"}]\n```',
      inputTokens: 120,
      outputTokens: 45,
      inferenceMs: 800,
    });
    const { provider, writeFile } = makeProvider();

    const result = await dpfNativeAgentRunner.run(provider, handle, {
      buildId: "build-1",
      prompt: "Add a constant x",
      providerId: "anthropic",
      model: "claude-sonnet-4-5",
    });

    // Routed through callProvider (governed path), not a vendor CLI.
    expect(mockCallProvider).toHaveBeenCalledTimes(1);
    expect(mockCallProvider).toHaveBeenCalledWith(
      "anthropic",
      "claude-sonnet-4-5",
      expect.any(Array),
      expect.any(String),
    );

    // Sandbox driven as a thin tool target.
    expect(writeFile).toHaveBeenCalledWith(handle, "apps/web/foo.ts", "export const x = 1;\n");

    // Well-formed AgentRunResult with a REAL toolExecutionId (the cuid).
    expect(result.exitCode).toBe(0);
    expect(result.agentId).toBe("dpf-native");
    expect(result.providerId).toBe("local-docker");
    expect(result.toolExecutionId).toBe("clz_real_cuid_123");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Governed audit row recorded with token metering.
    expect(mockToolExecutionCreate).toHaveBeenCalledTimes(1);
    const auditArg = mockToolExecutionCreate.mock.calls[0][0].data;
    expect(auditArg.toolName).toBe("dpf_native_build_dispatch");
    expect(auditArg.success).toBe(true);
    expect(auditArg.inputTokens).toBe(120);
    expect(auditArg.outputTokens).toBe(45);
  });

  it("reports a failed dispatch (exitCode 1) when inference throws", async () => {
    mockCallProvider.mockRejectedValue(new Error("provider overloaded"));
    const { provider, writeFile } = makeProvider();

    const result = await dpfNativeAgentRunner.run(provider, handle, {
      buildId: "build-1",
      prompt: "Add a constant x",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("provider overloaded");
    expect(writeFile).not.toHaveBeenCalled();
    // Audit row still written, marked unsuccessful, and id surfaced.
    expect(result.toolExecutionId).toBe("clz_real_cuid_123");
    expect(mockToolExecutionCreate.mock.calls[0][0].data.success).toBe(false);
  });

  it("falls back to a synthetic id when the audit write fails (dispatch still succeeds)", async () => {
    mockCallProvider.mockResolvedValue({
      content: "```dpf-edits\n[]\n```",
      inputTokens: 10,
      outputTokens: 2,
      inferenceMs: 50,
    });
    mockToolExecutionCreate.mockRejectedValue(new Error("db down"));
    const { provider } = makeProvider();

    const result = await dpfNativeAgentRunner.run(provider, handle, {
      buildId: "build-9",
      prompt: "noop",
    });

    expect(result.exitCode).toBe(0);
    expect(result.toolExecutionId).toContain("dpf-native:build-9:");
    expect(result.stderr).toContain("[audit]");
  });
});

describe("parseFileEdits", () => {
  it("parses a dpf-edits fenced block", () => {
    const edits = parseFileEdits('```dpf-edits\n[{"path":"a.ts","content":"x"}]\n```');
    expect(edits).toEqual([{ path: "a.ts", content: "x" }]);
  });

  it("parses a bare json array without a fence", () => {
    expect(parseFileEdits('[{"path":"b.ts","content":"y"}]')).toEqual([
      { path: "b.ts", content: "y" },
    ]);
  });

  it("returns [] for malformed or non-array output", () => {
    expect(parseFileEdits("not json")).toEqual([]);
    expect(parseFileEdits('```json\n{"path":"a"}\n```')).toEqual([]);
    expect(parseFileEdits("")).toEqual([]);
  });

  it("drops entries missing path or content", () => {
    expect(parseFileEdits('[{"path":"a.ts"},{"path":"b.ts","content":"ok"}]')).toEqual([
      { path: "b.ts", content: "ok" },
    ]);
  });
});
