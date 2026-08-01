import type { RouteContextDef } from "./route-context-types";

export const AGRICULTURE_ROUTE_CONTEXT: Record<string, RouteContextDef> = {
  "/coworker-decisions/craft/agricultural-operations": {
    routePrefix: "/coworker-decisions/craft/agricultural-operations",
    domain: "Agricultural Operations Craft (WSID)",
    sensitivity: "confidential",
    domainContext:
      "This profession-corpus page grounds the Farm & Ranch Steward in seasonal land, crop, forage, livestock, working-animal, equipment, vendor, weather, market, and regulated-input operations. Guidance must be filtered by the install's agriculture-ranching archetype and jurisdiction, distinguish forecasts from facts, and retain human approval for regulated, clinical, financial, and external actions.",
    domainTools: ["wiki_query", "search_knowledge", "search_knowledge_base", "evaluate_profession_decision"],
    docsPath: "/docs/wiki/index",
    skills: [
      { label: "Build seasonal plan", description: "Sequence biological and weather-sensitive work", capability: "view_platform", prompt: "Build a seasonal operating plan from this corpus, including dependencies and decision windows." },
      { label: "Readiness review", description: "Find animal, equipment, input, and service gaps", capability: "view_platform", prompt: "Review upcoming readiness risks and show the highest-consequence gaps first." },
      { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
  },
};
