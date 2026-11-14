// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ load: vi.fn(), confirm: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock("@/lib/actions/portfolio-budget", () => ({
  loadPlatformFundingSetupAction: actions.load,
  confirmPlatformFundingOwnerAction: actions.confirm,
  saveInvestmentBalanceAction: vi.fn(), bindInstallationInvestmentAction: vi.fn(),
}));

import { withMessages } from "@/test-support/with-messages";
import { defaultBalancePolicy } from "@/lib/portfolio/investment-balance";
import type { PlatformFundingSetupView } from "@/lib/portfolio/platform-funding-setup";
import { InvestmentBalance } from "./InvestmentBalance";
import { PlatformFundingSetup } from "./PlatformFundingSetup";

const available = (): PlatformFundingSetupView => ({
  status: "available", reason: null, installationId: "install-test",
  person: { principalId: "principal-test", displayName: "Founder Operator" },
  profile: { profileId: "platform-test", name: "Platform policy", currentVersionId: "version-test", ownerPrincipalId: null, ownerOrganizationId: null },
  organizations: [{ id: "org-test", name: "Owner Organization", expectedDigest: "digest-test", allocation: { source: "default", policy: defaultBalancePolicy("founder", "shared-platform"), revision: null, active: true } }],
  nextCursor: null,
});

async function openSetup() {
  fireEvent.click(screen.getByRole("button", { name: "Confirm platform ownership" }));
  await screen.findByText("Founder Operator");
}

function completeAttestation() {
  fireEvent.change(screen.getByLabelText(/Reason for recording ownership/), { target: { value: "Confirm the shared platform owner." } });
  fireEvent.click(screen.getByLabelText("I am authorized to record this platform policy and funding owner."));
}

beforeEach(() => { actions.load.mockReset(); actions.confirm.mockReset(); actions.refresh.mockClear(); actions.load.mockResolvedValue({ ok: true, data: available() }); });
afterEach(cleanup);

describe("platform funding ownership setup", () => {
  it("keeps setup collapsed and does no read or write on arrival", () => {
    render(withMessages(<PlatformFundingSetup />));
    expect(screen.getByRole("button", { name: "Confirm platform ownership" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(actions.load).not.toHaveBeenCalled();
    expect(actions.confirm).not.toHaveBeenCalled();
  });

  it("requires platform management separately from normal allocation management", () => {
    const { rerender } = render(withMessages(<InvestmentBalance views={[]} canManage />));
    expect(screen.queryByRole("button", { name: "Confirm platform ownership" })).toBeNull();
    rerender(withMessages(<InvestmentBalance views={[]} canManage={false} canManageSetup />));
    expect(screen.getByRole("button", { name: "Confirm platform ownership" })).toBeTruthy();
  });

  it("discloses the exact person, organization, consequences and untouched policy version before confirmation", async () => {
    actions.confirm.mockResolvedValue({ ok: true, data: { status: "confirmed" } });
    actions.load.mockResolvedValueOnce({ ok: true, data: available() }).mockResolvedValue({ ok: true, data: { ...available(), status: "already-recorded" } });
    render(withMessages(<PlatformFundingSetup />));
    await openSetup();
    expect(screen.getByText(/platform policy and funding owner for Owner Organization/)).toBeTruthy();
    expect(screen.getByText("80% repair / 20% new")).toBeTruthy();
    expect(screen.getByText(/Policy versions still need separate ratification/)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Confirm platform owner" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    completeAttestation();
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.confirm).toHaveBeenCalledWith({ organizationId: "org-test", expectedDigest: "digest-test", attestation: true, reason: "Confirm the shared platform owner." }));
    expect(await screen.findByText(/Platform ownership recorded/)).toBeTruthy();
    expect(actions.refresh).toHaveBeenCalledOnce();
  });

  it("shows an existing inactive override without replacing its target with the founder default", async () => {
    const view = available();
    view.organizations[0]!.allocation = { source: "explicit", policy: { ...view.organizations[0]!.allocation.policy, refactorPercent: 35 }, revision: null, active: false };
    actions.load.mockResolvedValue({ ok: true, data: view });
    render(withMessages(<PlatformFundingSetup />));
    await openSetup();
    expect(screen.getByText("35% repair / 65% new")).toBeTruthy();
    expect(screen.getByText(/expired or is not yet active/)).toBeTruthy();
    expect(screen.queryByText("80% repair / 20% new")).toBeNull();
    expect(screen.getByText(/Existing allocation retained/)).toBeTruthy();
  });

  it("never turns an unchecked attestation into a confirmation, including a direct form submit", async () => {
    render(withMessages(<PlatformFundingSetup />));
    await openSetup();
    fireEvent.change(screen.getByLabelText(/Reason for recording ownership/), { target: { value: "Confirm the shared platform owner." } });
    const confirm = screen.getByRole("button", { name: "Confirm platform owner" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.submit(confirm.closest("form")!);
    expect(actions.confirm).not.toHaveBeenCalled();
  });

  it("keeps the chosen reason after a stale refusal and requires a fresh read and attestation", async () => {
    actions.confirm.mockResolvedValue({ ok: false, error: "funding-setup-stale" });
    render(withMessages(<PlatformFundingSetup />));
    await openSetup(); completeAttestation();
    fireEvent.click(screen.getByRole("button", { name: "Confirm platform owner" }));
    expect((await screen.findByRole("alert")).textContent).toContain("changed");
    expect((screen.getByRole("button", { name: "Confirm platform owner" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Reason for recording ownership/) as HTMLInputElement).value).toBe("Confirm the shared platform owner.");
    fireEvent.click(screen.getByRole("button", { name: "Reload ownership record" }));
    await waitFor(() => expect(actions.load).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("I am authorized to record this platform policy and funding owner.") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Confirm platform owner" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears attestation when the selected organization changes and pages without losing an earlier choice", async () => {
    const first = { ...available(), nextCursor: "org-test" };
    const secondOrg = { ...first.organizations[0]!, id: "org-second", name: "Second Organization", expectedDigest: "digest-second" };
    actions.load.mockResolvedValueOnce({ ok: true, data: first }).mockResolvedValueOnce({ ok: true, data: { ...available(), organizations: [secondOrg] } });
    render(withMessages(<PlatformFundingSetup />));
    await openSetup(); completeAttestation();
    fireEvent.click(screen.getByRole("button", { name: "More organizations" }));
    await waitFor(() => expect(actions.load).toHaveBeenLastCalledWith("org-test"));
    const select = screen.getByLabelText(/^Organization/) as HTMLSelectElement;
    expect(select.value).toBe("org-test");
    fireEvent.change(select, { target: { value: "org-second" } });
    expect((screen.getByLabelText("I am authorized to record this platform policy and funding owner.") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Confirm platform owner" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(["partial-or-conflicting", "unavailable", "already-recorded"])("does not expose a writer when the read status is %s", async (status) => {
    actions.load.mockResolvedValue({ ok: true, data: { ...available(), status, reason: "The recorded ownership needs review." } });
    render(withMessages(<PlatformFundingSetup />));
    fireEvent.click(screen.getByRole("button", { name: "Confirm platform ownership" }));
    await screen.findByText("The recorded ownership needs review.");
    expect(screen.queryByRole("button", { name: "Confirm platform owner" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(actions.confirm).not.toHaveBeenCalled();
  });

  it("reports loading and an unavailable read without inventing an owner", async () => {
    let finish: (result: { ok: false; error: string }) => void = () => {};
    actions.load.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(withMessages(<PlatformFundingSetup />));
    fireEvent.click(screen.getByRole("button", { name: "Confirm platform ownership" }));
    expect(screen.getByRole("status").textContent).toContain("Loading");
    await act(async () => finish({ ok: false, error: "funding-setup-not-authorized" }));
    expect(screen.getByRole("alert").textContent).toContain("permission");
    expect(screen.queryByText("Founder Operator")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("does not repeat an ownership write after a lost reply", async () => {
    actions.confirm.mockRejectedValue(new Error("connection lost"));
    render(withMessages(<PlatformFundingSetup />));
    await openSetup(); completeAttestation();
    fireEvent.click(screen.getByRole("button", { name: "Confirm platform owner" }));
    expect((await screen.findByRole("alert")).textContent).toContain("check whether it was saved");
    fireEvent.click(screen.getByRole("button", { name: "Confirm platform owner" }));
    expect(actions.confirm).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Confirm platform owner" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("removes the old confirmation view when a reload loses permission", async () => {
    actions.load.mockResolvedValueOnce({ ok: true, data: available() }).mockResolvedValueOnce({ ok: false, error: "funding-setup-not-authorized" });
    render(withMessages(<PlatformFundingSetup />));
    await openSetup(); completeAttestation();
    fireEvent.click(screen.getByRole("button", { name: "Reload ownership record" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Founder Operator")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm platform owner" })).toBeNull();
  });

  it("keeps organization browsing within one bounded page plus the chosen prior option", async () => {
    const page = (offset: number) => ({ ...available(), organizations: Array.from({ length: 10 }, (_, index) => ({ ...available().organizations[0]!, id: `org-page-${offset + index}`, name: `Owner organization ${offset + index}` })), nextCursor: `cursor-${offset}` });
    actions.load.mockResolvedValueOnce({ ok: true, data: page(0) }).mockResolvedValueOnce({ ok: true, data: page(10) }).mockResolvedValueOnce({ ok: true, data: page(20) });
    render(withMessages(<PlatformFundingSetup />));
    await openSetup();
    fireEvent.change(screen.getByLabelText(/^Organization/), { target: { value: "org-page-0" } });
    fireEvent.click(screen.getByRole("button", { name: "More organizations" }));
    await screen.findByRole("option", { name: "Owner organization 10" });
    const select = screen.getByLabelText(/^Organization/) as HTMLSelectElement;
    expect(select.options.length).toBe(12);
    expect(select.value).toBe("org-page-0");
    fireEvent.change(select, { target: { value: "org-page-10" } });
    fireEvent.click(screen.getByRole("button", { name: "More organizations" }));
    await screen.findByRole("option", { name: "Owner organization 20" });
    expect(select.options.length).toBe(12);
    expect(screen.queryByRole("option", { name: "Owner organization 0" })).toBeNull();
    expect(select.value).toBe("org-page-10");
  });
});
