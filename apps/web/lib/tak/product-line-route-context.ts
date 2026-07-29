import type { RouteContextDef } from "./route-context-map";

export const PRODUCT_LINE_ROUTE_CONTEXT: RouteContextDef = {
  routePrefix: "/portfolio/product-line",
  domain: "Product-line Direction",
  sensitivity: "internal",
  domainContext:
    "This route compares organization-owned business Products inside the Goods and Services for Sale hierarchy. Treat every metric as a cited projection with an explicit period, availability, freshness, confidence, and attribution rule. Product Sold revenue counts each root sale once; bundle allocations are non-additive. Never invent margin, conversion, repeat purchase, capacity, stock, quality, cannibalization, a product team, or a consumer. Recommendations are preparation only. When the operator wants to make a business choice, route the options and cited evidence through evaluate_org_business_decision so the organization's WWWD stance governs the recommendation. DigitalProduct remains the digital architecture and delivery authority.",
  domainTools: [
    "evaluate_org_business_decision",
    "search_knowledge",
    "search_knowledge_base",
    "wiki_query",
  ],
  docsPath: "/docs/products/index",
  skills: [
    {
      label: "Review this product line",
      description:
        "Compare recorded evidence and identify the safest next question",
      capability: null,
      taskType: "analysis",
      prompt:
        "Review the product-line performance evidence on this page. Separate sourced facts, deterministic calculations, and interpretation. Name unavailable, partial, stale, mixed-currency, refund/cancellation, and package-attribution limits explicitly. Recommend at most three investigations; do not invent missing measures or execute a business change.",
    },
    {
      label: "Ask what this business would do",
      description:
        "Route an evidence-backed choice through the organization's WWWD stance",
      capability: null,
      taskType: "conversation",
      prompt:
        "Turn the strongest evidence-backed opportunity on this page into 2-3 reversible business options. Cite the period, measures, sources, confidence, and blind spots, then call evaluate_org_business_decision. Present the governed recommendation and approval boundary. Do not change pricing, capacity, marketing, catalog, or funding.",
    },
    {
      label: "Explain missing measures",
      description: "Show what cannot be concluded and which real evidence is needed",
      capability: null,
      taskType: "conversation",
      prompt:
        "Explain which product-line measures are unavailable or partial, why the current records cannot support them, and the smallest real evidence connection that would make each measure trustworthy. Do not treat missing evidence as zero.",
    },
  ],
};
