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

  const pinnedEndpointId = preferences.pinnedEndpointId;
  if (pinnedEndpointId) {
    const pinned = ranked.find(
      (candidate) => candidate.endpointId === pinnedEndpointId,
    );
    if (pinned) {
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
  }

  const preferredProviderId = preferences.preferredProviderId;
  if (preferredProviderId) {
    const preferred = ranked.find(
      (candidate) =>
        candidate.endpointId === preferredProviderId ||
        candidate.providerId === preferredProviderId,
    );
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
    }
  }

  const preferredModelId = preferences.preferredModelId;
  if (preferredModelId) {
    const modelCandidates = preferredProviderId
      ? preferredProvider
        ? ranked.filter(
            (candidate) =>
              candidate.providerId === preferredProvider.providerId,
          )
        : []
      : ranked;
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

/** Shape a ranked endpoint for preference selection, carrying its lineage and tier. */
export function toPreferenceCandidate<E>(
  endpoint: { id: string; providerId: string; modelId: string; modelFamily?: string | null; qualityTier?: string | null },
  entry: E,
): PreferenceCandidate & { entry: E } {
  return {
    endpointId: endpoint.id,
    providerId: endpoint.providerId,
    modelId: endpoint.modelId,
    modelFamily: endpoint.modelFamily ?? null,
    qualityTier: endpoint.qualityTier ?? null,
    entry,
  };
}
