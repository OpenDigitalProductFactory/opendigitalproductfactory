import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandEnvPlaceholders, resolveDpfMcpConfig } from "./dpf-mcp-client";

const MCP_JSON = JSON.stringify({
  mcpServers: {
    dpf: {
      url: "http://127.0.0.1:3000/api/mcp/v1",
      headers: { Authorization: "Bearer ${DPF_MCP_BEARER_TOKEN}" },
    },
  },
});

async function writeConfig(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dpf-mcp-"));
  const path = join(dir, ".mcp.json");
  await writeFile(path, contents, "utf8");
  return path;
}

describe("expandEnvPlaceholders", () => {
  it("substitutes known variables and leaves unknown ones intact", () => {
    expect(expandEnvPlaceholders("Bearer ${TOK}", { TOK: "abc" })).toBe("Bearer abc");
    expect(expandEnvPlaceholders("Bearer ${TOK}", {})).toBe("Bearer ${TOK}");
  });
});

describe("resolveDpfMcpConfig", () => {
  it("expands the committed placeholder from the environment", async () => {
    const path = await writeConfig(MCP_JSON);
    await expect(resolveDpfMcpConfig(path, { DPF_MCP_BEARER_TOKEN: "tok-123" })).resolves.toEqual({
      url: "http://127.0.0.1:3000/api/mcp/v1",
      authorization: "Bearer tok-123",
    });
  });

  it("returns null rather than sending an unexpanded placeholder", async () => {
    const path = await writeConfig(MCP_JSON);
    await expect(resolveDpfMcpConfig(path, {})).resolves.toBeNull();
  });

  it("accepts a bare token and adds the Bearer prefix", async () => {
    const path = await writeConfig(MCP_JSON);
    const config = await resolveDpfMcpConfig(path, { DPF_MCP_TOKEN: "raw-token" });
    expect(config?.authorization).toBe("Bearer raw-token");
  });

  it("lets an explicit env URL override the file", async () => {
    const path = await writeConfig(MCP_JSON);
    const config = await resolveDpfMcpConfig(path, {
      DPF_MCP_URL: "http://elsewhere/api/mcp/v1",
      DPF_MCP_BEARER_TOKEN: "tok",
    });
    expect(config?.url).toBe("http://elsewhere/api/mcp/v1");
  });

  it("resolves from env alone when no config file exists", async () => {
    await expect(
      resolveDpfMcpConfig("/definitely/missing/.mcp.json", {
        DPF_MCP_URL: "http://127.0.0.1:3000/api/mcp/v1",
        DPF_MCP_BEARER_TOKEN: "tok",
      }),
    ).resolves.toEqual({
      url: "http://127.0.0.1:3000/api/mcp/v1",
      authorization: "Bearer tok",
    });
  });

  it("returns null when the file is malformed and env is empty", async () => {
    const path = await writeConfig("{ not json");
    await expect(resolveDpfMcpConfig(path, {})).resolves.toBeNull();
  });
});
