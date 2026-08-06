import type { SensitivityLevel } from "./agent-router-types";

export type RouteContextDef = {
  routePrefix: string;
  /**
   * Route-matching mode for the domain-context injector (resolveRouteContext),
   * mirroring the PAGE DATA injector's PageContextProvider.match (design spec
   * 2026-08-05 §6.2/§8, no data inheritance).
   *   "prefix" (default) — matches this route and its descendants; used by
   *     section entries whose children genuinely share the identity (/build,
   *     /platform, /compliance, ...).
   *   "exact" — matches ONLY this route; its identity never leaks to a
   *     descendant. Used by entries whose domainContext asserts a SPECIFIC page
   *     that would be wrong for a sibling (e.g. /ops = "the delivery backlog";
   *     /ops/patches is a different page). Generalizes the BI-5457E216 guard
   *     into a runtime fix.
   */
  match?: "exact" | "prefix";
  domain: string;
  sensitivity: SensitivityLevel;
  domainContext: string;
  domainTools: string[];
  docsPath?: string;
  skills: Array<{
    label: string;
    description: string;
    capability: string | null;
    prompt: string;
    taskType?: "conversation" | "code_generation" | "analysis";
  }>;
};
