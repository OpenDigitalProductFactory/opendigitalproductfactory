// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaxRegistrationEditor } from "./TaxRegistrationEditor";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/actions/tax-remittance", () => ({
  createTaxRegistration: vi.fn(),
  updateTaxRegistration: vi.fn(),
}));

// 81 authorities is the real shape of this list once the US federal row is
// seeded — 50 states, the EU, GB, and federal. The budget is 20.
const jurisdictionOptions = Array.from({ length: 81 }, (_, i) => ({
  id: `row_${i}`,
  jurisdictionRefId: `TAX-JUR-${i}`,
  authorityName: `Authority ${i}`,
  countryCode: i < 51 ? "US" : "DE",
  stateProvinceCode: i < 51 ? `S${i}` : null,
  authorityType: i === 0 ? "country" : "state",
  taxTypes: ["sales_tax"],
}));

const registrations = [
  {
    id: "reg_1",
    registrationId: "REG-1",
    taxType: "sales_tax",
    registrationNumber: null,
    registrationStatus: "active",
    filingFrequency: "monthly",
    filingBasis: null,
    remitterRole: "business",
    effectiveFrom: "2026-01-01",
    portalAccountNotes: null,
    verifiedFromSourceUrl: null,
    lastVerifiedAt: null,
    confidence: "medium",
    jurisdictionReference: {
      authorityName: "Authority 7",
      jurisdictionRefId: "TAX-JUR-7",
      countryCode: "US",
      stateProvinceCode: "S7",
    },
  },
];

describe("TaxRegistrationEditor jurisdiction picker", () => {
  it("renders no option elements while closed, whatever the catalogue size", () => {
    // This is the property that clears the maxChoicesPerControl budget: the UX
    // sweep counts RENDERED options, and a flat select emitted all 81 at once.
    const { container } = render(
      <TaxRegistrationEditor
        jurisdictionOptions={jurisdictionOptions}
        registrations={registrations}
        issues={[]}
      />,
    );

    const jurisdictionOptionNodes = Array.from(container.querySelectorAll("option")).filter(
      (node) => /Authority \d+/.test(node.textContent ?? ""),
    );
    expect(jurisdictionOptionNodes).toHaveLength(0);
  });

  it("opens on the authorities this business already registered with", () => {
    render(
      <TaxRegistrationEditor
        jurisdictionOptions={jurisdictionOptions}
        registrations={registrations}
        issues={[]}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Jurisdiction" }));

    // The kernel ledger (DI-89F317F406AA) scored a bare search box negative on
    // "don't task the operator with what an agent can do". Authority 7 is the
    // one they already file with, so it must be offered without typing.
    const shown = screen.getAllByRole("option").map((node) => node.textContent ?? "");
    expect(shown.some((label) => label.includes("Authority 7"))).toBe(true);

    // And the whole catalogue is still not rendered at once.
    expect(shown.length).toBeLessThan(jurisdictionOptions.length);
  });

  it("finds an authority by country code, not just by name", () => {
    render(
      <TaxRegistrationEditor
        jurisdictionOptions={jurisdictionOptions}
        registrations={registrations}
        issues={[]}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Jurisdiction" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search authorities" }), {
      target: { value: "DE" },
    });

    const shown = screen.getAllByRole("option").map((node) => node.textContent ?? "");
    // Country code is part of the search corpus, so "DE" reaches authorities
    // whose NAME contains no such string.
    expect(shown.some((label) => label.includes("(DE"))).toBe(true);
    // The search narrows rather than listing everything.
    expect(shown.length).toBeLessThan(jurisdictionOptions.length);
  });
});
