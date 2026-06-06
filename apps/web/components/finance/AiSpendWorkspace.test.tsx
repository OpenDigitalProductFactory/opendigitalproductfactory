import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
    expect(html).toContain("Human asks queued");
    expect(html).toContain("Finance Specialist needs human input");
    expect(html).toContain("Provision Anthropic billing browser profile for Finance Specialist");
    expect(html).toContain("Can you sign in once to the Anthropic billing portal");
    expect(html).toContain("Service account browser profile");
    expect(html).toContain('href="/platform/ai/browser-sessions/setup"');
    expect(html).toContain("Ask Finance Specialist");
    expect(html).toContain("Browser profile needed");
    expect(html).not.toContain(">subscription<");
  });
});
