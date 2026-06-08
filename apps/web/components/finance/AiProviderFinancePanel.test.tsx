import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiProviderFinancePanel } from "./AiProviderFinancePanel";

describe("AiProviderFinancePanel", () => {
  it("renders subscription billing day, paid evidence, and coverage", () => {
    const html = renderToStaticMarkup(
      <AiProviderFinancePanel
        detail={{
          id: "profile-chatgpt",
          providerId: "chatgpt",
          status: "active",
          billingUrl: "https://chatgpt.com/admin/billing",
          usageUrl: null,
          supplier: { id: "supplier-openai", name: "OpenAI" },
          supplierContracts: [
            {
              id: "contract-openai",
              status: "active",
              billingCadence: "monthly",
              billingDayOfMonth: 19,
              paymentMethod: "card",
              monthlyCommittedAmount: 20,
              currency: "USD",
              coveredProviderIds: ["chatgpt", "codex"],
              usageSnapshots: [],
              bills: [
                {
                  id: "bill-openai",
                  status: "paid",
                  issueDate: new Date("2026-06-19T00:00:00.000Z"),
                  totalAmount: 20,
                  currency: "USD",
                  allocations: [
                    {
                      payment: {
                        status: "completed",
                        amount: 20,
                        currency: "USD",
                        receivedAt: new Date("2026-06-19T00:00:00.000Z"),
                      },
                    },
                  ],
                },
              ],
            },
          ],
          financeWorkItems: [],
        } as any}
      />,
    );

    expect(html).toContain("Monthly · day 19 · Card");
    expect(html).toContain("$20.00");
    expect(html).toContain("Paid · Jun 19 · $20.00");
    expect(html).toContain("2 provider rows");
    expect(html).toContain('href="/finance/bills/bill-openai"');
  });
});
