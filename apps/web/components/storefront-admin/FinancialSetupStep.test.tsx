// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const applyFinancialProfile = vi.fn(async () => ({ applied: true as const, profileName: "Trades" }));
vi.mock("@/lib/actions/financial-setup", () => ({ applyFinancialProfile }));

import { FinancialSetupStep } from "./FinancialSetupStep";

afterEach(() => {
  cleanup();
  applyFinancialProfile.mockClear();
});

describe("FinancialSetupStep currency + VAT defaults", () => {
  it("defaults to USD (not the UK-biased profile/locale) with no suggested currency", async () => {
    render(
      <FinancialSetupStep
        archetypeSlug="trades_construction"
        archetypeName="Trades & Construction"
        onComplete={() => {}}
      />,
    );

    // Currency select pre-fills USD.
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("USD");

    // Even though the trades profile is VAT-registered in the UK, a USD install
    // must NOT pre-select VAT — that was the cascade behind the 20% bill tax.
    fireEvent.click(screen.getByText("Set Up Finances"));
    await waitFor(() => {
      expect(applyFinancialProfile).toHaveBeenCalledWith("trades_construction", {
        vatRegistered: false,
        baseCurrency: "USD",
      });
    });
  });

  it("honours an explicit suggested currency when one is detected", () => {
    render(
      <FinancialSetupStep
        archetypeSlug="trades_construction"
        archetypeName="Trades & Construction"
        suggestedCurrency="EUR"
        onComplete={() => {}}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("EUR");
  });
});
