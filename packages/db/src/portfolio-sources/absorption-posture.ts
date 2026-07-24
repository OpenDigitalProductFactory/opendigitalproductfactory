// Absorption posture vocabulary + conservative seed logic (BI-BF909CE6, P1;
// BI-264FB4D8, P2 accessor).
//
// Plan: docs/superpowers/plans/2026-07-24-absorption-posture-matrix-vertical-provider-seed.md §3–§4.
//
// The verdict enum is IDENTICAL to IncumbentCoverageAssessment.verdict (spec
// 2026-07-23 §5.2) so the per-customer coverage stage-1 can default from this
// matrix (assessedVia=posture_matrix). Closed string enums per AGENTS.md §3.

import type { PrismaClient } from "../../generated/client/client";
import {
  VERTICAL_INCUMBENTS,
  archetypeIdsForVertical,
  connectorTierForCategory,
  type ConnectorTier,
} from "./vertical-incumbents-manifest";

// ─── Verdict vocabulary (== IncumbentCoverageAssessment) ────────────────────
export const ABSORPTION_VERDICTS = [
  "native_now",
  "adapter_bridge",
  "generic_connector",
  "provider_led",
  "do_not_absorb",
  "gap",
] as const;
export type AbsorptionVerdict = (typeof ABSORPTION_VERDICTS)[number];
export function isAbsorptionVerdict(value: string): value is AbsorptionVerdict {
  return (ABSORPTION_VERDICTS as readonly string[]).includes(value);
}

export const ABSORPTION_SOURCES = ["seed", "operator", "ai", "human_confirmed"] as const;
export type AbsorptionSource = (typeof ABSORPTION_SOURCES)[number];
export function isAbsorptionSource(value: string): value is AbsorptionSource {
  return (ABSORPTION_SOURCES as readonly string[]).includes(value);
}

export const ABSORPTION_STATUSES = ["proposed", "confirmed", "superseded"] as const;
export type AbsorptionStatus = (typeof ABSORPTION_STATUSES)[number];
export function isAbsorptionStatus(value: string): value is AbsorptionStatus {
  return (ABSORPTION_STATUSES as readonly string[]).includes(value);
}

// ─── Conservative default verdict (plan R1 — no replacement overclaim) ──────
//
// Nothing seeds as native_now: a native-absorption claim is a marketing-
// sensitive assertion the boundary-map BIs explicitly warn against, and it must
// be human-confirmed. Vertical operating systems (tier3) default to
// provider_led — DPF coexists with them; shared connectors (tier1/tier2)
// default to generic_connector — reachable through the BI-PSC-002 connector
// kernel, but not asserted as already-native. Everything stays status=proposed.
const TIER_DEFAULT_VERDICT: Record<ConnectorTier, AbsorptionVerdict> = {
  "tier1-shared": "generic_connector",
  "tier2-semi": "generic_connector",
  "tier3-bespoke": "provider_led",
};

const TIER_DEFAULT_REASON: Record<ConnectorTier, string> = {
  "tier1-shared":
    "Shared connector category (recurs across ≥5 verticals) — reachable through the BI-PSC-002 connector kernel. Seeded generic_connector, not native_now; native absorption requires human confirmation.",
  "tier2-semi":
    "Semi-shared connector category (2–4 verticals) — reachable through the BI-PSC-002 connector kernel. Seeded generic_connector pending operator review.",
  "tier3-bespoke":
    "Vertical-bespoke operating system — DPF coexists with it rather than replacing it. Seeded provider_led to avoid replacement overclaim (plan R1); operator/coworker may revise.",
};

export function defaultVerdictForTier(tier: ConnectorTier): AbsorptionVerdict {
  return TIER_DEFAULT_VERDICT[tier];
}

/** A stable, deterministic posture key (no Date.now/random — seed idempotency). */
export function postureIdFor(providerName: string, integrationCategory: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `posture-${slug(providerName)}-${slug(integrationCategory)}`;
}

export interface AbsorptionPostureSeedRow {
  postureId: string;
  providerName: string;
  integrationCategory: string;
  connectorTier: ConnectorTier;
  archetypeIds: string[];
  verdict: AbsorptionVerdict;
  reason: string;
  confidence: number;
  source: AbsorptionSource;
  status: AbsorptionStatus;
}

/** Build the conservative default posture rows from the P0 inventory. */
export function buildAbsorptionPostureSeedRows(): AbsorptionPostureSeedRow[] {
  return VERTICAL_INCUMBENTS.map((incumbent) => {
    const tier = connectorTierForCategory(incumbent.integrationCategory);
    return {
      postureId: postureIdFor(incumbent.providerName, incumbent.integrationCategory),
      providerName: incumbent.providerName,
      integrationCategory: incumbent.integrationCategory,
      connectorTier: tier,
      archetypeIds: [...archetypeIdsForVertical(incumbent.verticalKey)],
      verdict: defaultVerdictForTier(tier),
      reason: TIER_DEFAULT_REASON[tier],
      confidence: 0.3,
      source: "seed",
      status: "proposed",
    };
  });
}

// ─── P2 accessor — posture per archetype ────────────────────────────────────
export interface ArchetypePosture {
  providerName: string;
  integrationCategory: string;
  connectorTier: string;
  verdict: string;
  status: string;
  coveringPrimitive: string | null;
}

/**
 * The incumbents + default verdicts for a given storefront archetype. Consumed
 * by the boundary-map surface, the incumbent-coverage stage-1 default, and the
 * onboarding prefill (plan §4 P2). Uses array-containment on archetypeIds.
 */
export async function postureForArchetype(
  prisma: PrismaClient,
  archetypeId: string,
): Promise<ArchetypePosture[]> {
  const rows = await prisma.absorptionPosture.findMany({
    where: { archetypeIds: { has: archetypeId } },
    orderBy: [{ connectorTier: "asc" }, { providerName: "asc" }],
    select: {
      providerName: true,
      integrationCategory: true,
      connectorTier: true,
      verdict: true,
      status: true,
      coveringPrimitive: true,
    },
  });
  return rows;
}
