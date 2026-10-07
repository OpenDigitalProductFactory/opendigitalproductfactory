import type { AcceptanceSweepPageItem } from "./acceptance-sweep-page";
import type { OwedAcceptance } from "./owed-acceptance";
import type { RouteOutcome } from "./route-aged-item";

// The routing step of one acceptance sweep run (BI-C1781121, design §3.3 step 4
// and §3.4): which page items are candidates, and how their outcomes read in
// the run summary. The rooms themselves are route-aged-item.ts.
//
// Composition with closing (BI-45D3BBF4): an item whose completion verdict is
// already `allowed` is closable. Nothing is owed on it, so there is nothing for
// a coworker to verify; under the operator pre-authorisation the close step
// settles it, and without one the summary reports it closable. Either way it
// is never a routing candidate, so no item gets both a closure and a room.

/** One aged, evaluated, non-closable page item the run may route. */
export type AgedSweepCandidate = {
  item: AcceptanceSweepPageItem;
  ageDays: number;
  projection: OwedAcceptance;
};

export type AcceptanceSweepRouting = {
  enabled: boolean;
  /** Steward rooms this run may create; existing rooms do not count against it. */
  routeLimit: number;
  /** Aged, evaluated, not closable: the items routing considered. */
  candidates: number;
  routed: number;
  alreadyRouted: number;
  routedUnresolved: number;
  unroutable: number;
  /** Aged and routable, but past this run's route limit: a later run takes them. */
  deferred: number;
  unroutableByReason: Record<string, number>;
  rooms: Array<Pick<RouteOutcome, "itemId" | "outcome" | "capsuleId" | "ownerAgentId" | "ageDays" | "reason">>;
  /** Set when the routing step itself failed; the rest of the run still recorded. */
  error: string | null;
};

export function emptyRouting(enabled: boolean, routeLimit: number): AcceptanceSweepRouting {
  return {
    enabled,
    routeLimit: enabled ? Math.max(0, routeLimit) : 0,
    candidates: 0,
    routed: 0,
    alreadyRouted: 0,
    routedUnresolved: 0,
    unroutable: 0,
    deferred: 0,
    unroutableByReason: {},
    rooms: [],
    error: null,
  };
}

/** A page item routing considers: aged by the run's threshold, evaluated, and not closable. */
export function isRoutingCandidate(ageDays: number | undefined, agedDays: number, projection: OwedAcceptance): ageDays is number {
  return ageDays !== undefined && ageDays >= agedDays && !projection.closable;
}

const COUNTER = {
  routed: "routed",
  "already-routed": "alreadyRouted",
  "routed-unresolved": "routedUnresolved",
  unroutable: "unroutable",
  deferred: "deferred",
} as const;

export function foldRouteOutcomes(routing: AcceptanceSweepRouting, outcomes: readonly RouteOutcome[]): void {
  for (const outcome of outcomes) {
    routing[COUNTER[outcome.outcome]] += 1;
    if (outcome.outcome === "unroutable" && outcome.reason) {
      for (const reason of outcome.reason.split(",").map((part) => part.trim()).filter(Boolean)) {
        routing.unroutableByReason[reason] = (routing.unroutableByReason[reason] ?? 0) + 1;
      }
    }
    routing.rooms.push({
      itemId: outcome.itemId,
      outcome: outcome.outcome,
      capsuleId: outcome.capsuleId,
      ownerAgentId: outcome.ownerAgentId,
      ageDays: outcome.ageDays,
      reason: outcome.reason,
    });
  }
}

export function routingHeadline(routing: AcceptanceSweepRouting): string {
  if (!routing.enabled) return "routing off";
  if (routing.error) return `routing failed (${routing.error.slice(0, 80)})`;
  return `routing: ${routing.routed} routed, ${routing.alreadyRouted} already routed, `
    + `${routing.routedUnresolved} routed-unresolved, ${routing.unroutable} unroutable, `
    + `${routing.deferred} deferred past the limit of ${routing.routeLimit}`;
}
