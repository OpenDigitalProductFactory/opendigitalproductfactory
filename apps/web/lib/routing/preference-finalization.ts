import { resolveModelSuccessor } from "./model-successor";
import type {
  RoutePreferenceKind,
  RoutePreferenceResolution,
} from "./types";

export type EndpointPreferences = {
  pinnedEndpointId?: string;
  preferredProviderId?: string;
  preferredModelId?: string;
  /** Family of the preferred model when the caller knows it (pin lineage). */
  preferredModelFamily?: string | null;
};

export type PreferenceCandidate = {
  endpointId: string;
  providerId: string;
  modelId: string;
  /** Lineage, when the manifest knows it; lets an unavailable preference find its family successor. */
  modelFamily?: string | null;
  qualityTier?: string | null;
  /**
   * Derived lifecycle status of the candidate's ModelProfile, when the caller
   * carries it. Anything other than "active"/"degraded" (e.g. "retired",
   * "disabled", "unconfigured") marks the candidate unavailable. Absent means
   * the caller did not supply it, which is treated as available because the
   * ranked set is already fenced.
   */
  modelStatus?: string | null;
  /** Retirement timestamp of the candidate's ModelProfile; any value marks it unavailable. */
  retiredAt?: Date | string | null;
};

export type EndpointPreferenceSelection<T extends PreferenceCandidate> = {
  winner: T;
  resolution?: RoutePreferenceResolution;
};

function request(
  kind: RoutePreferenceKind,
  value: string | undefined,
): { kind: RoutePreferenceKind; value: string } | null {
  return value ? { kind, value } : null;
}

/**
 * A preference resolved to a candidate whose ModelProfile has retired or is
 * otherwise not routable. Reuses the status reads already carried on the
 * candidate (BI-7F2FBDA3 lineage): `retiredAt` set, or a `modelStatus` outside
 * the routable set. An absent status is treated as available — the ranked set
 * is already fenced, and legacy callers that do not carry status must keep
 * honouring their pins.
 */
function isPreferenceUnavailable(candidate: PreferenceCandidate): boolean {
  if (candidate.retiredAt != null) return true;
  const status = candidate.modelStatus;
  if (status == null) return false;
  return status !== "active" && status !== "degraded";
}

/**
 * Telemetry-only breadcrumb for a preferred/pinned endpoint that was skipped
 * because its ModelProfile retired or went unavailable. Deliberately a
 * console/telemetry log and nothing else: the skip must never surface
 * owner-facing text, so no message string leaves this module. Policy-safe —
 * only routing identifiers, never request content.
 */
function logSkippedUnavailablePreference(
  kind: RoutePreferenceKind,
  value: string,
  candidate: PreferenceCandidate,
  successorModelId: string | null,
): void {
  console.info("[preference-finalization] skipped unavailable preference", {
    kind,
    value,
    endpointId: candidate.endpointId,
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    modelStatus: candidate.modelStatus ?? null,
    retiredAt:
      candidate.retiredAt instanceof Date
        ? candidate.retiredAt.toISOString()
        : candidate.retiredAt ?? null,
    successorModelId,
  });
}

/**
 * Select preferences only from the fully eligible ranked set. The caller runs
 * this after every policy, override, capacity, and contract fence, but before
 * recipe and execution-plan construction.
 */
export function selectEndpointPreference<T extends PreferenceCandidate>(
  ranked: readonly T[],
  preferences: EndpointPreferences,
): EndpointPreferenceSelection<T> {
  const canonicalWinner = ranked[0];
  if (!canonicalWinner) {
    throw new Error("Cannot finalize endpoint preferences without a candidate");
  }

  const requested = [
    request("endpoint", preferences.pinnedEndpointId),
    request("provider", preferences.preferredProviderId),
    request("model", preferences.preferredModelId),
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (requested.length === 0) return { winner: canonicalWinner };

  const applied: RoutePreferenceResolution["applied"] = [];
  const unavailable: RoutePreferenceResolution["unavailable"] = [];
  let winner = canonicalWinner;
  let preferredProvider: T | null = null;

  // Only routable candidates may satisfy a preference, and only they may serve
  // as a successor. A retired/unavailable candidate is skipped silently and
  // logged; it never reaches the winner and never surfaces owner-facing text.
  const availableRanked = ranked.filter(
    (candidate) => !isPreferenceUnavailable(candidate),
  );

  const pinnedEndpointId = preferences.pinnedEndpointId;
  if (pinnedEndpointId) {
    const pinned = ranked.find(
      (candidate) => candidate.endpointId === pinnedEndpointId,
    );
    if (pinned && !isPreferenceUnavailable(pinned)) {
      winner = pinned;
      applied.push({
        kind: "endpoint",
        value: pinnedEndpointId,
        endpointId: pinned.endpointId,
      });
      return {
        winner,
        resolution: {
          requested,
          applied,
          unavailable,
          fallbackUsed: false,
        },
      };
    }
    unavailable.push({ kind: "endpoint", value: pinnedEndpointId });
    if (pinned) {
      // The pin resolved to a retired/unavailable ModelProfile. Skip it with a
      // telemetry log only, then move to the newest eligible model in its
      // family via the BI-7F2FBDA3 successor logic. No owner-facing text.
      const successor = resolveModelSuccessor({
        candidates: availableRanked,
        preferredProviderId: pinned.providerId,
        preferredModelId: pinned.modelId,
        preferredModelFamily:
          pinned.modelFamily ?? preferences.preferredModelFamily ?? null,
      });
      logSkippedUnavailablePreference(
        "endpoint",
        pinnedEndpointId,
        pinned,
        successor?.successor.modelId ?? null,
      );
      if (successor) {
        winner = successor.successor;
        applied.push({
          kind: "endpoint",
          value: pinnedEndpointId,
          endpointId: successor.successor.endpointId,
          successorOf: pinned.modelId,
          successorBasis: successor.basis,
        });
        return {
          winner,
          resolution: {
            requested,
            applied,
            unavailable,
            fallbackUsed: true,
          },
        };
      }
      // No successor available — fall through to any provider/model preference,
      // otherwise the canonical winner stands in for the skipped pin.
    }
  }

  const preferredProviderId = preferences.preferredProviderId;
  if (preferredProviderId) {
    const matcher = (candidate: T) =>
      candidate.endpointId === preferredProviderId ||
      candidate.providerId === preferredProviderId;
    const preferred = availableRanked.find(matcher);
    if (preferred) {
      winner = preferred;
      preferredProvider = preferred;
      applied.push({
        kind: "provider",
        value: preferredProviderId,
        endpointId: preferred.endpointId,
      });
    } else {
      unavailable.push({ kind: "provider", value: preferredProviderId });
      // Log when the provider preference resolved only to retired/unavailable
      // candidates, so the silent skip is still observable in telemetry.
      const skipped = ranked.find(matcher);
      if (skipped) {
        logSkippedUnavailablePreference(
          "provider",
          preferredProviderId,
          skipped,
          null,
        );
      }
    }
  }

  const preferredModelId = preferences.preferredModelId;
  if (preferredModelId) {
    const modelCandidates = preferredProviderId
      ? preferredProvider
        ? availableRanked.filter(
            (candidate) =>
              candidate.providerId === preferredProvider.providerId,
          )
        : []
      : availableRanked;
    const preferred = modelCandidates.find(
      (candidate) => candidate.modelId === preferredModelId,
    );
    if (preferred) {
      winner = preferred;
      applied.push({
        kind: "model",
        value: preferredModelId,
        endpointId: preferred.endpointId,
      });
    } else {
      unavailable.push({ kind: "model", value: preferredModelId });
      // BI-7F2FBDA3: a retired, deprecated or refused preference moves to the
      // newest eligible model in its family on its provider, not to whatever
      // ranked first. Candidates are already fenced, so no policy is crossed.
      const successorProviderId = preferredProvider?.providerId ?? preferredProviderId ?? null;
      const successor = successorProviderId
        ? resolveModelSuccessor({
            candidates: modelCandidates,
            preferredProviderId: successorProviderId,
            preferredModelId,
            preferredModelFamily: preferences.preferredModelFamily ?? null,
          })
        : null;
      if (successor) {
        winner = successor.successor;
        applied.push({
          kind: "model",
          value: successor.successor.modelId,
          endpointId: successor.successor.endpointId,
          successorOf: preferredModelId,
          successorBasis: successor.basis,
        });
      }
    }
  }

  return {
    winner,
    resolution: {
      requested,
      applied,
      unavailable,
      fallbackUsed: unavailable.length > 0,
    },
  };
}

/**
 * BI-7F2FBDA3: fill in the preferred model's family when the caller did not
 * know it, from any loaded manifest that still names that model on that
 * provider. A retired model is no longer loaded, so a caller that knows the
 * pin's lineage (the agent loop reads it from the profile row) passes it in.
 */
export function withInferredPreferenceFamily(
  endpoints: ReadonlyArray<{ providerId: string; modelId: string; modelFamily?: string | null }>,
  preferences: EndpointPreferences,
): EndpointPreferences {
  if (!preferences.preferredModelId || preferences.preferredModelFamily) return preferences;
  const known = endpoints.find(
    (ep) => ep.modelId === preferences.preferredModelId
      && (!preferences.preferredProviderId || ep.providerId === preferences.preferredProviderId),
  );
  return known?.modelFamily ? { ...preferences, preferredModelFamily: known.modelFamily } : preferences;
}

/** Shape a ranked endpoint for preference selection, carrying its lineage, tier and lifecycle status. */
export function toPreferenceCandidate<E>(
  endpoint: {
    id: string;
    providerId: string;
    modelId: string;
    modelFamily?: string | null;
    qualityTier?: string | null;
    status?: string | null;
    retiredAt?: Date | string | null;
  },
  entry: E,
): PreferenceCandidate & { entry: E } {
  return {
    endpointId: endpoint.id,
    providerId: endpoint.providerId,
    modelId: endpoint.modelId,
    modelFamily: endpoint.modelFamily ?? null,
    qualityTier: endpoint.qualityTier ?? null,
    modelStatus: endpoint.status ?? null,
    retiredAt: endpoint.retiredAt ?? null,
    entry,
  };
}
