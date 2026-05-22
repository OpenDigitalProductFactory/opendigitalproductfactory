// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/actions/mcp-tokens", () => ({
  bulkRevokeMyMcpTokens: vi.fn(),
  copyMyMcpToken: vi.fn(),
  issueMyMcpToken: vi.fn(),
  issueMyTemplateMcpToken: vi.fn(),
  issueMyWriteMcpToken: vi.fn(),
  listAvailableMcpScopes: vi.fn(),
  listMcpTokenTemplates: vi.fn(),
  listMyMcpTokens: vi.fn(),
  revokeMyMcpToken: vi.fn(),
  rotateMyMcpToken: vi.fn(),
  rotateMyMcpTokenWithEdit: vi.fn(),
  upgradeMyMcpTokenForCodingAgent: vi.fn(),
}));

import {
  bulkRevokeMyMcpTokens,
  copyMyMcpToken,
  issueMyTemplateMcpToken,
  listAvailableMcpScopes,
  listMcpTokenTemplates,
  listMyMcpTokens,
  rotateMyMcpToken,
  rotateMyMcpTokenWithEdit,
} from "@/lib/actions/mcp-tokens";
import { McpTokenManager } from "./McpTokenManager";

const bulkRevokeMock = bulkRevokeMyMcpTokens as unknown as ReturnType<typeof vi.fn>;
const copyMock = copyMyMcpToken as unknown as ReturnType<typeof vi.fn>;
const scopesMock = listAvailableMcpScopes as unknown as ReturnType<typeof vi.fn>;
const templatesMock = listMcpTokenTemplates as unknown as ReturnType<typeof vi.fn>;
const templateIssueMock = issueMyTemplateMcpToken as unknown as ReturnType<typeof vi.fn>;
const tokensMock = listMyMcpTokens as unknown as ReturnType<typeof vi.fn>;
const rotateMock = rotateMyMcpToken as unknown as ReturnType<typeof vi.fn>;
const rotateWithEditMock = rotateMyMcpTokenWithEdit as unknown as ReturnType<typeof vi.fn>;

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
    archivedCount: 0,
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
        idleDays: 4,
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

describe("McpTokenManager — idle hygiene", () => {
  // Three tokens: one fresh-active, one stale-active (idle 14 days), one
  // revoked. The stale toggle should narrow to just the stale one; the
  // bulk-revoke action should call bulkRevokeMyMcpTokens with the right ids.
  beforeEach(() => {
    tokensMock.mockResolvedValue({
      ok: true,
      tokens: [
        {
          id: "tok_fresh",
          name: "Fresh laptop",
          prefix: "dpfmcp_FRE",
          tokenSuffix: "FRE1",
          canCopy: true,
          capability: "write",
          scope: "write",
          scopes: ["backlog_read", "backlog_write"],
          lastUsedAt: "2026-05-22T10:00:00.000Z",
          idleDays: 0,
          expiresAt: null,
          revokedAt: null,
          createdAt: "2026-05-20T10:00:00.000Z",
        },
        {
          id: "tok_stale",
          name: "Stale agent",
          prefix: "dpfmcp_STA",
          tokenSuffix: "STA1",
          canCopy: true,
          capability: "write",
          scope: "write",
          scopes: ["backlog_write"],
          lastUsedAt: "2026-05-08T10:00:00.000Z",
          idleDays: 14,
          expiresAt: null,
          revokedAt: null,
          createdAt: "2026-04-01T10:00:00.000Z",
        },
        {
          id: "tok_revoked",
          name: "Revoked token",
          prefix: "dpfmcp_REV",
          tokenSuffix: "REV1",
          canCopy: false,
          capability: "write",
          scope: "write",
          scopes: ["backlog_write"],
          lastUsedAt: null,
          idleDays: null,
          expiresAt: null,
          revokedAt: "2026-05-21T00:00:00.000Z",
          createdAt: "2026-04-01T10:00:00.000Z",
        },
      ],
    });
  });

  it("shows idle-days inline next to the last-used timestamp", async () => {
    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    expect(await screen.findByText("Stale agent")).toBeTruthy();
    // Fresh token: "(today)" annotation.
    expect(screen.getByText(/\(today\)/)).toBeTruthy();
    // Stale token: "(14d idle)" annotation.
    expect(screen.getByText(/\(14d idle\)/)).toBeTruthy();
  });

  it("flags tokens past the 7-day threshold with a stale pill", async () => {
    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    expect(await screen.findByText("Stale agent")).toBeTruthy();
    // The pill text reads "stale 14d".
    expect(screen.getByText(/stale 14d/)).toBeTruthy();
    // Fresh token must NOT carry a stale pill.
    expect(screen.queryByText(/stale 0d/)).toBeNull();
  });

  it("filters the visible list when 'Show stale only' is checked", async () => {
    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    expect(await screen.findByText("Stale agent")).toBeTruthy();
    expect(screen.getByText("Fresh laptop")).toBeTruthy();

    const toggle = screen.getByLabelText(/Show only tokens idle for at least 7 days/i);
    fireEvent.click(toggle);

    expect(screen.getByText("Stale agent")).toBeTruthy();
    expect(screen.queryByText("Fresh laptop")).toBeNull();
    expect(screen.queryByText("Revoked token")).toBeNull();
  });

  it("calls bulkRevokeMyMcpTokens with the selected ids and clears selection on success", async () => {
    bulkRevokeMock.mockResolvedValue({
      ok: true,
      results: [{ tokenId: "tok_stale", ok: true, status: "revoked" }],
      revokedCount: 1,
      failedCount: 0,
    });
    // Auto-confirm the bulk-revoke dialog.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    expect(await screen.findByText("Stale agent")).toBeTruthy();

    const checkbox = screen.getByLabelText(/Select token Stale agent for bulk revoke/i);
    fireEvent.click(checkbox);

    const bulkButton = screen.getByRole("button", { name: /Revoke 1 selected/i });
    fireEvent.click(bulkButton);

    await waitFor(() => {
      expect(bulkRevokeMock).toHaveBeenCalledWith({
        tokenIds: ["tok_stale"],
        reason: "bulk revoke from admin UI",
      });
    });
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("does not render a checkbox on revoked rows (once revealed via Show revoked)", async () => {
    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    // Revoked rows are hidden by default — flip the toggle to reveal.
    expect(await screen.findByText("Stale agent")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Show revoked tokens/i));
    expect(await screen.findByText("Revoked token")).toBeTruthy();
    expect(
      screen.queryByLabelText(/Select token Revoked token for bulk revoke/i),
    ).toBeNull();
  });
});

describe("McpTokenManager — rotate with edit", () => {
  it("opens the form pre-populated from the row and calls rotateMyMcpTokenWithEdit on submit", async () => {
    rotateWithEditMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_rotated",
      plaintext: "dpfmcp_ROT",
      prefix: "dpfmcp_ROT1",
      tokenSuffix: "ROT1",
      expiresAt: null,
      setupSnippets: {
        claudeCode: "{}",
        codex: "[mcp_servers.dpf]",
        vscode: "{}",
        syncCommand: "",
        envPowerShell: "[System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', 'dpfmcp_ROT', 'User')",
        runtimeRefreshPowerShell: "/api/mcp/token/refresh",
      },
    });

    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    expect(await screen.findByText("Mark laptop")).toBeTruthy();

    // The new affordance appears alongside the existing "Rotate token" button.
    const rotateEditBtn = screen.getByRole("button", { name: /Rotate with edit/i });
    fireEvent.click(rotateEditBtn);

    // Dialog opens in rotate mode — header copy mentions atomic rotation.
    expect(
      await screen.findByRole("heading", { name: /Rotate token with edited grants/i }),
    ).toBeTruthy();

    // Name field is pre-populated from the row.
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("Mark laptop");

    // Submit button reads "Rotate with edit" in this mode. The row button
    // has the same label — scope to the dialog to pick the right one.
    const dialog = screen.getByRole("dialog");
    const submitBtn = within(dialog).getByRole("button", { name: /^Rotate with edit$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(rotateWithEditMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenId: "tok_active",
          name: "Mark laptop",
          scope: "write",
          scopes: ["backlog_read", "backlog_write"],
          baseUrl: "http://localhost:3000",
        }),
      );
    });
  });

  it("surfaces the partial revoke warning when the old token revoke fails", async () => {
    rotateWithEditMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_rotated",
      plaintext: "dpfmcp_ROT",
      prefix: "dpfmcp_ROT1",
      tokenSuffix: "ROT1",
      expiresAt: null,
      oldTokenRevokeError: "db_locked",
      setupSnippets: {
        claudeCode: "{}",
        codex: "{}",
        vscode: "{}",
        syncCommand: "",
        envPowerShell: "[System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', 'dpfmcp_ROT', 'User')",
        runtimeRefreshPowerShell: "/api/mcp/token/refresh",
      },
    });

    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    expect(await screen.findByText("Mark laptop")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Rotate with edit/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /^Rotate with edit$/i }),
    );

    expect(
      await screen.findByText(/New token issued, but old token revoke failed/i),
    ).toBeTruthy();
    expect(screen.getByText(/db_locked/)).toBeTruthy();
  });
});

describe("McpTokenManager — revoked hide + archive footer", () => {
  beforeEach(() => {
    tokensMock.mockResolvedValue({
      ok: true,
      archivedCount: 3, // server reports 3 tokens hidden by the >90d filter
      tokens: [
        {
          id: "tok_active",
          name: "Active token",
          prefix: "dpfmcp_AC",
          tokenSuffix: "AC01",
          canCopy: true,
          capability: "write",
          scope: "write",
          scopes: ["backlog_write"],
          lastUsedAt: "2026-05-22T10:00:00.000Z",
          idleDays: 0,
          expiresAt: null,
          revokedAt: null,
          createdAt: "2026-05-20T00:00:00.000Z",
        },
        {
          id: "tok_recently_revoked",
          name: "Recently revoked",
          prefix: "dpfmcp_RV",
          tokenSuffix: "RV01",
          canCopy: false,
          capability: "write",
          scope: "write",
          scopes: ["backlog_write"],
          lastUsedAt: null,
          idleDays: null,
          expiresAt: null,
          revokedAt: "2026-05-15T00:00:00.000Z",
          createdAt: "2026-04-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("hides revoked rows by default", async () => {
    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    expect(await screen.findByText("Active token")).toBeTruthy();
    expect(screen.queryByText("Recently revoked")).toBeNull();
  });

  it("reveals revoked rows when 'Show revoked' is toggled on", async () => {
    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    expect(await screen.findByText("Active token")).toBeTruthy();
    const toggle = screen.getByLabelText(/Show revoked tokens/i);
    fireEvent.click(toggle);
    expect(screen.getByText("Recently revoked")).toBeTruthy();
  });

  it("reports the revoked-hidden count next to the toggle", async () => {
    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    expect(await screen.findByText("Active token")).toBeTruthy();
    expect(screen.getByText(/1 hidden by default/)).toBeTruthy();
  });

  it("surfaces the archive footer when the server reports archivedCount > 0", async () => {
    render(<McpTokenManager baseUrl="http://localhost:3000" />);
    expect(await screen.findByText("Active token")).toBeTruthy();
    // Footer mentions the count, the 90-day window, and the audit-replay path.
    expect(screen.getByText(/auto-archived/)).toBeTruthy();
    expect(screen.getByText(/3/)).toBeTruthy();
    expect(screen.getByText(/platform\/ai\/authority/)).toBeTruthy();
  });
});
