import {
  AI_ROUTING_ARCHITECTURE_VERSION,
  AI_ROUTING_STAGES,
} from "./ai-routing-architecture-registry";

export type ArchitectureDrillthroughElement = {
  id: string;
  name: string;
  notationSlug: string;
  properties: Record<string, unknown>;
};

export type ArchitectureDrillthroughRelationship = {
  fromElementId: string;
  toElementId: string;
  relationshipLabel: string;
};

export type ArchitectureViewMembership = {
  elementId: string;
  viewId: string;
  viewName: string;
  notationSlug: string;
  notationName: string;
};

export type RelatedArchitectureView = ArchitectureViewMembership & {
  elementName: string;
  relationshipPath: string[];
  distance: number;
  href: string;
};

export type RoutingDecisionInspection = {
  title: string;
  technicalName: string;
  safeInputs: string[];
  outcomes: string[];
  sourcePath: string;
  sourceSymbol: string | null;
  sourceVersion: string;
  implementationStatus: string;
  latestEvidenceAt: string | null;
};

export type ArchitectureDrillthrough = {
  relatedViews: RelatedArchitectureView[];
  operationsMapHref: string | null;
  source: ArchitectureSourceInspection | null;
  decision: RoutingDecisionInspection | null;
};

export type ArchitectureSourceInspection = {
  path: string;
  symbol: string | null;
  version: string | null;
  implementationStatus: string | null;
  href: string;
};

type DecisionDescriptor = {
  safeInputs: readonly string[];
  outcomes: readonly string[];
};

const DECISION_DESCRIPTORS: Readonly<Record<string, DecisionDescriptor>> = {
  "sensitive-screen": {
    safeInputs: ["Data classes", "Purpose", "Actor and governed assets", "Payload shape"],
    outcomes: ["Allow", "Keep local", "Block"],
  },
  "data-policy-decision": {
    safeInputs: ["Data classes", "Purpose", "Actor and governed assets", "Route boundary"],
    outcomes: ["Allow", "Allow after protection", "Review", "Deny"],
  },
  "data-policy-gateway": {
    safeInputs: ["Data classes", "Purpose", "Actor and governed assets", "Route boundary"],
    outcomes: ["Allow", "Allow after protection", "Review", "Deny"],
  },
  "route-eligibility": {
    safeInputs: ["Task type", "Required capability", "Residency", "Sensitivity", "Contract family"],
    outcomes: ["Eligible", "Excluded with safe reason code"],
  },
  "eligible-route-gateway": {
    safeInputs: ["Eligible route count", "Hard exclusion reason codes"],
    outcomes: ["Continue with eligible routes", "Defer, review, or stop"],
  },
  "availability-and-limits": {
    safeInputs: ["Provider health", "Cooldown", "Quota window", "Short and long time limits"],
    outcomes: ["Available", "Temporarily limited", "Unavailable"],
  },
  "availability-gateway": {
    safeInputs: ["Preferred route availability", "Capacity state", "Limit window"],
    outcomes: ["Use preferred route", "Find governed fallback"],
  },
  "fallback-gateway": {
    safeInputs: ["Original route obligations", "Eligible fallback count", "Capacity state"],
    outcomes: ["Use obligation-preserving fallback", "Defer, review, or stop"],
  },
  "rehydration-gateway": {
    safeInputs: ["Actor", "Surface", "Action", "Readable fields", "Authorization freshness"],
    outcomes: ["Restore protected values", "Return masked response"],
  },
};

const MAX_RELATIONSHIP_DEPTH = 4;

export function buildArchitectureDrillthrough(input: {
  currentViewId: string;
  selectedElementIds: string[];
  elements: ArchitectureDrillthroughElement[];
  relationships: ArchitectureDrillthroughRelationship[];
  memberships: ArchitectureViewMembership[];
  latestEvidenceAt?: string | null;
}): Record<string, ArchitectureDrillthrough> {
  const elementById = new Map(input.elements.map((element) => [element.id, element]));
  const membershipsByElement = groupBy(input.memberships, (membership) => membership.elementId);
  const adjacency = new Map<
    string,
    Array<{ elementId: string; relationshipLabel: string }>
  >();

  for (const relationship of input.relationships) {
    pushMapArray(adjacency, relationship.fromElementId, {
      elementId: relationship.toElementId,
      relationshipLabel: relationship.relationshipLabel,
    });
    pushMapArray(adjacency, relationship.toElementId, {
      elementId: relationship.fromElementId,
      relationshipLabel: relationship.relationshipLabel,
    });
  }

  return Object.fromEntries(
    input.selectedElementIds.map((elementId) => {
      const element = elementById.get(elementId);
      const relatedViews = element
        ? findRelatedViews({
            root: element,
            currentViewId: input.currentViewId,
            adjacency,
            elementById,
            membershipsByElement,
          })
        : [];
      const registryKey = stringValue(element?.properties.registryKey);
      const source = inspectArchitectureSource(element?.properties ?? {});
      return [
        elementId,
        {
          relatedViews,
          operationsMapHref:
            registryKey || isRoutingArchitecture(element?.properties ?? {})
              ? `/platform/ai/operations-map?mode=compare&focus=${encodeURIComponent(registryKey ?? "architecture")}`
              : null,
          source,
          decision: inspectRoutingDecision({
            properties: element?.properties ?? {},
            latestEvidenceAt: input.latestEvidenceAt ?? null,
          }),
        },
      ];
    }),
  );
}

export function inspectArchitectureSource(
  properties: Record<string, unknown>,
): ArchitectureSourceInspection | null {
  const parsed = parseSourceKey(stringValue(properties.sourceKey));
  if (!parsed.path) return null;
  return {
    path: parsed.path,
    symbol: parsed.symbol,
    version: stringValue(properties.sourceVersion),
    implementationStatus: stringValue(properties.implementationStatus),
    href: `https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/${parsed.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
  };
}

export function inspectRoutingDecision(input: {
  properties: Record<string, unknown>;
  latestEvidenceAt: string | null;
}): RoutingDecisionInspection | null {
  const registryKey = stringValue(input.properties.registryKey);
  if (!registryKey) return null;
  const descriptor = DECISION_DESCRIPTORS[registryKey];
  if (!descriptor) return null;
  const stage = AI_ROUTING_STAGES.find((candidate) => candidate.id === registryKey);
  if (!stage) return null;
  const source = parseSourceKey(stringValue(input.properties.sourceKey));

  return {
    title: stage.ownerLabel,
    technicalName: stage.technicalName,
    safeInputs: [...descriptor.safeInputs],
    outcomes: [...descriptor.outcomes],
    sourcePath: source.path,
    sourceSymbol: source.symbol,
    sourceVersion: stringValue(input.properties.sourceVersion) ?? stage.source.version,
    implementationStatus:
      stringValue(input.properties.implementationStatus) ?? stage.source.status,
    latestEvidenceAt: input.latestEvidenceAt,
  };
}

function findRelatedViews(input: {
  root: ArchitectureDrillthroughElement;
  currentViewId: string;
  adjacency: Map<string, Array<{ elementId: string; relationshipLabel: string }>>;
  elementById: Map<string, ArchitectureDrillthroughElement>;
  membershipsByElement: Map<string, ArchitectureViewMembership[]>;
}): RelatedArchitectureView[] {
  const queue: Array<{ elementId: string; path: string[]; distance: number }> = [
    { elementId: input.root.id, path: [], distance: 0 },
  ];
  const shortestDistance = new Map<string, number>([[input.root.id, 0]]);
  const related: RelatedArchitectureView[] = (
    input.membershipsByElement.get(input.root.id) ?? []
  )
    .filter((membership) => membership.viewId !== input.currentViewId)
    .map((membership) => ({
      ...membership,
      elementName: input.root.name,
      relationshipPath: ["Same architecture element"],
      distance: 0,
      href: `/ea/views/${encodeURIComponent(membership.viewId)}?element=${encodeURIComponent(input.root.id)}`,
    }));

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.distance >= MAX_RELATIONSHIP_DEPTH) continue;
    const neighbours = [...(input.adjacency.get(current.elementId) ?? [])].sort(
      (left, right) =>
        left.relationshipLabel.localeCompare(right.relationshipLabel) ||
        left.elementId.localeCompare(right.elementId),
    );

    for (const neighbour of neighbours) {
      const distance = current.distance + 1;
      const previousDistance = shortestDistance.get(neighbour.elementId);
      if (previousDistance !== undefined && previousDistance <= distance) continue;
      shortestDistance.set(neighbour.elementId, distance);
      const path = [...current.path, neighbour.relationshipLabel];
      queue.push({ elementId: neighbour.elementId, path, distance });

      const element = input.elementById.get(neighbour.elementId);
      if (!element) continue;
      for (const membership of input.membershipsByElement.get(neighbour.elementId) ?? []) {
        if (membership.viewId === input.currentViewId) continue;
        related.push({
          ...membership,
          elementName: element.name,
          relationshipPath: path,
          distance,
          href: `/ea/views/${encodeURIComponent(membership.viewId)}?element=${encodeURIComponent(neighbour.elementId)}`,
        });
      }
    }
  }

  return related.sort(
    (left, right) =>
      notationRank(left.notationSlug) - notationRank(right.notationSlug) ||
      left.distance - right.distance ||
      left.viewName.localeCompare(right.viewName) ||
      left.elementName.localeCompare(right.elementName) ||
      left.elementId.localeCompare(right.elementId),
  );
}

function notationRank(notationSlug: string): number {
  if (notationSlug === "archimate4") return 0;
  if (notationSlug === "sysml2") return 1;
  if (notationSlug === "bpmn20") return 2;
  return 3;
}

function parseSourceKey(value: string | null): { path: string; symbol: string | null } {
  if (!value) return { path: "", symbol: null };
  const separator = value.indexOf("#");
  return separator < 0
    ? { path: value, symbol: null }
    : { path: value.slice(0, separator), symbol: value.slice(separator + 1) || null };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRoutingArchitecture(properties: Record<string, unknown>): boolean {
  const version = stringValue(properties.sourceVersion);
  const sourceKey = stringValue(properties.sourceKey);
  return Boolean(
    version === AI_ROUTING_ARCHITECTURE_VERSION ||
    version?.startsWith("ai-routing") ||
    sourceKey?.includes("ai-routing") ||
    sourceKey?.includes("routed-inference"),
  );
}

function groupBy<T>(
  values: T[],
  key: (value: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) pushMapArray(grouped, key(value), value);
  return grouped;
}

function pushMapArray<T>(map: Map<string, T[]>, key: string, value: T): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}
