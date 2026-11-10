import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DPF_MCP_SCRIPT_URL, resolveDpfMcpConfig } from "./dpf-mcp-client";

describe("resolveDpfMcpConfig", () => {
  const originalCwd = process.cwd();
  afterEach(() => process.chdir(originalCwd));

  it("uses DPF_MCP_URL and the bearer from the environment", () => {
    expect(
      resolveDpfMcpConfig({ DPF_MCP_URL: "http://elsewhere/api/mcp/v1", DPF_MCP_BEARER_TOKEN: "tok-123" }),
    ).toEqual({ url: "http://elsewhere/api/mcp/v1", authorization: "Bearer tok-123" });
  });

  it("falls back to the local endpoint when DPF_MCP_URL is unset", () => {
    expect(resolveDpfMcpConfig({ DPF_MCP_BEARER_TOKEN: "tok" })).toEqual({
      url: DEFAULT_DPF_MCP_SCRIPT_URL,
      authorization: "Bearer tok",
    });
    expect(DEFAULT_DPF_MCP_SCRIPT_URL).toBe("http://127.0.0.1:3000/api/mcp/v1");
  });

  it("accepts the back-compat DPF_MCP_TOKEN and adds the Bearer prefix", () => {
    expect(resolveDpfMcpConfig({ DPF_MCP_TOKEN: "raw-token" })?.authorization).toBe("Bearer raw-token");
  });

  it("returns null when no bearer is configured", () => {
    expect(resolveDpfMcpConfig({ DPF_MCP_URL: "http://127.0.0.1:3000/api/mcp/v1" })).toBeNull();
  });

  // BI-5201141C: on https no writer produces a project .mcp.json; the Claude
  // connector is the plugin's URL-only OAuth descriptor. A stale file left in
  // the checkout is not a credential source.
  it("ignores a project .mcp.json in the working directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dpf-mcp-"));
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { dpf: { url: "http://127.0.0.1:3000/api/mcp/v1", headers: { Authorization: "Bearer literal" } } } }),
      "utf8",
    );
    process.chdir(dir);
    expect(resolveDpfMcpConfig({})).toBeNull();
  });
});
