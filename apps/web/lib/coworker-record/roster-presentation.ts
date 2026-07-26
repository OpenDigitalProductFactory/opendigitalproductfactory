import {
  projectCoworkerAvailability,
  type CoworkerAvailabilityProjection,
  type CoworkerAvailabilityReadiness,
  type CoworkerInstallArchetypeResolution,
} from "@/lib/coworker-service-catalog/availability-projection";
import {
  LEVEL_RANK,
  projectCoworkerAuthority,
  type CoworkerAuthorityProjection,
  type CoworkerGovernanceEvaluation,
} from "@/lib/coworker-service-catalog/authority-projection";
import {
  OTHER_OWNER_FACING_AREA,
  ownerFacingAreaForPortfolio,
  type OwnerFacingArea,
} from "./owner-areas";

export const COWORKER_INTERACTION_SCOPES = [
  "talks-to-customers",
  "works-with-partners",
  "internal-only",
  "not-defined",
] as const;

export const COWORKER_BLOCKING_CAPABILITY_NEED_STATUSES = ["blocked"] as const;

export function capabilityNeedBlocksCoworker(status: string): boolean {
  return COWORKER_BLOCKING_CAPABILITY_NEED_STATUSES.includes(
    status as (typeof COWORKER_BLOCKING_CAPABILITY_NEED_STATUSES)[number],
  );
}

export type CoworkerInteractionScope =
  (typeof COWORKER_INTERACTION_SCOPES)[number];

const INTERACTION_LABELS: Record<CoworkerInteractionScope, string> = {
  "talks-to-customers": "Talks to customers",
  "works-with-partners": "Works with partners",
  "internal-only": "Internal only",
  "not-defined": "Interaction not defined",
};

export type CoworkerInteractionProjection = {
  scopes: CoworkerInteractionScope[];
  labels: string[];
};

export type RosterServiceEvidence = {
  serviceId: string;
  name: string;
  summary: string | null;
  status: string;
  hitlTier?: unknown;
  authorityBoundary?: unknown;
  availabilityScope: unknown;
  personas: unknown;
  archetypes: unknown;
  metadata?: unknown;
  portfolio?: { slug: string; name: string } | null;
};

export type RosterAvailabilityInput = {
  services: readonly RosterServiceEvidence[];
  install: CoworkerInstallArchetypeResolution;
  readiness?: CoworkerAvailabilityReadiness;
};

export type CoworkerDiscoveryProjection = {
  area: OwnerFacingArea;
  areas: OwnerFacingArea[];
  plainJob: string;
  interaction: CoworkerInteractionProjection;
  availability: CoworkerAvailabilityProjection;
  canStartConversation: boolean;
  workSearchText: string;
};

const AVAILABILITY_PRIORITY: Record<
  CoworkerAvailabilityProjection["state"],
  number
> = {
  "needs-attention": 0,
  "setup-needed": 1,
  available: 2,
  "coverage-not-defined": 3,
  "not-available": 4,
};

export function activeRosterServices(
  services: readonly RosterServiceEvidence[],
): RosterServiceEvidence[] {
  return services.filter((service) => service.status === "active");
}

export function projectCoworkerOwnerAreas(
  services: readonly RosterServiceEvidence[],
): { primary: OwnerFacingArea; all: OwnerFacingArea[] } {
  const byKey = new Map<string, OwnerFacingArea>();
  for (const service of activeRosterServices(services)) {
    const area = ownerFacingAreaForPortfolio(service.portfolio?.slug);
    if (area.key !== OTHER_OWNER_FACING_AREA.key) {
      byKey.set(area.key, area);
    }
  }

  const all = [...byKey.values()].sort(
    (left, right) => left.order - right.order,
  );
  return {
    primary: all[0] ?? OTHER_OWNER_FACING_AREA,
    all,
  };
}

export function projectCoworkerInteraction(
  services: readonly RosterServiceEvidence[],
): CoworkerInteractionProjection {
  const scopes = new Set<CoworkerInteractionScope>();
  for (const service of activeRosterServices(services)) {
    const personas = stringArray(service.personas);
    if (
      service.availabilityScope === "external" ||
      personas.includes("customer")
    ) {
      scopes.add("talks-to-customers");
    }
    if (
      service.availabilityScope === "partner" ||
      personas.includes("partner")
    ) {
      scopes.add("works-with-partners");
    }
    if (service.availabilityScope === "internal") {
      scopes.add("internal-only");
    }
  }

  const ordered = COWORKER_INTERACTION_SCOPES.filter((scope) =>
    scopes.has(scope),
  );
  const resolved = ordered.length > 0 ? ordered : ["not-defined" as const];
  return {
    scopes: resolved,
    labels: resolved.map((scope) => INTERACTION_LABELS[scope]),
  };
}

export function projectRosterAvailability(
  input: RosterAvailabilityInput,
): CoworkerAvailabilityProjection {
  const active = activeRosterServices(input.services);
  if (active.length === 0) {
    return projectCoworkerAvailability({
      install: input.install.install,
      installResolutionReason: input.install.installResolutionReason,
      declarations: [],
      readiness: {
        status: "not-evaluated",
        reason: "No active work declaration exists for this coworker.",
      },
    });
  }

  const readiness = input.readiness ?? {
    status: "not-evaluated" as const,
    reason: "Setup readiness has not been evaluated for this coworker.",
  };

  return active
    .map((service) =>
      projectCoworkerAvailability({
        install: input.install.install,
        installResolutionReason: input.install.installResolutionReason,
        declarations: service.archetypes,
        readiness,
      }),
    )
    .sort(
      (left, right) =>
        AVAILABILITY_PRIORITY[left.state] -
        AVAILABILITY_PRIORITY[right.state],
    )[0]!;
}

export function rosterPlainJob(
  agentDescription: string | null,
  services: readonly RosterServiceEvidence[],
): string {
  const aggregate = activeRosterServices(services).find((service) =>
    isAggregate(service.metadata),
  );
  const serviceSummary = aggregate?.summary?.trim();
  if (serviceSummary) return serviceSummary;

  const description = agentDescription?.trim();
  return description || "Work description not defined.";
}

export function rosterWorkSearchText(
  services: readonly RosterServiceEvidence[],
): string {
  return activeRosterServices(services)
    .flatMap((service) => [service.name, service.summary ?? ""])
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");
}

export function canStartCoworkerConversation(
  availability: CoworkerAvailabilityProjection,
): boolean {
  return (
    availability.matchLevel !== null &&
    availability.state !== "needs-attention" &&
    availability.state !== "not-available"
  );
}

export function projectCoworkerServiceAuthority(input: {
  agent: {
    agentId: string;
    hitlTierDefault: unknown;
  };
  governance: CoworkerGovernanceEvaluation;
  services: readonly RosterServiceEvidence[];
}): CoworkerAuthorityProjection {
  const active = activeRosterServices(input.services);
  const projections =
    active.length > 0
      ? active.map((service) =>
          projectCoworkerAuthority({
            scope: { kind: "default-posture" },
            agent: input.agent,
            governance: input.governance,
            service: {
              serviceId: service.serviceId,
              authorityBoundary: service.authorityBoundary,
              hitlTier: service.hitlTier,
            },
          }),
        )
      : [
          projectCoworkerAuthority({
            scope: { kind: "default-posture" },
            agent: input.agent,
            governance: input.governance,
          }),
        ];

  const evidence = projections.flatMap((projection) => projection.evidence);
  const reviewNeeded = projections.filter(
    (projection) => projection.state === "review-needed",
  );
  if (reviewNeeded.length > 0) {
    const first = reviewNeeded[0]!;
    return {
      ...first,
      reasons: [
        ...new Set(reviewNeeded.flatMap((projection) => projection.reasons)),
      ],
      evidence,
    };
  }

  const winner = projections
    .filter((projection) => projection.state === "resolved")
    .sort(
      (left, right) =>
        LEVEL_RANK[left.level] - LEVEL_RANK[right.level],
    )[0]!;
  return { ...winner, evidence };
}

export function projectCoworkerDiscovery(input: {
  agentDescription: string | null;
  services: readonly RosterServiceEvidence[];
  install: CoworkerInstallArchetypeResolution;
  readiness?: CoworkerAvailabilityReadiness;
}): CoworkerDiscoveryProjection {
  const ownerAreas = projectCoworkerOwnerAreas(input.services);
  const availability = projectRosterAvailability({
    services: input.services,
    install: input.install,
    readiness: input.readiness,
  });
  return {
    area: ownerAreas.primary,
    areas: ownerAreas.all,
    plainJob: rosterPlainJob(input.agentDescription, input.services),
    workSearchText: rosterWorkSearchText(input.services),
    interaction: projectCoworkerInteraction(input.services),
    availability,
    canStartConversation: canStartCoworkerConversation(availability),
  };
}

function isAggregate(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).aggregate === true
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}
