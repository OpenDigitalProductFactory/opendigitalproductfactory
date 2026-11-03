// @vitest-environment jsdom

import { act, cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSave } = vi.hoisted(() => ({ mockSave: vi.fn() }));
vi.mock("@/lib/actions/paid-inference-allowance", () => ({ savePaidInferenceAllowance: mockSave }));

import { PaidInferenceAllowanceSettings } from "@/components/admin/PaidInferenceAllowanceSettings";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";

const render = (ui: ReactElement) => rtlRender(
  <MessagesProvider locale="en-US" messages={{ admin: namespaceMessages("en-US", "admin") }}>{ui}</MessagesProvider>,
);

afterEach(() => cleanup());

describe("PaidInferenceAllowanceSettings", () => {
  beforeEach(() => {
    mockSave.mockReset();
    mockSave.mockResolvedValue({ ok: true, data: { dailyUsd: 25 } });
  });

  it("says plainly what applies when no allowance is set", () => {
    render(<PaidInferenceAllowanceSettings dailyUsd={null} spentTodayUsd={0} setAt={null} setByEmail={null} reason={null} />);
    expect(screen.getByText(/Not set\. Each coworker's built-in daily cap/)).toBeTruthy();
    expect(screen.getByText(/Local and subscription models are never limited/)).toBeTruthy();
  });

  it("shows today's spend against the allowance and who last changed it", () => {
    render(<PaidInferenceAllowanceSettings dailyUsd={25} spentTodayUsd={3.5} setAt="2026-11-03T20:00:00.000Z" setByEmail="owner@example.com" reason="sized" />);
    expect(screen.getByText(/\$25\.00 a day for all coworkers\. \$3\.50 used today\./)).toBeTruthy();
    expect(screen.getByText(/Last changed 2026-11-03 by owner@example\.com: sized/)).toBeTruthy();
  });

  it("saves only with a reason, through the governed action", async () => {
    render(<PaidInferenceAllowanceSettings dailyUsd={null} spentTodayUsd={0} setAt={null} setByEmail={null} reason={null} />);
    const save = screen.getByRole("button", { name: "Save allowance" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/Dollars per day/), { target: { value: "25" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Sized to review volume" } });
    expect(save.disabled).toBe(false);
    await act(async () => { fireEvent.click(save); });
    expect(mockSave).toHaveBeenCalledWith({ dailyUsd: 25, reason: "Sized to review volume" });
  });
});
