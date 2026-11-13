import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { AiSpendWorkspace } from "@/components/finance/AiSpendWorkspace";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import {
  getAiSpendOverview,
  listAiProviderFinanceProfiles,
  maybeRunAiProviderFinanceDailyEvaluation,
} from "@/lib/finance/ai-provider-finance";
import { SubscriptionCostEstimatesPanel } from "@/components/finance/SubscriptionCostEstimatesPanel";
import {
  loadSubscriptionCostEstimates,
  loadUnpricedSubscriptionProviders,
} from "@/lib/finance/subscription-cost-estimator.server";

export default async function AiSpendPage() {
  await maybeRunAiProviderFinanceDailyEvaluation().catch(() => undefined);

  const [overview, rows, orgSettings, subscriptionPlans, unpricedSubscriptions] = await Promise.all([
    getAiSpendOverview(),
    listAiProviderFinanceProfiles(),
    getOrgSettings(),
    loadSubscriptionCostEstimates(),
    loadUnpricedSubscriptionProviders(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">AI Spend</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Finance-owned view of AI suppliers, commitments, and allowance utilization.
        </p>
      </div>

      <FinanceTabNav />

      <div className="mb-6">
        <SubscriptionCostEstimatesPanel plans={subscriptionPlans} unpriced={unpricedSubscriptions} />
      </div>

      <AiSpendWorkspace
        overview={overview}
        rows={rows}
        currencySymbol={getCurrencySymbol(orgSettings.baseCurrency)}
      />
    </div>
  );
}
