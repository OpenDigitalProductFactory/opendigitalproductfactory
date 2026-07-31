import type {
  RoutePreferenceKind,
  RoutePreferenceResolution,
} from "./types";

export type EndpointPreferences = {
  pinnedEndpointId?: string;
  preferredProviderId?: string;
  preferredModelId?: string;
};

export type PreferenceCandidate = {
  endpointId: string;
  providerId: string;
  modelId: string;
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
