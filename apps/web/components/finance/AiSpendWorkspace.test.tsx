import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/ai-provider-finance", () => ({
  recordAiProviderSubscriptionPaymentAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { AiSpendWorkspace } from "./AiSpendWorkspace";

describe("AiSpendWorkspace", () => {
  it("surfaces unpriced provider gaps and human asks instead of treating zero spend as healthy", () => {
    const html = renderToStaticMarkup(
      <AiSpendWorkspace
        currencySymbol="$"
        overview={{
          supplierCount: 2,
          activeProviderCount: 4,
          untrackedProviderCount: 2,
          committedSpend: 0,
          contractsNeedingSetup: 2,
          openWorkItems: 3,
          projectedUnusedCommitment: 0,
          actualMeteredSpendUsd: 0,
          inferenceCallsThisMonth: 42,
          monthStart: new Date("2026-06-01T00:00:00.000Z"),
        } as any}
        rows={[
          {
            id: "profile-anthropic",
            providerId: "anthropic-sub",
            status: "seeded",
            provider: {
              providerId: "anthropic-sub",
              name: "Claude/Anthropic OAuth Subscription",
              status: "active",
            },
            supplier: { id: "supplier-anthropic", supplierId: "SUP-ANT", name: "Anthropic" },
            supplierContracts: [
              {
                status: "draft",
                monthlyCommittedAmount: null,
                billingCadence: "monthly",
                billingDayOfMonth: null,
                paymentMethod: null,
                coveredProviderIds: ["anthropic-sub"],
                bills: [],
                usageSnapshots: [],
              },
            ],
            financeWorkItems: [
              {
                id: "work-1",
                type: "browser_profile_needed",
                title: "Provision Anthropic billing browser profile for Finance Specialist",
                severity: "medium",
                description: "Give Finance Specialist a scoped browser identity for Anthropic billing.",
                metadata: {
                  askKind: "human_finance_gap",
                  providerName: "Anthropic",
                  routeTarget: "/platform/ai/browser-sessions/setup",
                  missingFields: ["serviceAccountBrowserProfile", "billingPortalAuthentication"],
                  suggestedQuestion:
                    "Can you sign in once to the Anthropic billing portal so Finance Specialist can read the current Claude subscription cost and renewal date?",
                },
              },
            ],
            actualSpendMtd: { costUsd: 0, calls: 42 },
          },
        ] as any}
      />,
    );

    expect(html).toContain("Unpriced active providers");
    expect(html).toContain("2 need finance setup");
    expect(html).toContain("Employee asks queued");
    expect(html).toContain("Finance Specialist needs human input");
    expect(html).toContain("Provision Anthropic billing browser profile for Finance Specialist");
    expect(html).toContain("Can you sign in once to the Anthropic billing portal");
    expect(html).toContain("Service account browser profile");
    expect(html).toContain('href="/platform/ai/browser-sessions/setup"');
    expect(html).toContain("Ask Finance Specialist");
    expect(html).toContain("Browser profile needed");
    expect(html).toContain("Record subscription payment");
    expect(html).toContain("Monthly");
    expect(html).toContain("Covered providers");
  });

  it("shows shared subscription billing evidence in provider rows", () => {
    const html = renderToStaticMarkup(
      <AiSpendWorkspace
        currencySymbol="$"
        overview={{
          supplierCount: 2,
          activeProviderCount: 2,
          untrackedProviderCount: 0,
          committedSpend: 20,
          contractsNeedingSetup: 0,
          openWorkItems: 0,
          projectedUnusedCommitment: 0,
          actualMeteredSpendUsd: 0,
          inferenceCallsThisMonth: 0,
          monthStart: new Date("2026-06-01T00:00:00.000Z"),
        } as any}
        rows={[
          {
            id: "profile-chatgpt",
            providerId: "chatgpt",
            status: "active",
            provider: {
              providerId: "chatgpt",
              name: "ChatGPT",
              status: "active",
            },
            supplier: { id: "supplier-openai", supplierId: "SUP-OAI", name: "OpenAI" },
            supplierContracts: [
              {
                id: "contract-openai",
                status: "active",
                billingCadence: "monthly",
                billingDayOfMonth: 19,
                paymentMethod: "card",
                monthlyCommittedAmount: 20,
                coveredProviderIds: ["chatgpt", "codex"],
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
                usageSnapshots: [],
              },
            ],
            financeWorkItems: [],
            actualSpendMtd: { costUsd: 0, calls: 0 },
          },
        ] as any}
      />,
    );

    expect(html).toContain("Monthly · day 19 · Card");
    expect(html).toContain("Covers 2 provider rows");
    expect(html).toContain("Paid · Jun 19 · $20.00");
    expect(html).toContain('href="/finance/bills/bill-openai"');
  });
});
