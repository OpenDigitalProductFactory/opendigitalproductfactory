// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/actions/mcp-tokens", () => ({
  copyMyMcpToken: vi.fn(),
  issueMyMcpToken: vi.fn(),
  issueMyTemplateMcpToken: vi.fn(),
  issueMyWriteMcpToken: vi.fn(),
  listAvailableMcpScopes: vi.fn(),
  listMcpTokenTemplates: vi.fn(),
  listMyMcpTokens: vi.fn(),
  revokeMyMcpToken: vi.fn(),
  rotateMyMcpToken: vi.fn(),
  upgradeMyMcpTokenForCodingAgent: vi.fn(),
}));

import {
  copyMyMcpToken,
  issueMyTemplateMcpToken,
  listAvailableMcpScopes,
  listMcpTokenTemplates,
  listMyMcpTokens,
  rotateMyMcpToken,
} from "@/lib/actions/mcp-tokens";
import { McpTokenManager } from "./McpTokenManager";

const copyMock = copyMyMcpToken as unknown as ReturnType<typeof vi.fn>;
const scopesMock = listAvailableMcpScopes as unknown as ReturnType<typeof vi.fn>;
const templatesMock = listMcpTokenTemplates as unknown as ReturnType<typeof vi.fn>;
const templateIssueMock = issueMyTemplateMcpToken as unknown as ReturnType<typeof vi.fn>;
const tokensMock = listMyMcpTokens as unknown as ReturnType<typeof vi.fn>;
const rotateMock = rotateMyMcpToken as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  scopesMock.mockResolvedValue({
    scopes: ["backlog_read", "backlog_write", "spec_plan_read"],
  });
  templatesMock.mockResolvedValue({
    templates: [
      {
        id: "admin",
        label: "Admin",
        category: "admin",
        tier: "admin",
        description: "Full platform admin",
        grants: ["admin_read", "admin_write", "backlog_read"],
      },
      {
        id: "development",
        label: "Development",
        category: "development",
        tier: "write",
        description: "Coding agent + sandbox + iac",
        grants: ["backlog_read", "backlog_write", "sandbox_execute", "iac_execute"],
      },
      {
        id: "employee_finance",
        label: "Employee — Finance",
        category: "employee",
        tier: "write",
        description: "Finance human or coworker",
        grants: ["financial_report_create", "backlog_read"],
      },
      {
        id: "observer",
        label: "Read-only observer",
        category: "observer",
        tier: "read",
        description: "Every *_read grant",
        grants: ["backlog_read", "spec_plan_read"],
      },
      {
        id: "custom",
        label: "Custom",
        category: "custom",
        tier: "read",
        description: "Pick scopes manually",
        grants: [],
      },
    ],
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
        scope: "write",
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
    render(<McpTokenManager baseUrl="http://localhost:3000" />);

    expect(await screen.findByText("Mark laptop")).toBeTruthy();
    expect(screen.getByText("dpfmcp_MAR...A1B2")).toBeTruthy();
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
        envPowerShell: "[System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', 'dpfmcp_COPYABLE', 'User')",
        runtimeRefreshPowerShell: "Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/mcp/token/refresh' -ContentType 'application/json' -Body '{\"token\":\"dpfmcp_COPYABLE\"}'",
      },
    });

    render(<McpTokenManager baseUrl="http://localhost:3000" />);
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

  it("shows the recoverable current token when clipboard access is blocked", async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("clipboard blocked"),
    );
    copyMock.mockResolvedValue({
      ok: true,
      plaintext: "dpfmcp_COPYABLE",
      prefix: "dpfmcp_COPY",
      tokenSuffix: "A1B2",
      setupSnippets: {
        claudeCode: '{"mcpServers":{"dpf":{"headers":{"Authorization":"Bearer ${DPF_MCP_BEARER_TOKEN}"}}}}',
        codex: '[mcp_servers.dpf]\nbearer_token_env_var = "DPF_MCP_BEARER_TOKEN"',
        vscode: '{"servers":{"dpf":{"headers":{"Authorization":"Bearer ${env:DPF_MCP_BEARER_TOKEN}"}}}}',
        syncCommand: ".\\scripts\\seed-worktree-mcp.ps1",
        envPowerShell: "[System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', 'dpfmcp_COPYABLE', 'User')",
        runtimeRefreshPowerShell: "Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/mcp/token/refresh' -ContentType 'application/json' -Body '{\"token\":\"dpfmcp_COPYABLE\"}'",
      },
    });

    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    fireEvent.click(await screen.findByRole("button", { name: /Copy current token/i }));

    expect(await screen.findByRole("heading", { name: "Current token" })).toBeTruthy();
    expect(screen.getByText(/Clipboard access was blocked/i)).toBeTruthy();
    expect(screen.getByText("dpfmcp_COPYABLE")).toBeTruthy();

    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("clipboard blocked again"),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
    expect(await screen.findByText("Clipboard blocked")).toBeTruthy();
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
        envPowerShell: "[System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', 'dpfmcp_ROTATED', 'User')",
        runtimeRefreshPowerShell: "Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/mcp/token/refresh' -ContentType 'application/json' -Body '{\"token\":\"dpfmcp_ROTATED\"}'",
      },
    });

    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    fireEvent.click(await screen.findByRole("button", { name: /Rotate token/i }));

    await waitFor(() => {
      expect(rotateMock).toHaveBeenCalledWith({
        tokenId: "tok_active",
        baseUrl: "http://localhost:3000",
      });
    });
    expect(await screen.findByText(/Replacement token issued/i)).toBeTruthy();
    expect(screen.getByText("dpfmcp_ROTATED")).toBeTruthy();
    expect(screen.getByText(/SetEnvironmentVariable/)).toBeTruthy();
    expect(screen.getByText(/api\/mcp\/token\/refresh/)).toBeTruthy();
  });

  it("renames the legacy one-click affordance to 'Issue development token'", async () => {
    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    expect(await screen.findByRole("button", { name: /Issue development token/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Issue write token/i })).toBeNull();
  });

  it("opens the template picker modal and issues a finance-employee token via the template action", async () => {
    templateIssueMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_fin",
      plaintext: "dpfmcp_FIN",
      prefix: "dpfmcp_FIN1",
      tokenSuffix: "FIN1",
      expiresAt: null,
      setupSnippets: {
        claudeCode: "{}",
        codex: "[mcp_servers.dpf]",
        vscode: "{}",
        syncCommand: "",
        envPowerShell: "[System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', 'dpfmcp_FIN', 'User')",
        runtimeRefreshPowerShell: "Invoke-RestMethod /api/mcp/token/refresh dpfmcp_FIN",
      },
    });

    render(<McpTokenManager baseUrl="http://localhost:3000" />);

    fireEvent.click(await screen.findByRole("button", { name: /Issue token from template/i }));
    expect(await screen.findByRole("heading", { name: /Issue MCP token/i })).toBeTruthy();

    // Pick the finance template (template picker is the first combobox in the dialog)
    const templateSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    fireEvent.change(templateSelect, { target: { value: "employee_finance" } });
    // Active template description is visible
    expect(screen.getByText(/Finance human or coworker/)).toBeTruthy();
    // Grant chip for financial_report_create renders
    expect(screen.getByText("financial_report_create")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/Employee — Finance/i), {
      target: { value: "Finance coworker" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Issue token$/i }));

    await waitFor(() => {
      expect(templateIssueMock).toHaveBeenCalledWith({
        templateId: "employee_finance",
        name: "Finance coworker",
        expiresInDays: 90,
        baseUrl: "http://localhost:3000",
      });
    });
  });
});
