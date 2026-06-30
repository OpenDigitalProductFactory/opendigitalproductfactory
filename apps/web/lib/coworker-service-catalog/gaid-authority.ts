import type { CoworkerOfferCatalogItem } from "./catalog";
import type { CoworkerAgentCardAccessProfile } from "./agent-card";

export type GaidAuthorityVerification =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "gaid_authority_not_verified"
        | "gaid_authority_scope_mismatch"
        | "gaid_authority_expired"
        | "gaid_authority_subject_mismatch";
      missing: string[];
    };

type GaidAuthorityMetadata = {
  state?: unknown;
  exposure?: unknown;
  subjectAgentId?: unknown;
  verifiedAt?: unknown;
  expiresAt?: unknown;
};

export function verifyCoworkerOfferGaidAuthority(
  offer: CoworkerOfferCatalogItem,
  options: { accessProfile: CoworkerAgentCardAccessProfile; now?: Date },
): GaidAuthorityVerification {
  if (options.accessProfile === "internal-a2a") return { ok: true };

  const metadata = record(offer.metadata);
  const authority = record(metadata.gaidAuthority) as GaidAuthorityMetadata;
  if (Object.keys(authority).length === 0 || authority.state !== "verified") {
    return { ok: false, reason: "gaid_authority_not_verified", missing: ["gaidAuthority"] };
  }

  const requiredExposure = options.accessProfile === "external-a2a" ? "public" : "partner";
  if (authority.exposure !== requiredExposure) {
    return { ok: false, reason: "gaid_authority_scope_mismatch", missing: ["gaidAuthority.exposure"] };
  }

  if (authority.subjectAgentId !== offer.provider.agentId) {
    return { ok: false, reason: "gaid_authority_subject_mismatch", missing: ["gaidAuthority.subjectAgentId"] };
  }

  const expiresAt = stringValue(authority.expiresAt);
  if (expiresAt && new Date(expiresAt).getTime() <= (options.now ?? new Date()).getTime()) {
    return { ok: false, reason: "gaid_authority_expired", missing: ["gaidAuthority.expiresAt"] };
  }

  return { ok: true };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
