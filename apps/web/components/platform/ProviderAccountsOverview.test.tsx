// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ add: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/lib/actions/provider-accounts", () => ({ addProviderAccount: mocks.add }));
import { ProviderAccountsOverview, type ProviderAccountOverviewRow } from "./ProviderAccountsOverview";
import { measureUxBudget } from "@/lib/ux-budget/measure";

const copy = { connection: "Accounts", accountName: "Account name", provider: "Provider", allowedWork: "Allowed work", models: "Models", capacity: "Capacity", manage: "Manage", addAccount: "Add account", addProvider: "Add provider", noAccounts: "No accounts", catalog: "Available providers", searchAccounts: "Search accounts", searchProviders: "Search providers", authMethod: "Authentication method", apiKeyMethod: "API key", oauthMethod: "Sign-in", workloadMethod: "Client credentials", cancel: "Cancel", failed: "Failed" };
const catalog = [{ providerId: "codex", name: "Codex", summary: "Coding and reasoning", supportedAuthMethods: ["oauth2_authorization_code"] }, { providerId: "anthropic", name: "Anthropic", summary: "Writing and coding", supportedAuthMethods: ["api_key"] }];
const row: ProviderAccountOverviewRow = { providerId: "codex", connectionId: "provider-account-work", isDefault: false, label: "Work", providerName: "Codex", status: "active", statusLabel: "Connected", credential: null, modelsVerifiedAt: null, lastReviewedAt: null, allowedWork: "Public only", allowedWorkSummary: "Review company-data terms", modelSummary: "Not verified", capacitySummary: "Not reported", resetSummary: null, resolvesPhases: [] };
beforeEach(() => { vi.resetAllMocks(); mocks.add.mockResolvedValue({ ok: true, data: { connectionId: "new-account" } }); });
afterEach(cleanup);

describe("compact provider account overview", () => {
  it.each(["row", "catalog"])("restores the exact %s Add account trigger after cancellation", source => {
    render(<ProviderAccountsOverview rows={[row]} catalog={catalog} firstRun={false} canWrite copy={copy} />);
    let opener = screen.getByRole("button", { name: "Add account" });
    if (source === "catalog") {
      fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
      const entry = screen.getByRole("link", { name: "Anthropic" }).closest("li")!;
      opener = within(entry).getByRole("button", { name: "Add account" });
    }
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText("Account name"));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.click(cancel);
    expect(screen.queryByRole("form")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  it("restores Add provider when the catalog trigger is no longer mounted", () => {
    render(<ProviderAccountsOverview rows={[row]} catalog={catalog} firstRun={false} canWrite copy={copy} />);
    const addProvider = screen.getByRole("button", { name: "Add provider" });
    fireEvent.click(addProvider);
    const entry = screen.getByRole("link", { name: "Anthropic" }).closest("li")!;
    fireEvent.click(within(entry).getByRole("button", { name: "Add account" }));
    addProvider.focus();
    fireEvent.click(addProvider);
    expect(screen.queryByRole("heading", { name: "Available providers" })).toBeNull();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    cancel.focus();
    fireEvent.click(cancel);
    expect(document.activeElement).toBe(addProvider);
  });
  it.each([true, false])("keeps an account next action visible when advisory help is disclosed (write=%s)", canWrite => {
    const { container } = render(<><details><summary>Allowed work</summary>
      <button data-owner-first-next-action>Ask for advice</button></details>
      <ProviderAccountsOverview rows={[row]} catalog={catalog} firstRun={false} canWrite={canWrite} copy={copy} /></>);
    const metrics = measureUxBudget(container.innerHTML);
    expect(metrics.hasNextActionMarker).toBe(true);
    expect(metrics.buriedPrimaryAction).toBe(0);
  });
  it("shows the catalog only on first arrival or explicit Add provider", () => {
    const { rerender } = render(<ProviderAccountsOverview rows={[row]} catalog={catalog} firstRun={false} canWrite copy={copy} />);
    expect(screen.queryByRole("heading", { name: "Available providers" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    expect(screen.getByRole("heading", { name: "Available providers" })).toBeTruthy();
    rerender(<ProviderAccountsOverview key="fresh" rows={[]} catalog={catalog} firstRun canWrite copy={copy} />);
    expect(screen.getByRole("heading", { name: "Available providers" })).toBeTruthy();
  });
  it("links the exact account and keeps allowed work and unknown facts visible", () => {
    render(<ProviderAccountsOverview rows={[row]} catalog={catalog} firstRun={false} canWrite copy={copy} />);
    expect(screen.getByRole("link", { name: "Work" }).getAttribute("href")).toBe("/platform/ai/providers/codex?account=provider-account-work");
    expect(screen.getByText("Public only")).toBeTruthy();
    expect(screen.getByText("Not verified")).toBeTruthy();
    expect(screen.getByText("Not reported")).toBeTruthy();
    expect(screen.queryByText("100%")).toBeNull();
  });
  it("adds a named account with supported auth then opens that specific account", async () => {
    render(<ProviderAccountsOverview rows={[row]} catalog={catalog} firstRun={false} canWrite copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Team" } });
    const submit = screen.getAllByRole("button", { name: "Add account" }).find(button => button.getAttribute("type") === "submit")!;
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith({ providerId: "codex", label: "Team", authMethod: "oauth2_authorization_code" }));
    expect(mocks.push).toHaveBeenCalledWith("/platform/ai/providers/codex?account=new-account");
  });
  it("offers no mutations to a read-only operator", () => {
    render(<ProviderAccountsOverview rows={[row]} catalog={catalog} firstRun={false} canWrite={false} copy={copy} />);
    expect(screen.queryByRole("button", { name: "Add account" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add provider" })).toBeNull();
    expect(screen.getByRole("link", { name: "Manage" })).toBeTruthy();
  });
  it("consolidates Add account to one action per visible provider", () => {
    render(<ProviderAccountsOverview rows={[row, { ...row, connectionId: "provider-account-personal", label: "Personal" }]} catalog={catalog} firstRun={false} canWrite copy={copy} />);
    expect(screen.getAllByRole("button", { name: "Add account" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Personal" })).toBeTruthy();
  });
  it("names account creation fields and announces its pending state", async () => {
    let settle!: (value: { ok: false; error: string }) => void;
    mocks.add.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    render(<ProviderAccountsOverview rows={[row]} catalog={catalog} firstRun={false} canWrite copy={{ ...copy, working: "Working" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(screen.getByLabelText("Account name").getAttribute("name")).toBe("label");
    expect(screen.getByLabelText("Authentication method").getAttribute("name")).toBe("authMethod");
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Team" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add account" }).find(button => button.getAttribute("type") === "submit")!);
    await waitFor(() => expect(screen.getByText("Working")).toBeTruthy());
    settle({ ok: false, error: "Retry creation" });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Retry creation");
  });
});
