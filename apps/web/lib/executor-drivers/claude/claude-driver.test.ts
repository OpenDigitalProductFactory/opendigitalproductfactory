// The Claude driver (BI-A01B06F6, S3 PR 1): one auth resolver, one one-shot
// command line, one result parser and one session, called by the Workroom
// runtime, Build Studio dispatch, Ideate and inference routing.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetProviderBearerToken = vi.fn();
const mockGetDecryptedCredential = vi.fn();
vi.mock("@/lib/inference/ai-provider-internals", () => ({
  getProviderBearerToken: (...args: unknown[]) => mockGetProviderBearerToken(...args),
  getDecryptedCredential: (...args: unknown[]) => mockGetDecryptedCredential(...args),
}));
vi.mock("@/lib/ai-provider-routes", () => ({ providerSetupLocation: (id: string) => `Settings > ${id}` }));

import { claudeCredential, resolveClaudeAuth } from "./auth";
import { CLAUDE_CODE_NATIVE_TOOLS_FLAG_VALUE, claudeOneShotArgs, parseClaudeResult } from "./one-shot";
import { claudeDriver, createClaudeDriver } from "./index";
import type { RuntimeEvent } from "../types";
import type { RuntimeLaunch, RuntimeProcess } from "@/lib/workroom-runtime/sandbox-launcher";

beforeEach(() => {
  mockGetProviderBearerToken.mockReset();
  mockGetDecryptedCredential.mockReset();
});

describe("resolveClaudeAuth: the one Claude credential resolver", () => {
  it("uses the refreshing bearer token for the subscription provider", async () => {
    mockGetProviderBearerToken.mockResolvedValue({ token: "sk-ant-oat01-x" });
    await expect(resolveClaudeAuth("anthropic-sub")).resolves.toEqual({ mode: "oauth", token: "sk-ant-oat01-x" });
    expect(mockGetProviderBearerToken).toHaveBeenCalledWith("anthropic-sub");
  });

  it("passes the account connection and its version through when routing names one", async () => {
    mockGetProviderBearerToken.mockResolvedValue({ token: "t" });
    await resolveClaudeAuth("anthropic-sub", { connectionId: "conn-1", expectedExecutionVersion: "v3" });
    expect(mockGetProviderBearerToken).toHaveBeenCalledWith("anthropic-sub", "conn-1", "v3");
    await resolveClaudeAuth("anthropic-sub", { connectionId: "conn-2" });
    expect(mockGetProviderBearerToken).toHaveBeenLastCalledWith("anthropic-sub", "conn-2");
  });

  it("names the provider and where to fix it when the token cannot be refreshed", async () => {
    mockGetProviderBearerToken.mockResolvedValue({ error: "Refresh token expired" });
    await expect(resolveClaudeAuth("anthropic-sub")).rejects.toThrow(
      'OAuth token error for "anthropic-sub": Refresh token expired. Re-authenticate via Settings > anthropic-sub.',
    );
  });

  it("uses the stored API key for any other provider", async () => {
    mockGetDecryptedCredential.mockResolvedValue({ secretRef: "sk-ant-api-x" });
    await expect(resolveClaudeAuth("anthropic")).resolves.toEqual({ mode: "apikey", apiKey: "sk-ant-api-x" });
    mockGetDecryptedCredential.mockResolvedValue({ cachedToken: "cached" });
    await expect(resolveClaudeAuth("anthropic")).resolves.toEqual({ mode: "apikey", apiKey: "cached" });
  });

  it("refuses when no API key is stored", async () => {
    mockGetDecryptedCredential.mockResolvedValue(null);
    await expect(resolveClaudeAuth("anthropic")).rejects.toThrow('No Anthropic API key for provider "anthropic". Configure via Settings > anthropic.');
  });

  it("maps each auth mode to its environment variable, and --bare only for an API key", () => {
    expect(claudeCredential({ mode: "oauth", token: "t" })).toEqual({ envVar: "CLAUDE_CODE_OAUTH_TOKEN", value: "t", bare: false });
    expect(claudeCredential({ mode: "apikey", apiKey: "k" })).toEqual({ envVar: "ANTHROPIC_API_KEY", value: "k", bare: true });
  });
});

describe("claudeOneShotArgs: one command line for every one-shot caller", () => {
  it("builds Build Studio dispatch's command exactly as before", () => {
    expect(claudeOneShotArgs({ authMode: "apikey", sessionId: "abc", model: "sonnet" }).join(" "))
      .toBe("--bare --session-id abc -p - --dangerously-skip-permissions --output-format json --model sonnet");
    expect(claudeOneShotArgs({ authMode: "oauth", model: "sonnet" }).join(" "))
      .toBe("-p - --dangerously-skip-permissions --output-format json --model sonnet");
  });

  it("builds Ideate's command exactly as before", () => {
    expect(claudeOneShotArgs({ authMode: "oauth", addDirs: ["/workspace"], model: null }).join(" "))
      .toBe("-p - --dangerously-skip-permissions --add-dir /workspace --output-format json");
  });

  it("builds inference routing's command exactly as before", () => {
    expect(claudeOneShotArgs({ authMode: "oauth", mcpConfigFile: "/tmp/m.json", disallowNativeTools: true, model: "opus" }))
      .toEqual(["-p", "-", "--dangerously-skip-permissions", "--mcp-config", "/tmp/m.json", "--strict-mcp-config",
        "--disallowedTools", CLAUDE_CODE_NATIVE_TOOLS_FLAG_VALUE, "--output-format", "json", "--model", "opus"]);
  });
});

describe("parseClaudeResult: one reader of the CLI's json result", () => {
  it("reads the answer, session, cost and usage including prompt-cache tokens", () => {
    const parsed = parseClaudeResult(JSON.stringify({
      result: "done", session_id: "s-1", total_cost_usd: 0.25,
      usage: { input_tokens: 17, output_tokens: 900, cache_creation_input_tokens: 12000, cache_read_input_tokens: 30000 },
    }));
    expect(parsed).toMatchObject({ text: "done", hasResult: true, sessionId: "s-1", costUsd: 0.25, isError: false, usageReported: true });
    expect(parsed.usage).toEqual({ inputTokens: 17, outputTokens: 900, cacheCreationInputTokens: 12000, cacheReadInputTokens: 30000 });
  });

  it("separates calls the CLI already ran over MCP from calls the caller must run", () => {
    const parsed = parseClaudeResult(JSON.stringify({ result: "ok", content: [
      { type: "tool_use", id: "a", name: "mcp__dpf__report_quality_issue", input: {} },
      { type: "tool_use", id: "b", name: "saveBuildEvidence", input: { field: "designDoc" } },
    ] }));
    expect(parsed.cliPreExecutedNames).toEqual(["report_quality_issue"]);
    expect(parsed.toolCalls.map((c) => c.name)).toEqual(["saveBuildEvidence"]);
  });

  it("rescues a tool_use the model wrote as text", () => {
    const text = '{"type":"tool_use","id":"t1","name":"save_build_notes","input":{"notes":"n"}}';
    expect(parseClaudeResult(JSON.stringify({ result: text })).toolCalls.map((c) => c.name)).toEqual(["save_build_notes"]);
  });

  it("reports a CLI-level error", () => {
    expect(parseClaudeResult(JSON.stringify({ is_error: true, result: "401 authentication_error" }))).toMatchObject({ isError: true, text: "401 authentication_error" });
  });

  it("keeps non-JSON output as text, with usage unknown rather than counted", () => {
    const parsed = parseClaudeResult("plain error text, not JSON");
    expect(parsed).toMatchObject({ text: "plain error text, not JSON", hasResult: false, usageReported: false, cliPreExecutedNames: [] });
  });

  it("marks a missing result so callers can say there was no output", () => {
    expect(parseClaudeResult(JSON.stringify({ session_id: "s" })).hasResult).toBe(false);
  });
});

describe("the Claude driver", () => {
  it("states its capabilities instead of leaving callers to infer them", () => {
    expect(claudeDriver.provider).toBe("claude");
    expect(claudeDriver.capabilities).toEqual({
      steer: false, interrupt: true, runtimeRequests: "permission-tool", resumeThread: true, usage: true, oneShot: true,
    });
  });

  function fakeLauncher() {
    let onData: (chunk: string) => void = () => {};
    const written: string[] = [];
    const launches: RuntimeLaunch[] = [];
    const proc: RuntimeProcess = {
      write: (line) => { written.push(line); },
      onData: (listener) => { onData = listener as (chunk: string) => void; },
      onStderr: () => {},
      onClose: () => {},
      end: () => {},
      kill: () => {},
    };
    return { launch: (launch: RuntimeLaunch) => { launches.push(launch); return proc; }, emit: (line: object) => onData(`${JSON.stringify(line)}\n`), written, launches };
  }

  it("reports each turn's usage from the result event, and unknown usage as unknown", async () => {
    const fake = fakeLauncher();
    const driver = createClaudeDriver({ launch: fake.launch, auth: async () => ({ mode: "oauth", token: "t" }) });
    const events: RuntimeEvent[] = [];
    const session = await driver.openSession({ capsuleId: "WC-1", mcp: { url: "http://p/api/mcp/v1", bearerToken: "b" }, cwd: "/w" }, (e) => events.push(e));
    await session.startTurn("hello");
    fake.emit({ type: "result", subtype: "success", result: "hi", total_cost_usd: 0.01, usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 50 } });
    await session.startTurn("again");
    fake.emit({ type: "result", subtype: "success", result: "hi" });

    const usage = events.filter((e) => e.type === "usage");
    expect(usage).toEqual([
      { type: "usage", turnId: "turn-1", usage: { reported: "native", inputTokens: 3, outputTokens: 4, cacheReadInputTokens: 50, costUsd: 0.01 } },
      { type: "usage", turnId: "turn-2", usage: { reported: "unknown" } },
    ]);
    // Usage is reported before the turn is closed, so it belongs to that turn.
    expect(events.map((e) => e.type)).toEqual(["turn-started", "usage", "turn-completed", "turn-started", "usage", "turn-completed"]);
  });

  it("puts the credential in the environment named by its auth mode, never on the command line", async () => {
    const fake = fakeLauncher();
    const driver = createClaudeDriver({ launch: fake.launch, auth: async () => ({ mode: "apikey", apiKey: "sk-secret" }) });
    await driver.openSession({ capsuleId: "WC-1", mcp: { url: "u", bearerToken: "b" }, cwd: "/w" }, () => {});
    expect(fake.launches[0]?.env["ANTHROPIC_API_KEY"]).toBe("sk-secret");
    expect(fake.launches[0]?.script).not.toContain("sk-secret");
  });
});
