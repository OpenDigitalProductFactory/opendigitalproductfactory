// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOURCE_CATALOG } from "@dpf/i18n";
import type { ProviderAccountOverviewRow } from "@/lib/inference/provider-account-view";
const mocks = vi.hoisted(() => ({ recheck: vi.fn(), stop: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/actions/provider-accounts", () => ({ recheckProviderAccountQuota: mocks.recheck, stopProviderAccountQuotaRecovery: mocks.stop }));
import { ProviderQuotaDetails } from "./ProviderQuotaDetails";
const copy = SOURCE_CATALOG.providerAccounts;
const recovery: NonNullable<ProviderAccountOverviewRow["quotaRecovery"]> = {
  models: [{ modelId: "selected-model", name: "Selected model" }, { modelId: "other-model", name: "Other model" }], selectedModelId: "selected-model",
  hourly: false, canCheck: true, lastCheckAt: null, nextCheckAt: null, lastResult: null,
  checkedModelId: null, checkedAt: null, proofExpiresAt: null, observedAt: "2026-10-29T07:09:00Z", observationSource: "cli",
  limits: [{ summary: "Shared subscription limit", until: "2026-11-04T07:09:00Z" }], usageUrl: "https://chatgpt.com/codex/settings/usage", unavailable: false,
};
beforeEach(() => { vi.resetAllMocks(); mocks.recheck.mockResolvedValue({ ok: true, message: "Selected model check completed." }); });
afterEach(cleanup);
describe("provider capacity recovery disclosure", () => {
  it("viewing evidence and opening usage never performs a check or redeems a reset", () => {
    render(<ProviderQuotaDetails connectionId="provider-default-chatgpt" recovery={recovery} canWrite copy={copy} />);
    fireEvent.click(screen.getByText(copy.limitDetails));
    expect(screen.getByText(copy.resetUnknown)).toBeTruthy();
    expect(screen.getByRole("link", { name: copy.providerUsage }).getAttribute("href")).toBe(recovery.usageUrl);
    expect(mocks.recheck).not.toHaveBeenCalled();
    expect(screen.queryByText("2026-11-04T07:09:00Z")).toBeNull();
  });
  it("sends only the explicitly selected account/model and hourly choice", async () => {
    render(<ProviderQuotaDetails connectionId="provider-default-chatgpt" recovery={recovery} canWrite copy={copy} />);
    fireEvent.click(screen.getByText(copy.limitDetails));
    fireEvent.change(screen.getByLabelText(copy.capacityModel), { target: { value: "other-model" } });
    fireEvent.click(screen.getByLabelText(copy.capacityHourly));
    fireEvent.click(screen.getByRole("button", { name: copy.capacityCheck }));
    await waitFor(() => expect(mocks.recheck).toHaveBeenCalledExactlyOnceWith("provider-default-chatgpt", "other-model", true));
    expect((await screen.findByRole("status")).textContent).toContain("Selected model check completed.");
  });
  it.each([false, true])("a read-only or restricted account cannot dispatch (write=%s)", canWrite => {
    render(<ProviderQuotaDetails connectionId="account" recovery={{ ...recovery, canCheck: false }} canWrite={canWrite} copy={copy} />);
    fireEvent.click(screen.getByText(copy.limitDetails));
    expect(screen.queryByRole("button", { name: copy.capacityCheck })).toBeNull();
    expect(mocks.recheck).not.toHaveBeenCalled();
  });
  it("does not offer a stop control to a read-only viewer", () => {
    render(<ProviderQuotaDetails connectionId="provider-default-chatgpt" recovery={{ ...recovery, hourly: true }} canWrite={false} copy={copy} />);
    fireEvent.click(screen.getByText(copy.limitDetails));
    expect(screen.queryByRole("button", { name: copy.capacityStop })).toBeNull();
    expect(mocks.stop).not.toHaveBeenCalled();
  });
  it.each([true, false])("stops the existing commission without checking an account (canCheck=%s)", async canCheck => {
    mocks.stop.mockResolvedValue({ ok: true, message: "Hourly recovery is stopped. No provider request was sent." });
    render(<ProviderQuotaDetails connectionId="provider-default-chatgpt" recovery={{ ...recovery, hourly: true, canCheck }} canWrite copy={copy} />);
    fireEvent.click(screen.getByText(copy.limitDetails));
    fireEvent.click(screen.getByRole("button", { name: copy.capacityStop }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledExactlyOnceWith("provider-default-chatgpt"));
    expect(mocks.recheck).not.toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toContain("No provider request was sent");
  });
});
