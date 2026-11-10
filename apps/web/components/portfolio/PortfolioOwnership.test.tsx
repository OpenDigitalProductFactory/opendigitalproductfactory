// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const setPortfolioOwnerAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/portfolio-budget", () => ({ setPortfolioOwnerAction }));

import type { PortfolioOwnershipView } from "@/lib/portfolio/accountable-owner-view";
import { withMessages } from "@/test-support/with-messages";

import { PortfolioOwnership } from "./PortfolioOwnership";

const view: PortfolioOwnershipView = {
  rows: [
    { portfolioId: "pf-f", slug: "foundational", name: "Foundational", owner: { principalId: "PRN-mark", displayName: "Mark Bodman" }, setAt: "2026-09-29T20:00:00.000Z", reason: "Runs the platform" },
    { portfolioId: "pf-w", slug: "for_employees", name: "Workforce", owner: null, setAt: null, reason: null },
  ],
  standIn: { email: "admin@dpf.local", source: "fallback" },
  candidates: [{ principalId: "PRN-mark", displayName: "Mark Bodman", email: "mark@example.com" }],
};

// BI-67B27832 AC-5: one place, beside the budget, to see and choose who answers for each portfolio.
describe("PortfolioOwnership", () => {
  it("names each portfolio's accountable person, marks an unset one, and says where unset work goes", () => {
    render(withMessages(<PortfolioOwnership view={view} canManage={false} />));
    expect(screen.getByText("Mark Bodman")).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText(/Unset portfolios go to admin@dpf\.local\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });

  it("lets a platform manager choose a person with a reason", async () => {
    setPortfolioOwnerAction.mockResolvedValue({ ok: true, data: "saved" });
    render(withMessages(<PortfolioOwnership view={view} canManage />));
    fireEvent.click(screen.getAllByRole("button", { name: "Change" })[1]);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Accountable person"), { target: { value: "PRN-mark" } });
    fireEvent.change(screen.getByLabelText("Why this person"), { target: { value: "Runs the workforce products" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(setPortfolioOwnerAction).toHaveBeenCalledWith({ portfolioId: "pf-w", principalRef: "PRN-mark", reason: "Runs the workforce products" }),
    );
  });

  it("shows the refusal when the write is refused", async () => {
    setPortfolioOwnerAction.mockResolvedValue({ ok: false, error: "Mark Bodman has no active account." });
    render(withMessages(<PortfolioOwnership view={view} canManage />));
    fireEvent.click(screen.getAllByRole("button", { name: "Change" })[0]);
    fireEvent.change(screen.getByLabelText("Why this person"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("no active account");
  });
});
