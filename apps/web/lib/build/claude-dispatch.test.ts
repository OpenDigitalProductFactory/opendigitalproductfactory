// apps/web/lib/build/claude-dispatch.test.ts
//
// The credential reaches the Claude CLI through a 600 node-owned file the runner
// loads into the CLI's env and deletes. It must never be inlined in the runner
// script (world-readable in the shared sandbox /tmp) and never left behind for a
// later build's agent to read.

import { beforeEach, describe, expect, it, vi } from "vitest";

const writeSandboxFile = vi.fn(async (_p: Record<string, unknown>) => undefined);
const runSandboxAgentCli = vi.fn(async (_p: Record<string, unknown>) => ({
  stdout: JSON.stringify({ result: "done", session_id: "s-1" }),
  durationMs: 5,
}));
const removeSandboxFiles = vi.fn(async (_c: string, _p: string[]) => undefined);

vi.mock("./sandbox/agent-cli-runtime", async (importActual) => {
  const actual = await importActual<typeof import("./sandbox/agent-cli-runtime")>();
  return {
    ...actual,
    SANDBOX_CONTAINER: "dpf-sandbox-1",
    ensureSandboxNodeUser: vi.fn(async () => undefined),
    writeSandboxFile: (p: Record<string, unknown>) => writeSandboxFile(p),
    runSandboxAgentCli: (p: Record<string, unknown>) => runSandboxAgentCli(p),
    removeSandboxFiles: (c: string, p: string[]) => removeSandboxFiles(c, p),
  };
});

const API_KEY = "sk-ant-api03-SUPER-SECRET-KEY";
const OAUTH_TOKEN = "sk-ant-oat01-SUPER-SECRET-TOKEN";

vi.mock("@/lib/inference/ai-provider-internals", () => ({
  getDecryptedCredential: vi.fn(async () => ({ secretRef: API_KEY })),
  getProviderBearerToken: vi.fn(async () => ({ token: OAUTH_TOKEN })),
}));
vi.mock("./sandbox/build-branch", () => ({ resolveBuildWorkdir: () => "/workspace/.builds/FB-1" }));
vi.mock("@/lib/ai-provider-routes", () => ({ providerSetupLocation: () => "Admin > AI providers" }));

import { dispatchClaudeTask } from "./claude-dispatch";
import type { AssignedTask } from "./task-dependency-graph";

const task = {
  taskIndex: 0,
  title: "Fix typo",
  specialist: "software-engineer",
  files: [],
  task: { title: "Fix typo", implement: "edit a file", testFirst: "", verify: "" },
} as unknown as AssignedTask;

function writes() {
  return writeSandboxFile.mock.calls.map(([p]) => p as { path: string; content: string; mode?: string; ownerOnly?: boolean; chownNodeUser?: boolean });
}
function credentialWrite() {
  return writes().find((w) => w.path.startsWith("/tmp/claude-token-"))!;
}
function runnerScript() {
  return writes().find((w) => w.path.startsWith("/tmp/claude-run-"))!.content;
}

describe("dispatchClaudeTask credential handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the API key as a secret file readable only by the CLI's user", async () => {
    await dispatchClaudeTask({ task, buildId: "FB-1", buildContext: "", providerId: "anthropic" });
    const w = credentialWrite();
    expect(w.content).toBe(API_KEY);
    expect(w.ownerOnly).toBe(true);
    expect(w.chownNodeUser).toBe(true);
    expect(w.mode).toBeUndefined();
  });

  it("never inlines the API key in the runner script", async () => {
    await dispatchClaudeTask({ task, buildId: "FB-1", buildContext: "", providerId: "anthropic" });
    expect(runnerScript()).not.toContain(API_KEY);
  });

  it("loads the credential and deletes the file before the CLI starts", async () => {
    await dispatchClaudeTask({ task, buildId: "FB-1", buildContext: "", providerId: "anthropic" });
    const path = credentialWrite().path;
    const lines = runnerScript().split("\n");
    const load = lines.indexOf(`export ANTHROPIC_API_KEY="$(cat '${path}')"`);
    const remove = lines.indexOf(`rm -f '${path}'`);
    const exec = lines.findIndex((l) => l.startsWith("exec claude "));
    expect(load).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(load);
    expect(exec).toBeGreaterThan(remove);
    expect(lines[exec]).toContain("claude --bare ");
  });

  it("uses the same path for the OAuth token, without --bare", async () => {
    await dispatchClaudeTask({ task, buildId: "FB-1", buildContext: "", providerId: "anthropic-sub" });
    const w = credentialWrite();
    expect(w.content).toBe(OAUTH_TOKEN);
    expect(w.ownerOnly).toBe(true);
    const script = runnerScript();
    expect(script).toContain(`export CLAUDE_CODE_OAUTH_TOKEN="$(cat '${w.path}')"`);
    expect(script).not.toContain(OAUTH_TOKEN);
    expect(script).not.toContain("--bare");
  });

  it("removes the credential file after a successful run", async () => {
    await dispatchClaudeTask({ task, buildId: "FB-1", buildContext: "", providerId: "anthropic" });
    expect(removeSandboxFiles).toHaveBeenCalledWith("dpf-sandbox-1", [credentialWrite().path]);
  });

  it("removes the credential file when the run fails before the runner deletes it", async () => {
    runSandboxAgentCli.mockRejectedValueOnce(Object.assign(new Error("exec failed"), { code: 1 }));
    const result = await dispatchClaudeTask({ task, buildId: "FB-1", buildContext: "", providerId: "anthropic" });
    expect(result.success).toBe(false);
    expect(removeSandboxFiles).toHaveBeenCalledWith("dpf-sandbox-1", [credentialWrite().path]);
  });
});
