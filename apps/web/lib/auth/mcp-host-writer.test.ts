import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Must mock 'fs' before importing the module under test.
// Also mock "node:fs" because the implementation now uses the lazy wrappers
// (which import "node:fs" internally) to keep the source tree clean for
// sandbox Edge analysis / next install.
vi.mock("fs");
vi.mock("node:fs");

import fs from "fs";
import { writeMcpJsonToHost } from "./mcp-host-writer";

const TOKEN = "dpfmcp_TESTPLAINTEXT";
const BASE = "http://localhost:3000";

describe("writeMcpJsonToHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no-ops when /host-dpf does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    writeMcpJsonToHost(TOKEN, BASE);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it("writes .mcp.json with mcpServers.dpf and env-backed bearer header", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

    writeMcpJsonToHost(TOKEN, BASE);

    const firstCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(firstCall[0]).toBe("/host-dpf/.mcp.json");
    const parsed = JSON.parse(firstCall[1] as string) as Record<string, unknown>;
    const dpf = (parsed.mcpServers as Record<string, unknown>).dpf as Record<string, unknown>;
    expect((dpf.headers as Record<string, string>).Authorization).toBe("Bearer ${DPF_MCP_BEARER_TOKEN}");
    expect(firstCall[1]).not.toContain(TOKEN);
  });

  it("writes .vscode/mcp.json with servers key (not mcpServers)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

    writeMcpJsonToHost(TOKEN, BASE);

    const secondCall = vi.mocked(fs.writeFileSync).mock.calls[1];
    expect(secondCall[0]).toBe("/host-dpf/.vscode/mcp.json");
    const parsed = JSON.parse(secondCall[1] as string) as Record<string, unknown>;
    expect("mcpServers" in parsed).toBe(false);
    expect("servers" in parsed).toBe(true);
  });

  it("creates .vscode dir if absent", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => p === "/host-dpf");
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

    writeMcpJsonToHost(TOKEN, BASE);

    expect(fs.mkdirSync).toHaveBeenCalledWith("/host-dpf/.vscode", { recursive: true });
  });

  // BI-5201141C (design 12.4.4): on https the dpf-platform plugin's URL-only
  // connector is the one Claude Code connector. A project .mcp.json at another
  // URL loads beside it (Claude Code de-duplicates by endpoint), so in OAuth
  // mode the host writer writes nothing.
  it("writes nothing on an https install in OAuth mode (the plugin owns the connector)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

    writeMcpJsonToHost(TOKEN, "https://localhost");

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it("still writes the compatibility config in explicit legacy mode", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

    writeMcpJsonToHost(TOKEN, "https://localhost", "legacy");

    const firstCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(firstCall[0]).toBe("/host-dpf/.mcp.json");
    expect(firstCall[1]).toContain("Bearer ${DPF_MCP_BEARER_TOKEN}");
  });

  // BI-DE1E6485 (design 2026-10-07 §5.3 step 5): when the install folder
  // enables the dpf-platform plugin, its connector covers the folder, so a
  // project `dpf` entry would be the duplicate the updater retires.
  it("writes no .mcp.json dpf entry when the folder enables the dpf-platform plugin", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(((path: string) => {
      if (path === "/host-dpf/.claude/settings.json") {
        return JSON.stringify({ enabledPlugins: { "dpf-platform@dpf-platform-local": true } });
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }) as never);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

    writeMcpJsonToHost(TOKEN, BASE);

    const written = vi.mocked(fs.writeFileSync).mock.calls.map((call) => call[0]);
    expect(written).not.toContain("/host-dpf/.mcp.json");
    expect(written).toContain("/host-dpf/.vscode/mcp.json");
  });

  it("still writes .mcp.json when the plugin is installed but disabled for the folder", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(((path: string) => {
      if (path === "/host-dpf/.claude/settings.local.json") {
        return JSON.stringify({ enabledPlugins: { "dpf-platform@dpf-platform-local": false } });
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }) as never);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

    writeMcpJsonToHost(TOKEN, BASE);

    expect(vi.mocked(fs.writeFileSync).mock.calls[0]?.[0]).toBe("/host-dpf/.mcp.json");
  });

  it("swallows write errors without propagating", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

    expect(() => writeMcpJsonToHost(TOKEN, BASE)).not.toThrow();
  });
});
