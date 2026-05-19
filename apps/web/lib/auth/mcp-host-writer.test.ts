import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Must mock 'fs' before importing the module under test
vi.mock("fs");

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

  it("swallows write errors without propagating", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

    expect(() => writeMcpJsonToHost(TOKEN, BASE)).not.toThrow();
  });
});
