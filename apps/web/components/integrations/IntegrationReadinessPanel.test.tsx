// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildQuickBooksReadinessDescriptor } from "@/lib/integrations/quickbooks/readiness";
import { IntegrationReadinessPanel } from "./IntegrationReadinessPanel";

describe("IntegrationReadinessPanel", () => {
  it("renders provider readiness and capability states without secrets", () => {
    const descriptor = buildQuickBooksReadinessDescriptor({
      connection: {
        status: "connected",
        companyName: "Acme Services LLC",
        realmId: "9130355377388383",
        lastErrorMsg: null,
        lastTestedAt: "2026-04-24T05:00:00.000Z",
        environment: "sandbox",
      },
    });

    render(<IntegrationReadinessPanel descriptor={descriptor} />);

    expect(screen.getByRole("heading", { name: "QuickBooks Online readiness" })).toBeVisible();
    expect(screen.getByText("Acme Services LLC")).toBeVisible();
    expect(screen.getAllByText("Import ready")).toHaveLength(9);
    expect(screen.getAllByText("Vendors").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Expenses").length).toBeGreaterThan(0);
    expect(screen.getByText(/API coverage: QuickBooks Purchase query/i)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Import staging posture" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Import review queue" })).toBeVisible();
    expect(screen.getByText("Non-editable")).toBeVisible();
    // Nothing is filed for the import-review queue, so the Backlog pill is not
    // rendered at all rather than naming a dead item (BI-5BF97BAA).
    expect(screen.queryByText("Backlog")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/BI-[0-9A-F]{8}/);
    expect(screen.getByText("Ready for review")).toBeVisible();
    expect(screen.getByText(/Review queue records are DPF-held posture only/i)).toBeVisible();
    expect(screen.getAllByText("External-owned")).toHaveLength(9);
    expect(screen.getByText("Invoice")).toBeVisible();
    expect(screen.getAllByText("Not mapped").length).toBeGreaterThan(0);
    expect(screen.getByText("Connected")).toBeVisible();
    expect(screen.queryByText(/clientSecret/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/refreshToken/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sync|write|update quickbooks/i })).not.toBeInTheDocument();
  });
});
