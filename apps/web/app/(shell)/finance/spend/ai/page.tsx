import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { AiSpendWorkspace } from "@/components/finance/AiSpendWorkspace";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import {
  getAiSpendOverview,
  listAiProviderFinanceProfiles,
  maybeRunAiProviderFinanceDailyEvaluation,
} from "@/lib/finance/ai-provider-finance";

export default async function AiSpendPage() {
  await maybeRunAiProviderFinanceDailyEvaluation().catch(() => undefined);

  const [overview, rows, orgSettings] = await Promise.all([
    getAiSpendOverview(),
    listAiProviderFinanceProfiles(),
    getOrgSettings(),
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

      <AiSpendWorkspace
        overview={overview}
        rows={rows}
        currencySymbol={getCurrencySymbol(orgSettings.baseCurrency)}
      />
    </div>
  );
}
