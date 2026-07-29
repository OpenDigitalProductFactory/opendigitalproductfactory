/**
 * Business Product and legacy DigitalProduct route context.
 *
 * Kept outside the central registry so this authority boundary and its
 * product-management actions can evolve without re-growing the route map.
 */
export const PRODUCT_ROUTE_CONTEXT = {
  routePrefix: "/portfolio/product",
  domain: "Products",
  sensitivity: "internal" as const,
  domainContext:
    "This historic route resolves one of two explicit authorities. A business Product is owned by Goods and Services for Sale and may expose direction, intelligence, demand, commercial packaging, typed outcome learning, and an evidence-derived roadmap. A DigitalProduct remains the digital architecture and delivery authority. Never infer one from the other, invent a team or consumer, attach a business objective to DigitalProduct, fabricate a roadmap date, or make a roadmap snapshot into planning authority. On a business Product roadmap, committed bets require governed funding and an explicit active-objective link; edits route to the owning demand, objective, dependency, or delivery record.",
  domainTools: [
    "summarize_estate_posture",
    "review_estate_identity",
    "validate_version_confidence",
    "explain_blast_radius",
    "create_product_objective",
    "update_product_objective",
    "review_product_objective",
    "transition_product_objective",
    "link_product_objective_work",
    "record_product_outcome_observation",
    "correct_product_outcome_observation",
    "evaluate_org_business_decision",
    "wiki_query",
    "search_knowledge",
    "search_knowledge_base",
  ],
  docsPath: "/docs/products/index",
  skills: [
    {
      label: "Review this roadmap",
      description:
        "Review commitments, readiness gaps, confidence, dates, and dependencies",
      capability: "manage_backlog",
      prompt:
        "Review the current business Product roadmap projection. Separate committed bets from the readiness queue, explain confidence and unsupported dates, and identify architecture coordination without turning DigitalProduct evidence into business-product planning authority. If stakeholders need to record a review, use evaluate_org_business_decision and preview the auditable decision before any write.",
    },
    {
      label: "Explain a missing bet",
      description:
        "Show exactly which funding, objective, or evidence boundary is incomplete",
      capability: "manage_backlog",
      prompt:
        "Explain why the selected demand item is not a committed roadmap bet. Check canonical demand classification and funding, active-objective linkage, delivery consistency, and evidence confidence. Do not move the item, invent a link, or promise a date; route the user to the owning control.",
    },
    {
      label: "Define an outcome",
      description: "Capture what should improve and how evidence will be reviewed",
      capability: "manage_backlog",
      prompt:
        "Help me define a product outcome. Confirm this is a business Product, ask for the problem, hoped-for change, measure, honest baseline, target, and review date, then preview the governed create_product_objective write. Do not invent missing evidence or use DigitalProduct as the owner.",
    },
    {
      label: "Review outcome evidence",
      description: "Assess current observations without filling evidence gaps",
      capability: "manage_backlog",
      prompt:
        "Review the product outcome evidence on this page. Lead with overdue reviews and changed posture. Name missing baselines or incompatible measures as insufficient evidence, and only propose an observation or review write after showing its source and effect.",
    },
    {
      label: "Summarize estate posture",
      description: "Highlight the biggest support, freshness, and evidence risks",
      capability: "view_inventory",
      prompt:
        "Summarize the estate posture for this product and tell me what needs attention first.",
    },
    {
      label: "Review item identity",
      description:
        "Explain who made the item, what it likely is, and how solid that identity is",
      capability: "view_inventory",
      prompt:
        "Review the identity evidence for this item and tell me what we know versus what still needs review.",
    },
    {
      label: "Explain blast radius",
      description: "Show what breaks or becomes unreachable if an item fails",
      capability: "view_inventory",
      prompt: "Explain the blast radius for the item I'm looking at.",
    },
    {
      label: "Check support posture",
      description: "Assess vendor support lifecycle and update posture",
      capability: "view_inventory",
      prompt: "Check the support posture for this item.",
    },
    {
      label: "Check version confidence",
      description: "Explain how strong the version evidence really is",
      capability: "view_inventory",
      prompt: "Check how confident we are in the version information for this item.",
    },
    {
      label: "Report an issue",
      description: "Report a bug or give feedback",
      capability: null,
      prompt: "I'd like to report an issue or give feedback about this page.",
    },
  ],
};
