// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";

vi.mock("@/lib/actions/oauth-clients", () => ({
  listAccountAgentAccessAction: vi.fn(),
  endAccountAgentAccessAction: vi.fn(),
}));
const prompt = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/Dialog", () => ({ promptDialog: prompt }));

import { endAccountAgentAccessAction, listAccountAgentAccessAction } from "@/lib/actions/oauth-clients";
import type { AccountAgentAccess } from "@/lib/auth/account-agent-access";
import { AccountAgentAccessPanel } from "./AccountAgentAccessPanel";

// BI-DB506554: the operator could not find what a handed-over account still
// held. One panel lists all of it for one account and ends it with a reason.

const listMock = listAccountAgentAccessAction as unknown as ReturnType<typeof vi.fn>;
const endMock = endAccountAgentAccessAction as unknown as ReturnType<typeof vi.fn>;
// The full web suite runs these beside hundreds of files; the default 1s wait is too tight there.
const SLOW = { timeout: 5000 };

function adminView(overrides: Partial<AccountAgentAccess> = {}): AccountAgentAccess {
  return {
    account: { userId: "u-admin", email: "admin@dpf.local", isActive: true, workHandedOverAt: "2026-10-01T02:00:00.000Z", isYou: false },
    personalTokens: [{ id: "t1", name: "laptop", prefix: "dpfmcp_GRV0B", tokenSuffix: "a1b2", kind: "operator", lastUsedAt: null, expiresAt: null, createdAt: "2026-09-01T00:00:00.000Z" }],
    clientGrants: [{ clientId: "dpfoc_codex", clientName: "Codex", liveAccessTokens: 1, liveRefreshGrants: 1, lastUsedAt: null }],
    ownedCredentialsClients: [{ clientId: "dpfoc_grok", clientName: "DPF Grok connection", lastUsedAt: "2026-10-27T10:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z" }],
    totals: { personalTokens: 1, oauthAccessTokens: 1, refreshGrants: 1, credentialsClients: 1 },
    ...overrides,
  };
}

/** The end control, once the load that rendered it has finished and it accepts a click. */
async function enabledEndButton() {
  const button = await screen.findByRole("button", { name: "End this account's agent access" }, SLOW);
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false), SLOW);
  return button;
}

function renderPanel(initialAccount?: string) {
  return render(
    <MessagesProvider locale="en-US" messages={{ admin: namespaceMessages("en-US", "admin") }}>
      <AccountAgentAccessPanel initialAccount={initialAccount} />
    </MessagesProvider>,
  );
}

describe("AccountAgentAccessPanel", () => {
  beforeEach(() => {
    listMock.mockReset().mockResolvedValue({ ok: true, data: adminView() });
    endMock.mockReset();
    prompt.mockReset();
  });
  afterEach(() => cleanup());

  it("opens on the linked account and lists everything it holds", async () => {
    renderPanel("admin@dpf.local");
    await screen.findByText(/Work handed over/, {}, SLOW);
    expect(listMock).toHaveBeenCalledWith({ account: "admin@dpf.local" });
    expect(within(screen.getByRole("table", { name: "Personal tokens" })).getByText("dpfmcp_GRV0B…a1b2")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Connected apps" })).getByText("dpfoc_codex")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Automated-tool keys it owns" })).getByText("DPF Grok connection")).toBeTruthy();
    expect(screen.queryByText(/accountAgentAccess\./)).toBeNull();
  });

  it("looks up an account typed by the operator", async () => {
    renderPanel();
    expect(listMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Account email/), { target: { value: "admin@dpf.local" } });
    fireEvent.click(screen.getByRole("button", { name: "Show access" }));
    await waitFor(() => expect(listMock).toHaveBeenCalledWith({ account: "admin@dpf.local" }));
  });

  it("ends the account's access with the reason the operator gives, then shows what remains", async () => {
    prompt.mockResolvedValue("Work handed over");
    endMock.mockResolvedValue({ ok: true, data: { revokedAccessTokens: 2, revokedRefreshTokens: 1, revokedCredentialsClients: 1 } });
    renderPanel("admin@dpf.local");
    fireEvent.click(await enabledEndButton());

    await waitFor(() => expect(endMock).toHaveBeenCalledWith({ userId: "u-admin", reason: "Work handed over" }), SLOW);
    expect(prompt.mock.calls[0][0]).toMatchObject({ tone: "danger", required: true });
    expect(prompt.mock.calls[0][0].message).toContain("admin@dpf.local");
    expect(await screen.findByText(/Ended admin@dpf.local's agent access: 2 token\(s\), 1 sign-in grant\(s\) and 1 automated-tool key\(s\)/, {}, SLOW)).toBeTruthy();
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the operator cancels", async () => {
    prompt.mockResolvedValue(null);
    renderPanel("admin@dpf.local");
    fireEvent.click(await enabledEndButton());
    await waitFor(() => expect(prompt).toHaveBeenCalled(), SLOW);
    expect(endMock).not.toHaveBeenCalled();
  });

  it("offers no end control on the operator's own account", async () => {
    listMock.mockResolvedValue({ ok: true, data: adminView({ account: { ...adminView().account, isYou: true } }) });
    renderPanel("me@example.com");
    await screen.findByText(/This is your own account/);
    expect(screen.queryByRole("button", { name: "End this account's agent access" })).toBeNull();
  });

  it("says so when the account holds nothing live", async () => {
    listMock.mockResolvedValue({ ok: true, data: adminView({
      personalTokens: [], clientGrants: [], ownedCredentialsClients: [],
      totals: { personalTokens: 0, oauthAccessTokens: 0, refreshGrants: 0, credentialsClients: 0 },
    }) });
    renderPanel("admin@dpf.local");
    expect(await screen.findByText("This account holds no live agent access.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "End this account's agent access" })).toBeNull();
  });
});
