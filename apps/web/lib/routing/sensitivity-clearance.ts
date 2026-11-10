// apps/web/lib/routing/sensitivity-clearance.ts
//
// The data-sensitivity fence predicates. Extracted from pipeline-v2.ts so the
// break-glass override (BI-4512E7D2) can add its second, distinct path without
// pushing the router module over its size ceiling — and so the "genuinely safe"
// vs "risk-accepted" distinction lives in one small, obvious place.

import type { EndpointManifest } from "./types";
import type { RequestContract } from "./request-contract";

/**
 * True when the endpoint is GENUINELY cleared for the sensitivity — its account
 * is verified-safe (or the least-sensitive `development` case, since source code
 * ≤ public data). Excludes any break-glass risk acceptance, so ranking can prefer
 * a genuinely-safe endpoint over a risk-accepted one.
 */
export function endpointGenuinelyClearsSensitivity(
  ep: EndpointManifest,
  sensitivity: RequestContract["sensitivity"],
): boolean {
  if (ep.sensitivityClearance.includes(sensitivity)) return true;
  if (sensitivity === "development" && ep.sensitivityClearance.includes("public")) {
    return true;
  }
  return false;
}

/**
 * True when routing is PERMITTED for the sensitivity: the endpoint is genuinely
 * cleared, or an operator has explicitly risk-accepted this sensitivity for the
 * provider (break-glass). The two reasons stay separate — `riskAcceptedClearances`
 * is never merged into `sensitivityClearance` — so exclusion traces and coworker
 * dead-end copy remain truthful about which one applied. (BI-4512E7D2)
 */
export function endpointClearsSensitivity(
  ep: EndpointManifest,
  sensitivity: RequestContract["sensitivity"],
): boolean {
  if (endpointGenuinelyClearsSensitivity(ep, sensitivity)) return true;
  if (ep.riskAcceptedClearances?.includes(sensitivity)) return true;
  return false;
}
