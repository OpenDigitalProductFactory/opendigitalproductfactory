import { formatBudget } from "@/lib/portfolio";
import type { ProvenancedMetric } from "@/lib/surface-data-provenance";

export type PortfolioBudgetMetric = ProvenancedMetric<string>;

const PLACEHOLDER_PORTFOLIO_BUDGETS: Record<string, number> = {
  foundational: 2500,
  manufacturing_and_delivery: 1800,
  for_employees: 1200,
  products_and_services_sold: 3500,
};

export function getPortfolioBudgetMetric(
  slug: string,
  budgetKUsd: number | null | undefined,
): PortfolioBudgetMetric {
  if (budgetKUsd === null || budgetKUsd === undefined || budgetKUsd <= 0) {
    return {
      label: "Budget",
      value: formatBudget(budgetKUsd),
      provenance: {
        kind: "not-connected",
        label: "No connected budget source",
        description:
          "No live finance, setup, or connected-account budget source is recorded for this portfolio.",
        sourceTable: "Portfolio",
      },
    };
  }

  if (PLACEHOLDER_PORTFOLIO_BUDGETS[slug] === budgetKUsd) {
    return {
      label: "Budget",
      value: formatBudget(budgetKUsd),
      provenance: {
        kind: "demo-placeholder",
        label: "Planning placeholder",
        description:
          "This matches the seeded demonstration budget used before a real finance or setup source is connected.",
        sourceTable: "Portfolio",
      },
    };
  }

  return {
    label: "Budget",
    value: formatBudget(budgetKUsd),
    provenance: {
      kind: "live-db",
      label: "Stored budget",
      description:
        "Stored in Portfolio.budgetKUsd. This is live DPF data, not external provider billing.",
      sourceTable: "Portfolio",
    },
  };
}
