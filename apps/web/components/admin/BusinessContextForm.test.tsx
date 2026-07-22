import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BusinessContextForm } from "./BusinessContextForm";

vi.mock("@/components/admin/BusinessDocumentUpload", () => ({
  BusinessDocumentUpload: () => <div data-testid="business-document-upload" />,
}));

vi.mock("@/components/admin/RosterImport", () => ({
  RosterImport: () => <div data-testid="roster-import" />,
}));

vi.mock("@/components/admin/MarketContextFields", () => ({
  MarketContextFields: () => <div data-testid="market-context-fields" />,
}));

const baseInitial = {
  description: "",
  mission: "",
  targetMarket: "",
  sourceSystem: "Legacy spreadsheets",
  companySize: null,
  geographicScope: null,
  revenueModel: "",
  contactEmail: "",
  contactPhone: "",
  operatesIn: [],
  sellsTo: [],
  employsIn: [],
  dataResidency: [],
  handlesCardPayments: false,
  listingStatus: null,
  riskPosture: null,
  address: {},
};

describe("BusinessContextForm", () => {
  it("renders the optional switching-from source system question", () => {
    const html = renderToStaticMarkup(
      <BusinessContextForm
        initial={baseInitial}
        archetypeSummary={null}
      />,
    );

    expect(html).toContain("What system or process are you switching from?");
    expect(html).toContain("Legacy spreadsheets");
    expect(html).toContain("sourceSystem");
  });

  // BI-8E74C749: the /storefront/settings/business form must carry stable field
  // names and correct autocomplete tokens (the compact audit flagged missing
  // names on this dense setup form), plus an accessible submit action.
  it("wires stable names on the free-text business fields", () => {
    const html = renderToStaticMarkup(
      <BusinessContextForm initial={baseInitial} archetypeSummary={null} />,
    );
    expect(html).toContain('name="description"');
    expect(html).toContain('name="mission"');
    expect(html).toContain('name="targetMarket"');
  });

  it("gives contact + address inputs autocomplete tokens", () => {
    const html = renderToStaticMarkup(
      <BusinessContextForm initial={baseInitial} archetypeSummary={null} />,
    );
    // React 19 renderToStaticMarkup preserves the camelCase `autoComplete` prop
    // name in the emitted markup (the browser + jsdom treat it case-insensitively),
    // so match the token case-insensitively rather than assuming lowercase.
    expect(html).toContain('name="contactEmail"');
    expect(html).toMatch(/autocomplete="email"/i);
    expect(html).toContain('name="contactPhone"');
    expect(html).toMatch(/autocomplete="tel"/i);
    expect(html).toMatch(/autocomplete="address-line1"/i);
    expect(html).toMatch(/autocomplete="postal-code"/i);
    expect(html).toMatch(/autocomplete="country"/i);
  });

  it("renders an accessible primary submit action", () => {
    const html = renderToStaticMarkup(
      <BusinessContextForm initial={baseInitial} archetypeSummary={null} isEdit={false} />,
    );
    expect(html).toContain("<button");
    expect(html).toContain("Continue");
  });
});
