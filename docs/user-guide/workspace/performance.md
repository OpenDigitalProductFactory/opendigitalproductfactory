---
title: "Performance"
area: workspace
order: 5
relatedRoutes: ["/performance", "/finance/reports/general-ledger"]
relatedCode: ["apps/web/lib/performance/business-performance-provider.ts", "apps/web/lib/performance/business-metric-rollup.ts", "apps/web/lib/finance/ledger-service.ts", "apps/web/components/performance/BusinessPerformanceDashboard.tsx"]
---

## Review recorded results

For a software-platform business, **Performance** shows income, expenses and net result from the management-ledger entries already recorded in DPF. Check the displayed UTC month, currency and snapshot age. A current month is partial. A past month does not prove the books are complete or closed.

These figures do not claim bank cash, tax profit, gross margin, customer outcomes or runway. They do not convert currencies. Incompatible currencies, incomplete or unsupported records and oversized reads remain unavailable rather than being combined into a plausible total.

**Review finance records** opens the same month in General Ledger. That report uses your current organization and existing Finance permission. Its selected-month values are movements for that month; prior capital and opening records appear only in the explicit **All recorded** view. Neither view certifies a bank balance or an as-of financial position.

## Missing records and zero

An available zero comes from validated eligible journal records. No eligible entries or an unconfigured chart show a reason and a native Finance action. They do not become zero income or zero cost. Follow the action to review Finance setup or source records; record only real business transactions through their supported workflows.

A delayed snapshot retains the last saved result. Its age remains visible while refresh retries. A failed source read does not publish a fresh zero. If validation fails after a valid result exists, **Refresh failed** marks the retained result and its original source age; recovery replaces it only after a successful coherent refresh. Correct the underlying records or availability and let the existing refresh recover; do not duplicate transactions to force a result.

Open **How this is calculated** for definitions and source information. **Explore results** retains trends, analysis and an aggregate export with the recorded currency. Missing historical values remain blank/unavailable. Partial-month versus full-month percentages and incompatible-currency comparisons are suppressed.

Other supported business types keep their existing measures. Results and Finance source access retain their existing role controls.
