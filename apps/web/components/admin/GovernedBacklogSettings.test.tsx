// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BI-9AC1F99B: the capacity drain switch lives with the autopilot switches on the
// "Let Build Studio pick up work on its own" card and saves through the card's
// existing server action, so the operator never needs a database edit for it.
const { mockSave } = vi.hoisted(() => ({ mockSave: vi.fn() }));
vi.mock("@/lib/actions/governed-backlog-settings", () => ({ saveGovernedBacklogSettings: mockSave }));

import { GovernedBacklogSettings } from "@/components/admin/GovernedBacklogSettings";
import { measureUxBudget } from "@/lib/ux-budget";

afterEach(() => cleanup());

describe("GovernedBacklogSettings capacity drain switch", () => {
  beforeEach(() => {
    mockSave.mockReset();
    mockSave.mockResolvedValue({ ok: true, data: { enabled: true, dailyCap: 3, capacityDrainEnabled: true } });
  });

  it("reflects the stored value and explains that it needs the governed lane", () => {
    render(<GovernedBacklogSettings enabled dailyCap={3} capacityDrainEnabled={false} playbookMode="off" />);
    const box = screen.getByTestId("capacity-drain-enabled") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(/unused weekly AI allowance is left to expire/)).toBeTruthy();
    expect(screen.getByText(/Works only while the governed backlog lane is on/)).toBeTruthy();
  });

  it("enables Save once toggled and sends the switch through the card's server action", async () => {
    render(<GovernedBacklogSettings enabled dailyCap={3} capacityDrainEnabled={false} playbookMode="off" />);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByTestId("capacity-drain-enabled"));
    expect(save.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(save);
    });
    expect(mockSave).toHaveBeenCalledWith({ enabled: true, dailyCap: 3, capacityDrainEnabled: true });
  });

  it("keeps the card's default view unchanged: the switch sits in the closed disclosure", () => {
    const { container } = render(
      <GovernedBacklogSettings enabled dailyCap={3} capacityDrainEnabled playbookMode="off" />,
    );
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.contains(screen.getByTestId("capacity-drain-enabled"))).toBe(true);
    // Same as the card before the switch was added (measured on 979fd38e11).
    const metrics = measureUxBudget(container.innerHTML);
    expect(metrics.defaultVisibleWords).toBeLessThanOrEqual(64);
    expect(metrics.visibleFields).toBeLessThanOrEqual(1);
    expect(metrics.disclosureRegions).toBe(1);
  });
});
