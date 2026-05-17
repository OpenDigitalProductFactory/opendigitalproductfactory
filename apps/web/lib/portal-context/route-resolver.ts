import { ROUTE_CONTEXT_MAP, resolveRouteContext } from "@/lib/route-context-map";

import type { AttentionSignal, PortalContextInput, PortalObjectAnchor } from "./types";

export type PortalRouteProjection = {
  route: {
    pathname: string;
    routeContext: string;
    domain: string;
    sensitivity: string;
    docsPath?: string | null;
  };
  anchors: PortalObjectAnchor[];
  attention: AttentionSignal[];
  domainTools: string[];
};

export function resolvePortalRoute(input: PortalContextInput): PortalRouteProjection {
  const routeDef = resolveRouteContext(input.routeContext || input.pathname);
  const registered = Object.keys(ROUTE_CONTEXT_MAP).some(
    (prefix) => input.routeContext === prefix || input.routeContext.startsWith(`${prefix}/`),
  );

  return {
    route: {
      pathname: input.pathname,
      routeContext: input.routeContext,
      domain: routeDef.domain,
      sensitivity: routeDef.sensitivity,
      docsPath: routeDef.docsPath ?? null,
    },
    anchors: [
      {
        kind: "branch",
        id: input.pathname,
        label: routeDef.domain,
        href: input.pathname,
      },
    ],
    attention: registered
      ? []
      : [
          {
            kind: "unknown_route",
            severity: "info",
            message: "Route is not registered in the portal context resolver.",
          },
        ],
    domainTools: routeDef.domainTools,
  };
}
