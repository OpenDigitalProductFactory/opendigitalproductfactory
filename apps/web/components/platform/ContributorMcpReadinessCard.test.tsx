// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/mcp-tokens", () => ({
  getMyContributorMcpReadiness: vi.fn(),
  issueMyWriteMcpToken: vi.fn(),
  rotateMyMcpTokenWithEdit: vi.fn(),
}));

vi.mock("@/components/ui/LocalTime", () => ({
  LocalTime: ({ value }: { value: string | null }) => (
    <span data-testid="local-time">{value ?? "never"}</span>
  ),
}));

import {
  getMyContributorMcpReadiness,
  issueMyWriteMcpToken,
  rotateMyMcpTokenWithEdit,
} from "@/lib/actions/mcp-tokens";
import type { ContributorMcpReadiness } from "@/lib/mcp/contributor-readiness";
import { ContributorMcpReadinessCard } from "./ContributorMcpReadinessCard";

const getReadinessMock = getMyContributorMcpReadiness as unknown as ReturnType<typeof vi.fn>;
const issueMock = issueMyWriteMcpToken as unknown as ReturnType<typeof vi.fn>;
const rotateMock = rotateMyMcpTokenWithEdit as unknown as ReturnType<typeof vi.fn>;

const setupSnippets = {
  claudeCode: '{"mcpServers":{"dpf":{"headers":{"Authorization":"Bearer ${DPF_MCP_BEARER_TOKEN}"}}}}',
  codex: '[mcp_servers.dpf]\nbearer_token_env_var = "DPF_MCP_BEARER_TOKEN"',
  vscode: '{"servers":{"dpf":{"headers":{"Authorization":"Bearer ${env:DPF_MCP_BEARER_TOKEN}"}}}}',
  syncCommand: ".\\scripts\\sync-mcp-worktrees.ps1",
  envPowerShell:
    "[System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', 'dpfmcp_NEW', 'User')",
  runtimeRefreshPowerShell:
    "Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/mcp/token/refresh'",
};

function readiness(overrides: Partial<ContributorMcpReadiness> = {}): ContributorMcpReadiness {
  return {
    status: "ready",
    recommendedAction: "test_connection",
    identityBinding: "not_available",
    token: {
      id: "tok_ready",
      name: "Development token",
      prefix: "dpfmcp_DEV",
      tokenSuffix: "R3AD",
      scope: "write",
      scopes: ["backlog_write", "work_capsule_write"],
      lastUsedAt: "2026-05-26T12:00:00.000Z",
      expiresAt: "2026-08-24T12:00:00.000Z",
    },
    missingGrants: [],
    requiredGrants: ["backlog_write", "work_capsule_write"],
    recommendedScopes: ["backlog_write", "work_capsule_write", "sandbox_execute"],
    probe: { status: "not_run" },
    ...overrides,
  };
}

function renderCard(initialReadiness: ContributorMcpReadiness, canWrite = true) {
  return render(
    <ContributorMcpReadinessCard
      initialReadiness={initialReadiness}
      baseUrl="http://localhost:3000"
      canWrite={canWrite}
    />,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  issueMock.mockResolvedValue({
    ok: true,
    tokenId: "tok_new",
    plaintext: "dpfmcp_NEW",
    prefix: "dpfmcp_NEW",
    tokenSuffix: "N3W",
    expiresAt: "2026-08-24T12:00:00.000Z",
    setupSnippets,
  });
  rotateMock.mockResolvedValue({
    ok: true,
    tokenId: "tok_rotated",
    plaintext: "dpfmcp_ROTATED",
    prefix: "dpfmcp_ROT",
    tokenSuffix: "R0T",
    expiresAt: "2026-08-24T12:00:00.000Z",
    setupSnippets,
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("ContributorMcpReadinessCard", () => {
  it("delegates token timestamps to the hydration-safe local time renderer", () => {
    renderCard(readiness());

    expect(screen.getAllByTestId("local-time").map((node) => node.textContent)).toEqual([
      "2026-05-26T12:00:00.000Z",
      "2026-08-24T12:00:00.000Z",
    ]);
  });

  it("shows a quiet ready state with a test connection action", () => {
    renderCard(readiness());

    expect(screen.getByText(/Claude Code and Codex can use DPF MCP/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Test connection/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Issue development token/i })).toBeNull();
  });

  it("runs a live probe for ready tokens", async () => {
    getReadinessMock.mockResolvedValue({
      ok: true,
      readiness: readiness({
        probe: {
          status: "success",
          checkedAt: "2026-05-26T12:01:00.000Z",
          toolCount: 12,
        },
      }),
    });

    renderCard(readiness());
    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));

    await waitFor(() => {
      expect(getReadinessMock).toHaveBeenCalledWith({
        probe: true,
      });
    });
    expect(await screen.findByText(/Probe returned 12 MCP tools/i)).toBeTruthy();
  });

  it("offers exactly one primary issue action when no contributor token is ready", () => {
    renderCard(
      readiness({
        status: "needs_authorization",
        recommendedAction: "issue_development_token",
        token: null,
      }),
    );

    expect(screen.getAllByRole("button", { name: /Issue development token/i })).toHaveLength(1);
    expect(screen.getByText(/No usable development token yet/i)).toBeTruthy();
  });

  it("describes read-only tokens without claiming missing zero grants", () => {
    renderCard(
      readiness({
        status: "needs_grants",
        recommendedAction: "rotate_development_token",
        missingGrants: [],
        token: {
          ...readiness().token!,
          scope: "read",
        },
      }),
    );

    expect(screen.getByText(/Current token is read-only/i)).toBeTruthy();
    expect(screen.queryByText(/missing 0 grants/i)).toBeNull();
  });

  it("uses the existing issue action for missing or unusable tokens and shows setup snippets", async () => {
    renderCard(
      readiness({
        status: "needs_reissue",
        recommendedAction: "issue_development_token",
        token: null,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Issue development token/i }));

    await waitFor(() => {
      expect(issueMock).toHaveBeenCalledWith({ baseUrl: "http://localhost:3000" });
    });
    expect(await screen.findByText(/New token issued/i)).toBeTruthy();
    expect(screen.getByText("Session refresh")).toBeTruthy();
    expect(screen.getByText(setupSnippets.runtimeRefreshPowerShell)).toBeTruthy();
  });

  it("rotates an under-granted token with the recommended development grants", async () => {
    renderCard(
      readiness({
        status: "needs_grants",
        recommendedAction: "rotate_development_token",
        missingGrants: ["sandbox_execute"],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Rotate development token/i }));

    await waitFor(() => {
      expect(rotateMock).toHaveBeenCalledWith({
        tokenId: "tok_ready",
        name: "Development token",
        scope: "write",
        scopes: ["backlog_write", "work_capsule_write", "sandbox_execute"],
        expiresInDays: 90,
        baseUrl: "http://localhost:3000",
      });
    });
    expect(await screen.findByText(/New token issued/i)).toBeTruthy();
    expect(screen.getByText("Codex config")).toBeTruthy();
    expect(screen.getByText(/bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"/)).toBeTruthy();
  });
});
