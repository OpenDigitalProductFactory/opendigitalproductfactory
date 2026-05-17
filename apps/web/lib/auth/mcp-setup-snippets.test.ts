import { describe, expect, it } from "vitest";
import { buildSetupSnippets } from "./mcp-setup-snippets";

const BASE = "http://localhost:3000";
const TOKEN = "dpfmcp_TESTTOKEN";

describe("buildSetupSnippets", () => {
  it("claudeCode has mcpServers.dpf with http type, correct url, and auth header", () => {
    const { claudeCode } = buildSetupSnippets(TOKEN, BASE);
    const parsed = JSON.parse(claudeCode) as Record<string, unknown>;
    const dpf = (parsed.mcpServers as Record<string, unknown>).dpf as Record<string, unknown>;
    expect(dpf.type).toBe("http");
    expect(dpf.url).toBe(`${BASE}/api/mcp/v1`);
    expect((dpf.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("vscode has servers.dpf (not mcpServers) with the same http entry", () => {
    const { vscode } = buildSetupSnippets(TOKEN, BASE);
    const parsed = JSON.parse(vscode) as Record<string, unknown>;
    expect("mcpServers" in parsed).toBe(false);
    const dpf = (parsed.servers as Record<string, unknown>).dpf as Record<string, unknown>;
    expect(dpf.type).toBe("http");
    expect(dpf.url).toBe(`${BASE}/api/mcp/v1`);
    expect((dpf.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("codex is identical to claudeCode", () => {
    const { claudeCode, codex } = buildSetupSnippets(TOKEN, BASE);
    expect(codex).toBe(claudeCode);
  });

  it("auth header embeds the full plaintext token", () => {
    const t = "dpfmcp_UNIQUETOKEN";
    const { claudeCode } = buildSetupSnippets(t, BASE);
    expect(claudeCode).toContain(t);
  });

  it("constructs the url from a non-localhost baseUrl", () => {
    const { claudeCode } = buildSetupSnippets(TOKEN, "https://dpf.example.com");
    expect(claudeCode).toContain("https://dpf.example.com/api/mcp/v1");
  });

  it("output is valid JSON for all three formats", () => {
    const { claudeCode, codex, vscode } = buildSetupSnippets(TOKEN, BASE);
    expect(() => JSON.parse(claudeCode)).not.toThrow();
    expect(() => JSON.parse(codex)).not.toThrow();
    expect(() => JSON.parse(vscode)).not.toThrow();
  });
});
