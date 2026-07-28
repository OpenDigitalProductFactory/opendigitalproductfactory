import {
  classifyContextFreshness,
  type ContextAvailability,
  type ContextFreshness,
  type ProductOperatingContext,
} from "./product-operating-context";

export type ProductDirectionAudience = "guided" | "professional";

export type ProductDirectionSectionKind =
  | "needs-decision"
  | "evidence-delta"
  | "current-bets"
  | "outcome-posture"
  | "next-coworker-runs";

export type ProductDirectionItem = {
  id: string;
  label: string;
  status: string;
  sourceKind: string;
  asOf: Date;
  detail: string | null;
};

export type ProductDirectionSection = {
  kind: ProductDirectionSectionKind;
  title: string;
  description: string;
  availability: ContextAvailability;
  freshness: ContextFreshness;
  asOf: Date;
  sourceKind: string;
  reason: string | null;
  items: ProductDirectionItem[];
};

export type ProductDirectionView = {
  audience: ProductDirectionAudience;
  introduction: string;
  evidencePreviewCount: number;
  sections: ProductDirectionSection[];
  primaryAction: {
    label: string;
    href: string;
  };
};

function availabilityFor(
  items: readonly ProductDirectionItem[],
  fallback: {
    availability: ContextAvailability;
    reason: string | null;
  },
): Pick<ProductDirectionSection, "availability" | "reason"> {
  if (items.length > 0) {
    return {
      availability:
        fallback.availability === "partial" ? "partial" : "available",
      reason: fallback.availability === "partial" ? fallback.reason : null,
    };
  }
  return {
    availability: fallback.availability,
    reason: fallback.reason,
  };
}

function demandItem(
  item: ProductOperatingContext["demand"]["items"][number],
): ProductDirectionItem {
  const stage = item.demandStage ?? "needs classification";
  const readiness = item.readiness
    ? [
        item.readiness.evidenceReady ? "evidence linked" : "evidence needed",
        item.readiness.scoreReady ? "score ready" : "score incomplete",
      ].join(" · ")
    : item.score == null
      ? "not scored"
      : `score ${item.score}`;
  const decision = item.latestDecision
    ? ` · ${item.latestDecision.summary}`
    : "";
  return {
    id: item.id,
    label: item.title,
    status: item.status,
    sourceKind: item.sourceKind,
    asOf: item.asOf,
    detail: `${stage} · ${readiness}${decision}`,
  };
}

export function buildProductDirectionView(
  context: ProductOperatingContext,
  audience: ProductDirectionAudience,
): ProductDirectionView {
  const decisionItems = [
    ...context.decisions.items.map((item) => ({
      id: item.id,
      label: item.title,
      status: item.status,
      sourceKind: item.sourceKind,
      asOf: item.asOf,
      detail: "Recorded decision interaction",
    })),
    ...context.demand.items
      .filter(
        (item) =>
          item.status === "open" &&
          item.demandStage !== "ready",
      )
      .map(demandItem),
  ].sort(
    (left, right) =>
      right.asOf.getTime() - left.asOf.getTime() ||
      left.id.localeCompare(right.id),
  );

  const changedItems: ProductDirectionItem[] = [
    ...context.intelligence.items.map((item) => ({
      id: item.id,
      label: item.title,
      status: item.status,
      sourceKind: item.sourceKind,
      asOf: item.asOf,
      detail:
        item.scope === "organization"
          ? "Organization-wide evidence"
          : "Evidence linked through an enabling digital product",
    })),
    ...context.deliveryChanges.items.map((item) => ({
      id: item.id,
      label: item.title,
      status: item.status,
      sourceKind: item.sourceKind,
      asOf: item.asOf,
      detail: "Delivery change",
    })),
  ]
    .sort(
      (left, right) =>
        right.asOf.getTime() - left.asOf.getTime() ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 8);

  const currentBets = context.demand.items
    .filter(
      (item) =>
        item.status === "in-progress" || item.demandStage === "ready",
    )
    .map(demandItem);

  const outcomeItems = context.objectives.items.map((item) => ({
    id: item.id,
    label: item.title,
    status: item.status,
    sourceKind: item.sourceKind,
    asOf: item.asOf,
    detail: "Objective and outcome evidence",
  }));

  const coworkerItems = context.scheduledPlaybooks.items.map((item) => ({
    id: item.id,
    label: item.title,
    status: item.status,
    sourceKind: item.sourceKind,
    asOf: item.asOf,
    detail: "Scheduled product-management run",
  }));

  const decisionAvailability = availabilityFor(
    decisionItems,
    {
      availability:
        context.decisions.availability === "unavailable" &&
        context.demand.availability === "unavailable"
          ? "unavailable"
          : context.decisions.availability === "available" &&
              context.demand.availability === "available"
            ? "available"
            : "partial",
      reason: [
        context.decisions.availability !== "available"
          ? context.decisions.reason
          : null,
        context.demand.availability !== "available"
          ? context.demand.reason
          : null,
      ]
        .filter((reason): reason is string => Boolean(reason))
        .join(" ") || null,
    },
  );
  const changedAvailability = availabilityFor(
    changedItems,
    changedItems.length === 0
      ? context.intelligence
      : {
          availability:
            context.intelligence.availability === "available" &&
            context.deliveryChanges.availability === "available"
              ? "available"
              : "partial",
          reason: [
            context.intelligence.availability !== "available"
              ? context.intelligence.reason
              : null,
            context.deliveryChanges.availability !== "available"
              ? context.deliveryChanges.reason
              : null,
          ]
            .filter((reason): reason is string => Boolean(reason))
            .join(" ") || null,
        },
  );
  const betsAvailability = availabilityFor(currentBets, context.demand);
  const outcomeAvailability = availabilityFor(
    outcomeItems,
    context.objectives,
  );
  const coworkerAvailability = availabilityFor(
    coworkerItems,
    context.scheduledPlaybooks,
  );

  return {
    audience,
    introduction:
      audience === "guided"
        ? "See what needs your attention, what changed, and what the available evidence supports next."
        : "Review decision demand, evidence deltas, funded bets, outcome posture, and scheduled product-management work from one governed projection.",
    evidencePreviewCount: audience === "professional" ? 8 : 3,
    primaryAction: {
      label:
        decisionItems.length > 0
          ? "Review demand decisions"
          : "Open product delivery flow",
      href: `/ops/demand?organizationId=${encodeURIComponent(context.provider.id)}${
        context.scope.kind === "product-line"
          ? `&productLineId=${encodeURIComponent(context.productLine?.id ?? context.scope.id)}`
          : context.scope.kind === "product"
            ? `&productLineId=${encodeURIComponent(context.productLine?.id ?? "")}&businessProductId=${encodeURIComponent(context.products[0]?.id ?? context.scope.id)}`
            : ""
      }`,
    },
    sections: [
      {
        kind: "needs-decision",
        title: "Needs your decision",
        description:
          "Recorded decision interactions and open demand that has not crossed the governed funding boundary.",
        ...decisionAvailability,
        freshness:
          decisionItems.length > 0
            ? classifyContextFreshness(
                decisionItems[0]!.asOf,
                context.requestedAt,
                30,
              )
            : context.demand.freshness,
        asOf:
          decisionItems[0]?.asOf ??
          (context.decisions.asOf > context.demand.asOf
            ? context.decisions.asOf
            : context.demand.asOf),
        sourceKind: "decision-interaction-and-backlog-item",
        items: decisionItems,
      },
      {
        kind: "evidence-delta",
        title: "What changed",
        description:
          "The newest product-relevant research and delivery evidence.",
        ...changedAvailability,
        freshness:
          changedItems.length > 0
            ? classifyContextFreshness(
                changedItems[0]!.asOf,
                context.requestedAt,
                30,
              )
            : context.intelligence.freshness,
        asOf:
          changedItems[0]?.asOf ??
          (context.intelligence.asOf > context.deliveryChanges.asOf
            ? context.intelligence.asOf
            : context.deliveryChanges.asOf),
        sourceKind:
          "research-battlecard-knowledge-and-change-item",
        items: changedItems,
      },
      {
        kind: "current-bets",
        title: "Current bets",
        description:
          "Funded or in-progress demand. These remain BacklogItem records.",
        ...betsAvailability,
        freshness: context.demand.freshness,
        asOf: context.demand.asOf,
        sourceKind: context.demand.sourceKind,
        items: currentBets,
      },
      {
        kind: "outcome-posture",
        title: "Are outcomes moving?",
        description:
          "Outcome posture appears only when typed objectives and observations exist.",
        ...outcomeAvailability,
        freshness: context.objectives.freshness,
        asOf: context.objectives.asOf,
        sourceKind: context.objectives.sourceKind,
        items: outcomeItems,
      },
      {
        kind: "next-coworker-runs",
        title: "Next coworker runs",
        description:
          "Scheduled product-management work with an explicit product scope.",
        ...coworkerAvailability,
        freshness: context.scheduledPlaybooks.freshness,
        asOf: context.scheduledPlaybooks.asOf,
        sourceKind: context.scheduledPlaybooks.sourceKind,
        items: coworkerItems,
      },
    ],
  };
}
