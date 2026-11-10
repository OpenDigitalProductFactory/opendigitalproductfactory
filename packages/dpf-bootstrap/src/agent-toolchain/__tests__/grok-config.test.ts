import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";

import { planGrokConfig } from "../grok-config";

const REPO = "D:\\DPF-worktrees\\agent-preflight-offline";
const CONFIG_PATH = "C:\\Users\\Test\\.grok\\config.toml";
const ENDPOINT = "http://127.0.0.1:3000/api/mcp/v1";

describe("planGrokConfig", () => {
  it("accepts a UTF-8 BOM at the start of a Windows-written config", () => {
    const plan = planGrokConfig(
      "\uFEFF[cli]\r\ninstaller = \"internal\"\r\n",
      REPO,
      CONFIG_PATH,
      ENDPOINT,
    );

    expect(plan.writes).toHaveLength(1);
    expect(plan.rationale).not.toMatch(/TOML parse error/);
    const parsed = parse(plan.writes[0].content) as {
      cli: { installer: string };
      mcp_servers: Record<string, { url: string; bearer_token_file?: string; bearer_token_env_var?: string }>;
    };
    expect(parsed.cli.installer).toBe("internal");
    expect(parsed.mcp_servers.dpf).toEqual({
      url: ENDPOINT,
      bearer_token_file: "C:\\Users\\Test\\.grok\\dpf-mcp-token",
    });
  });

  it("replaces a pasted bearer env var with the token file and keeps other keys", () => {
    const plan = planGrokConfig(
      `[mcp_servers.dpf]\nurl = "${ENDPOINT}"\nbearer_token_env_var = "DPF_MCP_BEARER_TOKEN"\nstartup_timeout_sec = 45\n`,
      REPO,
      CONFIG_PATH,
      ENDPOINT,
    );
    const parsed = parse(plan.writes[0].content) as {
      mcp_servers: Record<string, { url: string; bearer_token_file?: string; bearer_token_env_var?: string; startup_timeout_sec?: number }>;
    };
    expect(parsed.mcp_servers.dpf.bearer_token_file).toBe("C:\\Users\\Test\\.grok\\dpf-mcp-token");
    expect(parsed.mcp_servers.dpf.bearer_token_env_var).toBeUndefined();
    expect(parsed.mcp_servers.dpf.startup_timeout_sec).toBe(45);
  });

  it("writes nothing when the token file is already set", () => {
    const plan = planGrokConfig(
      `[mcp_servers.dpf]\nurl = "${ENDPOINT}"\nbearer_token_file = "C:\\\\Users\\\\Test\\\\.grok\\\\dpf-mcp-token"\n`,
      REPO,
      CONFIG_PATH,
      ENDPOINT,
    );
    expect(plan.writes).toEqual([]);
  });

  it("returns zero writes with a parse-error rationale on unparseable TOML", () => {
    const plan = planGrokConfig("[unterminated\nkey = ", REPO, CONFIG_PATH, ENDPOINT);

    expect(plan.writes).toEqual([]);
    expect(plan.rationale).toMatch(/TOML parse error/);
  });
});
