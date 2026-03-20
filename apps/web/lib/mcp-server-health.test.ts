import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConnectionConfig } from "./mcp-server-types";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { checkMcpServerHealth } from "./mcp-server-health";

describe("checkMcpServerHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("http transport", () => {
    it("returns healthy when server responds with initialized", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", result: { protocolVersion: "2024-11-05" } }),
      } as Response);

      const result = await checkMcpServerHealth({ transport: "http", url: "https://mcp.example.com" });
      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns unhealthy on fetch error", async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error("Connection refused"));

      const result = await checkMcpServerHealth({ transport: "http", url: "https://mcp.example.com" });
      expect(result.healthy).toBe(false);
      expect(result.error).toContain("Connection refused");
    });

    it("returns unhealthy on non-ok HTTP response", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

      const result = await checkMcpServerHealth({ transport: "http", url: "https://mcp.example.com" });
      expect(result.healthy).toBe(false);
      expect(result.error).toContain("500");
    });
  });

  describe("sse transport", () => {
    it("uses HTTP POST for health check (same as http transport)", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", result: { protocolVersion: "2024-11-05" } }),
      } as Response);

      const result = await checkMcpServerHealth({ transport: "sse", url: "https://mcp.example.com/sse" });
      expect(result.healthy).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://mcp.example.com/sse",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("serverless detection", () => {
    it("rejects stdio transport on serverless runtime", async () => {
      vi.stubEnv("VERCEL", "1");
      const result = await checkMcpServerHealth({ transport: "stdio", command: "npx" });
      expect(result.healthy).toBe(false);
      expect(result.error).toContain("serverless");
      vi.unstubAllEnvs();
    });
  });
});
