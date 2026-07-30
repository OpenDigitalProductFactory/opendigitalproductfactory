import {
  classifyRoute,
  type ClassifiableRoute,
  type RouteAudience,
  type RouteDestinationKind,
} from "../navigation/route-audience";
import { shellPolicyFor, type RouteShellPolicy } from "./route-shells";

export type RoutePolicyManifestRow = ClassifiableRoute & {
  kind: string;
};

export type RoutePolicy = RouteShellPolicy & {
  audience: RouteAudience;
  destinationKind: RouteDestinationKind;
  confidence: "high" | "low";
  classificationSource: "heuristic" | "override";
};

/**
 * Build one policy projection from the canonical route manifest. Generators
 * consume this function instead of independently filtering and classifying
 * routes.
 */
export function buildRoutePolicies(
  manifestRows: readonly RoutePolicyManifestRow[],
): RoutePolicy[] {
  return manifestRows
    .filter((route) => route.kind === "page" && !route.redirectTo)
    .map((route) => {
      const classification = classifyRoute(route);
      return {
        ...shellPolicyFor(route.routePath, classification),
        audience: classification.audience,
        destinationKind: classification.destinationKind,
        confidence: classification.confidence,
        classificationSource: classification.source,
      };
    });
}
