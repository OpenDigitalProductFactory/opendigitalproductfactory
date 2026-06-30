import type { CoworkerOfferCatalogItem } from "./catalog";

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
  | { ok: false; reason: "offer_not_available_for_access_profile" | "cross_boundary_identity_or_terms_missing"; missing: string[] };

export function projectCoworkerOfferAgentCard(
  offer: CoworkerOfferCatalogItem,
  options: { accessProfile: CoworkerAgentCardAccessProfile },
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
