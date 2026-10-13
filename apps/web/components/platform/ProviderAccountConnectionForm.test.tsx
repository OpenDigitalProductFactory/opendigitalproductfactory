// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAccountRow } from "@/lib/inference/ai-provider-data";

const mocks = vi.hoisted(() => ({ configure: vi.fn(), discover: vi.fn(), enabled: vi.fn(), test: vi.fn(), disconnect: vi.fn(), signIn: vi.fn(), confirm: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/actions/provider-accounts", () => ({ configureProviderAccount: mocks.configure, discoverProviderAccount: mocks.discover, setProviderAccountEnabled: mocks.enabled }));
vi.mock("@/lib/actions/ai-providers", () => ({ testProviderAuth: mocks.test }));
vi.mock("@/lib/actions/provider-oauth", () => ({ disconnectProviderOAuth: mocks.disconnect, startProviderOAuth: mocks.signIn }));
vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: mocks.confirm }));
import { ProviderAccountConnectionForm } from "./ProviderAccountConnectionForm";

const copy = { connection: "Connection", accountName: "Account name", apiKey: "API key", save: "Save", saved: "Saved", failed: "Failed", test: "Test", discover: "Models", modelsRefreshed: "Refreshed", enable: "Enable", disable: "Disable", stateSaved: "Updated", signIn: "Sign in", disconnect: "Disconnect", disconnectTitle: "Disconnect?", disconnectMessage: "Remove this account", disconnected: "Disconnected", writeOnly: "Secrets stay private" };
function account(overrides: Partial<ProviderAccountRow> = {}): ProviderAccountRow {
  return { connectionId: "provider-account-work", providerId: "codex", label: "Work", authMethod: "api-key", status: "active", credential: null, isDefault: false, ...overrides } as ProviderAccountRow;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.configure.mockResolvedValue({ ok: true });
  mocks.discover.mockResolvedValue({ ok: true, data: { modelIds: ["model-one"] } });
  mocks.enabled.mockResolvedValue({ ok: true });
  mocks.test.mockResolvedValue({ ok: true, message: "Connected" });
  mocks.disconnect.mockResolvedValue({});
});
afterEach(cleanup);

describe("selected provider account controls", () => {
  it("renames without submitting unchanged credentials and clears newly entered secrets after saving", async () => {
    render(<ProviderAccountConnectionForm account={account()} canWrite copy={copy} />);
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.configure).toHaveBeenCalledWith({ connectionId: "provider-account-work", label: "Renamed" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "new-test-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe(""));
    expect(mocks.configure).toHaveBeenLastCalledWith({ connectionId: "provider-account-work", label: "Renamed", secretRef: "new-test-secret" });
  });

  it("checks and discovers only the selected additional account", async () => {
    render(<ProviderAccountConnectionForm account={account()} canWrite copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(mocks.test).toHaveBeenCalledWith("codex", false, "provider-account-work"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Models" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    await waitFor(() => expect(mocks.discover).toHaveBeenCalledWith("provider-account-work"));
  });

  it("disconnects only after confirmation and reports a rejected action without success", async () => {
    render(<ProviderAccountConnectionForm account={account({ authMethod: "oauth" })} canWrite copy={copy} />);
    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.disconnect).not.toHaveBeenCalled();
    mocks.confirm.mockResolvedValueOnce(true);
    mocks.disconnect.mockResolvedValueOnce({ error: "Denied" });
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(mocks.disconnect).toHaveBeenCalledWith("codex", "provider-account-work"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Denied"));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("keeps read-only controls disabled", () => {
    render(<ProviderAccountConnectionForm account={account()} canWrite={false} copy={copy} />);
    for (const button of screen.getAllByRole("button")) expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("API key").hasAttribute("disabled")).toBe(true);
  });
});
