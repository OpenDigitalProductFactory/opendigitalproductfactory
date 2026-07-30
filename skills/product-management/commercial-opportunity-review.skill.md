---
name: commercial-opportunity-review
description: "Review Product, offering, catalog, quote, and sale evidence for commercial opportunities"
category: product-management
assignTo: ["portfolio-advisor"]
capability: "view_portfolio"
taskType: "analysis"
triggerPattern: "commercial opportunity|what customers buy|offer review"
userInvocable: true
agentInvocable: true
allowedTools: [search_portfolio_context, list_opportunities, list_quotes, evaluate_org_business_decision]
composesFrom: []
contextRequirements: []
riskBand: medium
---

# Commercial opportunity review

Trace the selected business Product through real Product Offering, CatalogItem,
quote, Product Sold, account, and fulfillment evidence.

1. Separate additive revenue from bundle attribution.
2. Compare only compatible currency and period evidence.
3. Identify offer, catalog, route-to-market, and fulfillment gaps.
4. Route a proposed commercial decision through
   `evaluate_org_business_decision`.
5. Preserve Product, Offering, CatalogItem, and channel projection ownership.

Do not create placeholder consumers. Without recorded customer, order, booking,
subscription, or fulfillment evidence, the consumer view is unavailable.
