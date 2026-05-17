// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildQuickBooksReadinessDescriptor } from "@/lib/integrate/quickbooks/readiness";
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
    expect(screen.getAllByText("Read only")).toHaveLength(3);
    expect(screen.getByText("Vendors")).toBeVisible();
    expect(screen.getAllByText("Not mapped").length).toBeGreaterThan(0);
    expect(screen.getByText("Connected")).toBeVisible();
    expect(screen.queryByText(/clientSecret/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/refreshToken/i)).not.toBeInTheDocument();
  });
});
