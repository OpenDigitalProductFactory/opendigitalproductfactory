import type { PrismaClient } from "../../generated/client/client";

/**
 * Canonical comparison key for externally-authored identity/category labels.
 * The stored authored value is never replaced; this key only prevents casing,
 * whitespace, and punctuation differences from creating matching branches.
 */
export function normalizeAbsorptionIdentityKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
}

type ResolvedPosture = {
  verdict: string;
  coveringPrimitive: string | null;
  confidence: number;
  providerName: string;
  integrationCategory: string;
  catalogIdentityId: string | null;
  archetypeIds: string[];
};

export type AbsorptionPostureResolution =
  | { status: "matched"; matchedBy: "catalog-identity" | "provider-category" | "provider-capability" | "unique-provider"; posture: ResolvedPosture }
  | { status: "ambiguous"; evidence: { providerKey: string; candidateCategories: string[] } }
  | { status: "missing"; evidence: { providerKey: string } };

export interface AbsorptionPostureIdentity {
  providerName: string;
  catalogIdentityId?: string | null;
  integrationCategory?: string | null;
  capabilityKey?: string | null;
}

/**
 * Deterministic posture lookup shared by both coverage stages. Provider-only
 * fallback is deliberately legal only for one normalized row; two rows are
 * evidence of ambiguity, never permission for database ordering to decide.
 */
export async function resolveAbsorptionPosture(
  db: PrismaClient,
  identity: AbsorptionPostureIdentity,
): Promise<AbsorptionPostureResolution> {
  const providerKey = normalizeAbsorptionIdentityKey(identity.providerName);
  if (!providerKey) return { status: "missing", evidence: { providerKey } };

  const rows = await db.absorptionPosture.findMany({
    where: { providerName: { equals: identity.providerName.trim(), mode: "insensitive" } },
    orderBy: [{ integrationCategory: "asc" }, { postureId: "asc" }],
    select: {
      verdict: true,
      coveringPrimitive: true,
      confidence: true,
      providerName: true,
      integrationCategory: true,
      catalogIdentityId: true,
      archetypeIds: true,
    },
  });
  // PostgreSQL's insensitive comparison handles casing, while normalization is
  // retained as an explicit invariant for injected stores and future sources.
  const providerRows = rows.filter((row) => normalizeAbsorptionIdentityKey(row.providerName) === providerKey);

  const catalogIdentityKey = identity.catalogIdentityId
    ? normalizeAbsorptionIdentityKey(identity.catalogIdentityId)
    : null;
  if (catalogIdentityKey) {
    const catalogMatches = providerRows.filter(
      (row) => row.catalogIdentityId
        && normalizeAbsorptionIdentityKey(row.catalogIdentityId) === catalogIdentityKey,
    );
    if (catalogMatches.length === 1) {
      return { status: "matched", matchedBy: "catalog-identity", posture: catalogMatches[0]! };
    }
  }

  const categoryKey = identity.integrationCategory
    ? normalizeAbsorptionIdentityKey(identity.integrationCategory)
    : null;
  if (categoryKey) {
    const categoryMatches = providerRows.filter(
      (row) => normalizeAbsorptionIdentityKey(row.integrationCategory) === categoryKey,
    );
    if (categoryMatches.length === 1) {
      return { status: "matched", matchedBy: "provider-category", posture: categoryMatches[0]! };
    }
  }

  const capabilityKey = identity.capabilityKey
    ? normalizeAbsorptionIdentityKey(identity.capabilityKey)
    : null;
  if (capabilityKey) {
    const capabilityMatches = providerRows.filter(
      (row) => row.coveringPrimitive
        && normalizeAbsorptionIdentityKey(row.coveringPrimitive) === capabilityKey,
    );
    if (capabilityMatches.length === 1) {
      return { status: "matched", matchedBy: "provider-capability", posture: capabilityMatches[0]! };
    }
  }

  if (providerRows.length === 1) {
    return { status: "matched", matchedBy: "unique-provider", posture: providerRows[0]! };
  }
  if (providerRows.length > 1) {
    return {
      status: "ambiguous",
      evidence: {
        providerKey,
        candidateCategories: [...new Set(providerRows.map((row) => row.integrationCategory))].sort(),
      },
    };
  }
  return { status: "missing", evidence: { providerKey } };
}

export function postureIdentityFromObservation(input: {
  providerName: string;
  observationConfig: unknown;
}): AbsorptionPostureIdentity {
  const config = input.observationConfig && typeof input.observationConfig === "object" && !Array.isArray(input.observationConfig)
    ? input.observationConfig as Record<string, unknown>
    : {};
  return {
    providerName: input.providerName,
    catalogIdentityId: typeof config.catalogIdentityId === "string" ? config.catalogIdentityId : null,
    integrationCategory: typeof config.integrationCategory === "string" ? config.integrationCategory : null,
    capabilityKey: typeof config.capabilityKey === "string" ? config.capabilityKey : null,
  };
}
