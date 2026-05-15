export const ROUTE_DECISION_ACTOR_KINDS = ["agent", "scheduler", "system", "user"] as const;

export type RouteDecisionActorKind = (typeof ROUTE_DECISION_ACTOR_KINDS)[number];
export type RouteDecisionLogActorKind = RouteDecisionActorKind | "legacy_unattributed";

export type RouteDecisionActor = {
  kind: RouteDecisionActorKind;
  id: string;
};

export type NormalizedRouteDecisionActor = {
  actorKind: RouteDecisionActorKind;
  actorId: string;
  agentId: string | null;
};

export class RouteDecisionAttributionError extends Error {
  constructor(message = "RouteDecisionLog requires an actor before it can be persisted.") {
    super(message);
    this.name = "RouteDecisionAttributionError";
  }
}

export function normalizeRouteDecisionActor(actor: RouteDecisionActor | null | undefined): NormalizedRouteDecisionActor {
  const kind = actor?.kind;
  const actorId = actor?.id?.trim();

  if (!kind || !actorId) {
    throw new RouteDecisionAttributionError();
  }
  if (!ROUTE_DECISION_ACTOR_KINDS.includes(kind)) {
    throw new RouteDecisionAttributionError(`Unsupported RouteDecisionLog actor kind: ${kind}`);
  }

  return {
    actorKind: kind,
    actorId,
    agentId: kind === "agent" ? actorId : null,
  };
}

export function routeDecisionActorFromAgent(agentId: string | null | undefined): RouteDecisionActor | null {
  const id = agentId?.trim();
  return id ? { kind: "agent", id } : null;
}
