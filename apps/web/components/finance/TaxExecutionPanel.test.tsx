import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/actions/tax-remittance", () => ({
  prepareTaxRemittanceRun: vi.fn(),
  updateTaxRemittanceRunStatus: vi.fn(),
}));

import { TaxExecutionPanel } from "@/components/finance/TaxExecutionPanel";

describe("TaxExecutionPanel", () => {
  it("shows the latest submitted confirmation reference in the outcome summary", () => {
    const html = renderToStaticMarkup(
      <TaxExecutionPanel
        filingOwner="dpf_coworker"
        handoffMode="dpf_readiness_only"
        periods={[
          {
            id: "period-1",
            periodId: "2026-Q2-AL",
            status: "ready",
            dueDate: "2026-05-20T00:00:00.000Z",
            registration: {
              jurisdictionReference: {
                authorityName: "Alabama Department of Revenue",
              },
            },
            remittanceRuns: [
              {
                id: "run-1",
                runId: "TAX-RUN-AL-1",
                status: "submitted",
                executionMode: "scheduled_coworker",
                scheduledFor: "2026-05-12T15:00:00.000Z",
                submittedAt: "2026-05-12T16:30:00.000Z",
                confirmationRef: "UX-SUB-001",
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain("Submitted");
    expect(html).toContain("UX-SUB-001");
  });
});
