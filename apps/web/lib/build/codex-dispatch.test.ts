// Build Studio's Codex dispatch runs on the Codex driver (BI-A01B06F6, S3 PR 2):
// the driver's credentials, written where the CLI reads them, and the driver's
// `codex exec` command line, unchanged, still run as root from the build's workdir.
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeSandboxFile = vi.fn(async (_input: Record<string, unknown>) => {});
const runSandboxAgentCli = vi.fn(async (_input: Record<string, unknown>) => ({ stdout: "done", stderr: "", durationMs: 5, exitCode: 0 }));
const resolveCodexAuth = vi.fn();
vi.mock("./sandbox/agent-cli-runtime", () => ({
  SANDBOX_CONTAINER: "dpf-sandbox-1",
  buildSpecialistInstructions: () => "instructions",
  buildSpecialistTaskPrompt: () => "prompt",
  runSandboxAgentCli: (input: Record<string, unknown>) => runSandboxAgentCli(input),
  writeSandboxFile: (input: Record<string, unknown>) => writeSandboxFile(input),
}));
vi.mock("@/lib/executor-drivers/codex/auth", async (original) => ({
  ...(await original<typeof import("@/lib/executor-drivers/codex/auth")>()),
  resolveCodexAuth: (...args: unknown[]) => resolveCodexAuth(...args),
}));
vi.mock("@/lib/build/dispatch-attempts", () => ({ recordBuildDispatchAttempt: vi.fn(async () => {}) }));
vi.mock("./sandbox/build-branch", () => ({ resolveBuildWorkdir: () => "/workspace" }));

import { dispatchCodexTask } from "./codex-dispatch";

const task = { taskIndex: 0, title: "Add field", specialist: "software-engineer", files: [], task: { title: "Add field", testFirst: "", implement: "x", verify: "" } } as never;

beforeEach(() => { vi.clearAllMocks(); });

describe("Build Studio Codex dispatch on the Codex driver", () => {
  it("writes the driver's credentials for root and runs the unchanged command as root", async () => {
    resolveCodexAuth.mockResolvedValue({ mode: "oauth", accessToken: "a.b.c", refreshToken: "r", accountId: "acct-1" });
    const result = await dispatchCodexTask({ task, buildId: "FB-1", buildContext: "ctx", providerId: "chatgpt", model: "gpt-5.5" });

    expect(resolveCodexAuth).toHaveBeenCalledWith("chatgpt");
    const auth = writeSandboxFile.mock.calls.map(([input]) => input).find((input) => input["path"] === "/root/.codex/auth.json");
    expect(auth).toMatchObject({ containerId: "dpf-sandbox-1", ownerOnly: true, mkdirParents: "/root/.codex" });
    expect(JSON.parse(String(auth?.["content"]))).toMatchObject({ auth_mode: "chatgptAuthTokens", tokens: { access_token: "a.b.c", account_id: "acct-1" } });

    const run = runSandboxAgentCli.mock.calls[0]![0];
    expect(run["execArgs"]).toEqual(["exec", "dpf-sandbox-1", "sh", "-c",
      "cd /workspace && codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -m gpt-5.5 < /tmp/codex-prompt.txt"]);
    expect(run).not.toHaveProperty("asNodeUser");
    expect(result).toMatchObject({ success: true, content: "done" });
  });

  it("reports an auth failure without running Codex", async () => {
    resolveCodexAuth.mockRejectedValue(new Error('No credential for "chatgpt". Configure via Settings.'));
    const result = await dispatchCodexTask({ task, buildId: "FB-1", buildContext: "ctx" });
    expect(result).toMatchObject({ success: false, content: 'Auth error: No credential for "chatgpt". Configure via Settings.' });
    expect(runSandboxAgentCli).not.toHaveBeenCalled();
  });
});
