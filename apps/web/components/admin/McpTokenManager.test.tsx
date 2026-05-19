// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/actions/mcp-tokens", () => ({
  copyMyMcpToken: vi.fn(),
  issueMyMcpToken: vi.fn(),
  listAvailableMcpScopes: vi.fn(),
  listMyMcpTokens: vi.fn(),
  revokeMyMcpToken: vi.fn(),
  rotateMyMcpToken: vi.fn(),
  upgradeMyMcpTokenForCodingAgent: vi.fn(),
}));

import {
  copyMyMcpToken,
  listAvailableMcpScopes,
  listMyMcpTokens,
  rotateMyMcpToken,
} from "@/lib/actions/mcp-tokens";
import { McpTokenManager } from "./McpTokenManager";

const copyMock = copyMyMcpToken as unknown as ReturnType<typeof vi.fn>;
const scopesMock = listAvailableMcpScopes as unknown as ReturnType<typeof vi.fn>;
const tokensMock = listMyMcpTokens as unknown as ReturnType<typeof vi.fn>;
const rotateMock = rotateMyMcpToken as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  scopesMock.mockResolvedValue({
    scopes: ["backlog_read", "backlog_write", "spec_plan_read"],
  });
  tokensMock.mockResolvedValue({
    ok: true,
    tokens: [
      {
        id: "tok_active",
        name: "Mark laptop",
        prefix: "dpfmcp_MAR",
        tokenSuffix: "A1B2",
        canCopy: true,
        capability: "write",
        scopes: ["backlog_read", "backlog_write"],
        lastUsedAt: "2026-05-18T12:00:00.000Z",
        expiresAt: null,
        revokedAt: null,
        createdAt: "2026-05-18T10:00:00.000Z",
      },
    ],
  });
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("McpTokenManager", () => {
  it("shows active token suffix, scope, issued time, last-used time, and lifecycle actions", async () => {
    render(
      <McpTokenManager
        contributionModelConfigured={true}
        baseUrl="http://localhost:3000"
      />,
    );

    expect(await screen.findByText("Mark laptop")).toBeTruthy();
    expect(screen.getByText("...A1B2")).toBeTruthy();
    expect(screen.getByText(/backlog_read, backlog_write/)).toBeTruthy();
    expect(screen.getByText(/Issued:/)).toBeTruthy();
    expect(screen.getByText(/Last used:/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy current token/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Rotate token/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Revoke/i })).toBeTruthy();
  });

  it("copies a recoverable current token without reissuing it", async () => {
    copyMock.mockResolvedValue({
      ok: true,
      plaintext: "dpfmcp_COPYABLE",
      prefix: "dpfmcp_COPY",
      tokenSuffix: "A1B2",
      setupSnippets: {
        claudeCode: '{"mcpServers":{"dpf":{"headers":{"Authorization":"Bearer dpfmcp_COPYABLE"}}}}',
        codex: '{"mcpServers":{"dpf":{"headers":{"Authorization":"Bearer dpfmcp_COPYABLE"}}}}',
        vscode: '{"servers":{"dpf":{"headers":{"Authorization":"Bearer dpfmcp_COPYABLE"}}}}',
        syncCommand: ".\\scripts\\seed-worktree-mcp.ps1",
      },
    });

    render(
      <McpTokenManager
        contributionModelConfigured={true}
        baseUrl="http://localhost:3000"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Copy current token/i }));

    await waitFor(() => {
      expect(copyMock).toHaveBeenCalledWith({
        tokenId: "tok_active",
        baseUrl: "http://localhost:3000",
      });
    });
    expect(await screen.findByText(/Current token copied/i)).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("dpfmcp_COPYABLE");
  });

  it("rotates an active token and presents the replacement token immediately", async () => {
    rotateMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_new",
      plaintext: "dpfmcp_ROTATED",
      prefix: "dpfmcp_ROTA",
      tokenSuffix: "C3D4",
      expiresAt: null,
      setupSnippets: {
        claudeCode: '{"mcpServers":{"dpf":{"headers":{"Authorization":"Bearer dpfmcp_ROTATED"}}}}',
        codex: '{"mcpServers":{"dpf":{"headers":{"Authorization":"Bearer dpfmcp_ROTATED"}}}}',
        vscode: '{"servers":{"dpf":{"headers":{"Authorization":"Bearer dpfmcp_ROTATED"}}}}',
        syncCommand: ".\\scripts\\seed-worktree-mcp.ps1",
      },
    });

    render(
      <McpTokenManager
        contributionModelConfigured={true}
        baseUrl="http://localhost:3000"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Rotate token/i }));

    await waitFor(() => {
      expect(rotateMock).toHaveBeenCalledWith({
        tokenId: "tok_active",
        baseUrl: "http://localhost:3000",
      });
    });
    expect(await screen.findByText(/Replacement token issued/i)).toBeTruthy();
    expect(screen.getByText("dpfmcp_ROTATED")).toBeTruthy();
  });
});
