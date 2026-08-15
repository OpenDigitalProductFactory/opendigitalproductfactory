import type { CoworkerOfferCatalogItem } from "./catalog";
import { verifyCoworkerOfferGaidAuthority } from "./gaid-authority";

export type CoworkerAgentCardAccessProfile = "internal-a2a" | "partner-a2a" | "external-a2a";

export type CoworkerAgentCard = {
  agentId: string;
  offerId: string;
  serviceId: string;
  protocol: "a2a";
  name: string;
  description: string;
  exposure: "private" | "partner" | "public";
  endpoint: {
    kind: "dpf-a2a";
    path: string;
  };
  identity: {
    gaid: string;
    aidocRef: string;
    providerOrganization: string | null;
  };
  security: {
    audience: "trusted-internal" | "authenticated-partner" | "authenticated-external";
    requiredGrants: string[];
    requiredApprovals: unknown[];
  };
  skills: Array<{ id: string; name: string }>;
  capabilities: string[];
  inputModes: string[];
  outputModes: string[];
  authorityBoundary: string;
  riskTier: string;
  dataBoundary: Record<string, unknown>;
  legalTerms: Record<string, unknown>;
  delegationReceiptPolicy: {
    preserveActingAgent: true;
    preserveDelegatingAgent: true;
    preserveDelegatedAgent: true;
    requireGaidForCrossOrganization: boolean;
  };
};

export type CoworkerAgentCardProjection =
  | { ok: true; card: CoworkerAgentCard }
  | {
      ok: false;
      reason:
        | "offer_not_available_for_access_profile"
        | "cross_boundary_identity_or_terms_missing"
        | "gaid_authority_not_verified"
        | "gaid_authority_scope_mismatch"
        | "gaid_authority_expired"
        | "gaid_authority_subject_mismatch";
      missing: string[];
    };

export function projectCoworkerOfferAgentCard(
  offer: CoworkerOfferCatalogItem,
  options: { accessProfile: CoworkerAgentCardAccessProfile; now?: Date },
): CoworkerAgentCardProjection {
  if (!isAvailableForProfile(offer, options.accessProfile)) {
    return { ok: false, reason: "offer_not_available_for_access_profile", missing: [] };
  }

  const metadata = record(offer.metadata);
  const serviceMetadata = record(offer.service.metadata);
  const crossBoundary = options.accessProfile !== "internal-a2a";
  const gaid = stringValue(metadata.gaid) ?? (crossBoundary ? null : stringValue(serviceMetadata.gaid));
  const aidocRef = stringValue(metadata.aidocRef) ?? (crossBoundary ? null : stringValue(serviceMetadata.aidocRef));
  const legalTerms = record(offer.legalTerms);
  const dataBoundary = record(offer.dataBoundary);
  if (crossBoundary) {
    const missing = [
      !gaid ? "gaid" : null,
      !aidocRef ? "aidocRef" : null,
      Object.keys(legalTerms).length === 0 ? "legalTerms" : null,
      Object.keys(dataBoundary).length === 0 ? "dataBoundary" : null,
    ].filter((entry): entry is string => entry !== null);
    if (missing.length > 0) {
      return { ok: false, reason: "cross_boundary_identity_or_terms_missing", missing };
    }
    const gaidAuthority = verifyCoworkerOfferGaidAuthority(offer, {
      accessProfile: options.accessProfile,
      now: options.now,
    });
    if (!gaidAuthority.ok) return gaidAuthority;
  }

  return {
    ok: true,
    card: {
      agentId: offer.provider.agentId,
      offerId: offer.offerId,
      serviceId: offer.serviceId,
      protocol: "a2a",
      name: offer.provider.displayName,
      description: offer.summary || offer.description || offer.name,
      exposure: exposureForProfile(options.accessProfile),
      endpoint: {
        kind: "dpf-a2a",
        path: `/api/a2a/coworkers/${encodeURIComponent(offer.provider.agentId)}/offers/${encodeURIComponent(offer.offerId)}`,
      },
      identity: {
        gaid: gaid ?? `gaid:private:${offer.provider.agentId}`,
        aidocRef: aidocRef ?? `aidoc://private/${offer.provider.agentId}`,
        providerOrganization: offer.providerOrganization,
      },
      security: {
        audience: audienceForProfile(options.accessProfile),
        requiredGrants: offer.service.backing.grantKeys,
        requiredApprovals: offer.requiredApprovals,
      },
      skills: offer.service.backing.skillIds.map((skillId) => ({ id: skillId, name: offer.name })),
      capabilities: offer.deliverables.length > 0 ? offer.deliverables : offer.service.producedOutputs.map((output) => String(output.key ?? "output")),
      inputModes: offer.service.requiredInputs.map((input) => String(input.key ?? "input")),
      outputModes: offer.deliverables,
      authorityBoundary: offer.authorityBoundary,
      riskTier: offer.riskTier,
      dataBoundary,
      legalTerms,
      delegationReceiptPolicy: {
        preserveActingAgent: true,
        preserveDelegatingAgent: true,
        preserveDelegatedAgent: true,
        requireGaidForCrossOrganization: crossBoundary,
      },
    },
  };
}

// ── Whole-coworker identity card (EP-COWORKER-IDENTITY-360 Phase 2) ───────────
// The offer card above answers "how do I engage THIS offer". The identity card
// answers "who is this coworker, and how do I engage it at all" — the machine
// complement to the human identity page, so another agent resolves the SAME
// identity a person sees at /workforce/[agentId]. It aggregates the coworker's
// A2A-exposed offers into one discovery document, gated by the same access model.

export type CoworkerIdentityCard = {
  agentId: string;
  protocol: "a2a";
  kind: "coworker-identity";
  /** Role-based display name — never a human persona name (BI-7D29937E). */
  name: string;
  /** Role-type facet (orchestrator | specialist | …). */
  role: string;
  description: string;
  exposure: CoworkerAgentCard["exposure"];
  endpoint: { kind: "dpf-a2a"; path: string };
  security: { audience: CoworkerAgentCard["security"]["audience"] };
  skills: Array<{ id: string; name: string }>;
  capabilities: string[];
  authorityBoundary: string;
  dataBoundary: Record<string, unknown>;
  /** Engagement entry-points: each A2A-exposed offer this coworker provides. */
  offers: Array<{
    offerId: string;
    name: string;
    summary: string;
    riskTier: string;
    authorityBoundary: string;
    path: string;
  }>;
};

export type CoworkerIdentityCardInput = {
  agentId: string;
  displayName: string;
  kind: string;
  description: string | null;
};

export type CoworkerIdentityCardProjection =
  | { ok: true; card: CoworkerIdentityCard }
  | { ok: false; reason: "coworker_not_available_for_access_profile"; missing: string[] };

/**
 * Project the whole-coworker A2A identity card from the coworker's identity plus
 * its offers, scoped to an access profile. Pure — the route does the loading.
 * Returns not-available when the coworker exposes no offer at the profile (there
 * is nothing another agent could engage at that boundary).
 */
export function projectCoworkerIdentityAgentCard(
  identity: CoworkerIdentityCardInput,
  offers: CoworkerOfferCatalogItem[],
  options: { accessProfile: CoworkerAgentCardAccessProfile },
): CoworkerIdentityCardProjection {
  const available = offers.filter(
    (offer) =>
      offer.provider.agentId === identity.agentId &&
      isAvailableForProfile(offer, options.accessProfile),
  );
  if (available.length === 0) {
    return { ok: false, reason: "coworker_not_available_for_access_profile", missing: ["offers"] };
  }

  const skills = new Map<string, { id: string; name: string }>();
  const capabilities = new Set<string>();
  const boundaries = new Set<string>();
  let dataBoundary: Record<string, unknown> = {};
  for (const offer of available) {
    for (const skillId of offer.service.backing.skillIds) {
      if (!skills.has(skillId)) skills.set(skillId, { id: skillId, name: skillId });
    }
    for (const deliverable of offer.deliverables) capabilities.add(deliverable);
    boundaries.add(offer.authorityBoundary);
    dataBoundary = { ...dataBoundary, ...record(offer.dataBoundary) };
  }

  return {
    ok: true,
    card: {
      agentId: identity.agentId,
      protocol: "a2a",
      kind: "coworker-identity",
      name: identity.displayName,
      role: identity.kind,
      description: (identity.description ?? "").trim() || available[0].summary || available[0].name,
      exposure: exposureForProfile(options.accessProfile),
      endpoint: {
        kind: "dpf-a2a",
        path: `/api/a2a/coworkers/${encodeURIComponent(identity.agentId)}`,
      },
      security: { audience: audienceForProfile(options.accessProfile) },
      skills: [...skills.values()],
      capabilities: [...capabilities],
      authorityBoundary: [...boundaries].join(", "),
      dataBoundary,
      offers: available.map((offer) => ({
        offerId: offer.offerId,
        name: offer.name,
        summary: offer.summary || offer.description || offer.name,
        riskTier: offer.riskTier,
        authorityBoundary: offer.authorityBoundary,
        path: `/api/a2a/coworkers/${encodeURIComponent(identity.agentId)}/offers/${encodeURIComponent(offer.offerId)}`,
      })),
    },
  };
}

function isAvailableForProfile(offer: CoworkerOfferCatalogItem, profile: CoworkerAgentCardAccessProfile): boolean {
  if (profile === "internal-a2a") return offer.availabilityScope === "internal";
  if (profile === "partner-a2a") return offer.availabilityScope === "partner";
  return offer.availabilityScope === "external";
}

function exposureForProfile(profile: CoworkerAgentCardAccessProfile): CoworkerAgentCard["exposure"] {
  if (profile === "internal-a2a") return "private";
  if (profile === "partner-a2a") return "partner";
  return "public";
}

function audienceForProfile(profile: CoworkerAgentCardAccessProfile): CoworkerAgentCard["security"]["audience"] {
  if (profile === "internal-a2a") return "trusted-internal";
  if (profile === "partner-a2a") return "authenticated-partner";
  return "authenticated-external";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
