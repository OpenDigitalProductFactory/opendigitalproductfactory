// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DialogHost } from "@/components/ui/Dialog";

vi.mock("@/lib/actions/oauth-clients", () => ({
  createOAuthCredentialsClient: vi.fn(),
  listOAuthClients: vi.fn(),
  revokeOAuthClient: vi.fn(),
}));

import { createOAuthCredentialsClient, listOAuthClients, revokeOAuthClient } from "@/lib/actions/oauth-clients";
import { McpOAuthClientManager } from "./McpOAuthClientManager";

const listMock = listOAuthClients as unknown as ReturnType<typeof vi.fn>;
const createMock = createOAuthCredentialsClient as unknown as ReturnType<typeof vi.fn>;
const revokeMock = revokeOAuthClient as unknown as ReturnType<typeof vi.fn>;

function client(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    clientId: "dpfoc_abc123",
    clientName: "CI runner",
    registrationKind: "credentials",
    allowedScopes: ["dpf.read", "dpf.work"],
    redirectUris: [],
    selfAsserted: false,
    createdAt: "2026-09-18T04:00:00.000Z",
    lastUsedAt: "2026-09-18T05:00:00.000Z",
    revokedAt: null,
    liveTokenCount: 2,
    ...overrides,
  };
}

describe("McpOAuthClientManager (BI-EDB67A2B)", () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ ok: true, data: [client()] });
    createMock.mockReset();
    revokeMock.mockReset();
  });
  afterEach(() => cleanup());

  it("lists registered clients with kind, scopes, live tokens and status", async () => {
    render(<McpOAuthClientManager />);
    const table = await screen.findByRole("table", { name: "MCP OAuth clients" });
    expect(within(table).getByText("CI runner")).toBeTruthy();
    expect(within(table).getByText("Headless")).toBeTruthy();
    expect(within(table).getByText("dpf.read, dpf.work")).toBeTruthy();
    expect(within(table).getByText("Active")).toBeTruthy();
  });

  it("creates a headless client and shows the one-time secret with the credentials-file command", async () => {
    createMock.mockResolvedValue({ ok: true, data: { clientId: "dpfoc_new", clientSecret: "sekret", scopes: ["dpf.read", "dpf.work"] } });
    render(<McpOAuthClientManager />);
    await screen.findByRole("table", { name: "MCP OAuth clients" });

    fireEvent.click(screen.getByRole("button", { name: "Create headless client" }));
    const form = screen.getByRole("form", { name: "Create headless client" });
    fireEvent.change(within(form).getByLabelText(/Client name/), { target: { value: "Laptop gate" } });
    fireEvent.click(within(form).getByLabelText(/Do governed work/));
    fireEvent.click(within(form).getByRole("button", { name: "Create client" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ clientName: "Laptop gate", scopes: ["dpf.read", "dpf.work"] }));
    const region = await screen.findByRole("region", { name: "New client credentials" });
    expect(within(region).getByText("dpfoc_new")).toBeTruthy();
    expect(within(region).getByText("sekret")).toBeTruthy();
    expect(within(region).getByText(/shown once/)).toBeTruthy();
    expect(within(region).getByText(/mcp-client-credentials\.json/, { selector: "code" })).toBeTruthy();
  });

  it("surfaces a refused creation inline instead of pretending", async () => {
    createMock.mockResolvedValue({ ok: false, error: "You do not have permission to manage MCP clients." });
    render(<McpOAuthClientManager />);
    await screen.findByRole("table", { name: "MCP OAuth clients" });
    fireEvent.click(screen.getByRole("button", { name: "Create headless client" }));
    const form = screen.getByRole("form", { name: "Create headless client" });
    fireEvent.change(within(form).getByLabelText(/Client name/), { target: { value: "x" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create client" }));
    expect(await screen.findByText("You do not have permission to manage MCP clients.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "New client credentials" })).toBeNull();
  });

  it("revokes only after the operator confirms, and reports revoked tokens", async () => {
    revokeMock.mockResolvedValue({ ok: true, data: { revokedTokens: 2 } });
    render(
      <>
        <DialogHost />
        <McpOAuthClientManager />
      </>,
    );
    await screen.findByRole("table", { name: "MCP OAuth clients" });
    fireEvent.click(screen.getByRole("button", { name: "Revoke CI runner" }));
    // In-app confirm dialog: assert on its copy, confirm via the stable DOM ref.
    await screen.findByText("Revoke client");
    expect(screen.getByText(/2 live access tokens will stop working immediately/)).toBeTruthy();
    fireEvent.click(document.querySelector('[data-dialog-action="confirm"]')!);
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith({ clientId: "dpfoc_abc123" }));
    expect(await screen.findByText(/Revoked CI runner \(2 live tokens revoked\)/)).toBeTruthy();
  });

  it("hides the revoke action on an already revoked client", async () => {
    listMock.mockResolvedValue({ ok: true, data: [client({ revokedAt: "2026-09-18T06:00:00.000Z", liveTokenCount: 0 })] });
    render(<McpOAuthClientManager />);
    const table = await screen.findByRole("table", { name: "MCP OAuth clients" });
    expect(within(table).getByText("Revoked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revoke CI runner" })).toBeNull();
  });
});
