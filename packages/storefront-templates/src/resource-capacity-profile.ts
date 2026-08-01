import type { ArchetypeCategory, ArchetypeDefinition } from "./types";
import { deriveTwinProfile, type TwinNoun } from "./twin-profile";

export const RESOURCE_CAPACITY_PATTERNS = [
  "appointment",
  "dispatch",
  "rental",
  "class",
  "venue",
  "project-resource",
  "service-floor",
  "occupancy",
] as const;

export type ResourceCapacityPattern = (typeof RESOURCE_CAPACITY_PATTERNS)[number];

export const RESOURCE_CAPACITY_AUTHORITIES = [
  "provider-calendar",
  "staffing",
  "hospitality",
  "beauty",
  "care",
  "rental",
  "field-operations",
  "venue-operations",
] as const;

export type ResourceCapacityAuthority = (typeof RESOURCE_CAPACITY_AUTHORITIES)[number];

export interface ResourceCapacityProfile {
  archetypeId: string;
  category: ArchetypeCategory;
  enabled: boolean;
  patterns: ResourceCapacityPattern[];
  authorities: ResourceCapacityAuthority[];
  resourceNoun: TwinNoun;
  physical: boolean;
  forwardHorizon: boolean;
  supportsBuffers: boolean;
  supportsTravel: boolean;
}

function patternsFor(archetype: ArchetypeDefinition): ResourceCapacityPattern[] {
  const twin = deriveTwinProfile(archetype);
  if (!twin.physical) return [];

  switch (twin.template) {
    case "BOOK":
      return [twin.variant === "class-grid" ? "class" : "appointment"];
    case "TERRITORY":
      return [
        archetype.category === "hoa-property-management" ||
        archetype.category === "real-estate-construction"
          ? "project-resource"
          : "dispatch",
      ];
    case "YARD":
      return ["rental"];
    case "VENUE":
      return ["venue"];
    case "ROOMS":
      return ["occupancy"];
    case "FLOOR":
    case "BAYS":
    case "DOCK":
      return ["service-floor"];
    default:
      return [];
  }
}

function authoritiesFor(
  archetype: ArchetypeDefinition,
  patterns: readonly ResourceCapacityPattern[],
): ResourceCapacityAuthority[] {
  const authorities = new Set<ResourceCapacityAuthority>();

  for (const pattern of patterns) {
    switch (pattern) {
      case "appointment":
        authorities.add("provider-calendar");
        authorities.add("staffing");
        if (archetype.category === "beauty-personal-care") authorities.add("beauty");
        if (archetype.category === "healthcare-wellness") authorities.add("care");
        break;
      case "class":
        authorities.add("provider-calendar");
        authorities.add("staffing");
        break;
      case "dispatch":
      case "project-resource":
        authorities.add("field-operations");
        authorities.add("staffing");
        break;
      case "rental":
        authorities.add("rental");
        break;
      case "venue":
        authorities.add("venue-operations");
        authorities.add("staffing");
        break;
      case "occupancy":
        if (archetype.category === "healthcare-wellness") authorities.add("care");
        authorities.add("staffing");
        break;
      case "service-floor":
        if (archetype.category === "food-hospitality") authorities.add("hospitality");
        authorities.add("staffing");
        break;
    }
  }

  return [...authorities];
}

/**
 * Derive the scarce-resource read profile from the same archetype facts that
 * already select the operational twin. This is applicability and routing only;
 * canonical resource records remain in their bounded-context owners.
 */
export function deriveResourceCapacityProfile(
  archetype: ArchetypeDefinition,
): ResourceCapacityProfile {
  const twin = deriveTwinProfile(archetype);
  const patterns = patternsFor(archetype);
  const authorities = authoritiesFor(archetype, patterns);

  return {
    archetypeId: archetype.archetypeId,
    category: archetype.category,
    enabled: patterns.length > 0 && authorities.length > 0,
    patterns,
    authorities,
    resourceNoun: { ...twin.resourceNoun },
    physical: twin.physical,
    forwardHorizon: twin.forwardHorizon === true,
    supportsBuffers: patterns.some((pattern) =>
      pattern === "appointment" ||
      pattern === "class" ||
      pattern === "venue" ||
      pattern === "service-floor"
    ),
    supportsTravel: patterns.some((pattern) =>
      pattern === "dispatch" || pattern === "project-resource"
    ),
  };
}
