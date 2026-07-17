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
});
