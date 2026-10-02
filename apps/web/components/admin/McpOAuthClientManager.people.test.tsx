// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";

vi.mock("@/lib/actions/oauth-clients", () => ({
  createOAuthCredentialsClient: vi.fn(),
  listOAuthClients: vi.fn(),
  revokeOAuthClient: vi.fn(),
  listOAuthClientPeople: vi.fn(),
  revokeOAuthClientPersonGrants: vi.fn(),
}));

import { listOAuthClientPeople, listOAuthClients } from "@/lib/actions/oauth-clients";
import { McpOAuthClientManager } from "./McpOAuthClientManager";

// BI-287D3EFD: on the live install about ten browser registrations are all
// named "Claude Code (dpf)". The People panel must say WHICH registration it
// belongs to, or an administrator can revoke someone under the wrong one.

const listMock = listOAuthClients as unknown as ReturnType<typeof vi.fn>;
const peopleMock = listOAuthClientPeople as unknown as ReturnType<typeof vi.fn>;

function browserClient(clientId: string, createdAt: string) {
  return {
    clientId,
    clientName: "Claude Code (dpf)",
    registrationKind: "dynamic",
    allowedScopes: [],
    redirectUris: [],
    selfAsserted: true,
    createdAt,
    lastUsedAt: null,
    revokedAt: null,
    liveTokenCount: 0,
  };
}

function renderManager() {
  return render(
    <MessagesProvider locale="en-US" messages={{ admin: namespaceMessages("en-US", "admin") }}>
      <McpOAuthClientManager />
    </MessagesProvider>,
  );
}

describe("McpOAuthClientManager People panel identity (BI-287D3EFD)", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    listMock.mockResolvedValue({
      ok: true,
      data: [browserClient("dpfoc_first111", "2026-09-20T10:00:00.000Z"), browserClient("dpfoc_second22", "2026-09-25T10:00:00.000Z")],
    });
    peopleMock.mockResolvedValue({ ok: true, data: [] });
  });
  afterEach(() => cleanup());

  it("names each row's People control by its client id, so same-named registrations are distinguishable", async () => {
    renderManager();
    fireEvent.click(screen.getByText(/Existing keys/));
    await screen.findByRole("table", { name: "Keys for automated tools" });
    expect(screen.getByRole("button", { name: /People connected to Claude Code \(dpf\).*dpfoc_first111/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /People connected to Claude Code \(dpf\).*dpfoc_second22/ })).toBeTruthy();
  });

  it("titles the panel with the registration's client id and date, and brings it into view", async () => {
    renderManager();
    fireEvent.click(screen.getByText(/Existing keys/));
    await screen.findByRole("table", { name: "Keys for automated tools" });
    fireEvent.click(screen.getByRole("button", { name: /dpfoc_second22/ }));

    const panel = await screen.findByRole("region", { name: /dpfoc_second22/ });
    expect(within(panel).getByText(/Client id dpfoc_second22, registered/)).toBeTruthy();
    expect(within(panel).queryByText(/dpfoc_first111/)).toBeNull();
    expect(peopleMock).toHaveBeenCalledWith({ clientId: "dpfoc_second22" });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("keeps the row actions reachable on a narrow screen by letting the wide table scroll sideways", async () => {
    renderManager();
    fireEvent.click(screen.getByText(/Existing keys/));
    const table = await screen.findByRole("table", { name: "Keys for automated tools" });
    expect(table.parentElement?.className).toMatch(/overflow-x-auto/);
  });
});
