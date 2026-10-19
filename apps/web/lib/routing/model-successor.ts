// BI-7F2FBDA3 — family successor for a preferred model that is no longer eligible.
//
// An agent's pinned or preferred model is a preference with lineage, not a
// contract: when it retires, is deprecated past its date, or is refused under
// the active auth mode, routing moves to the newest eligible model in the same
// family on the same provider that still meets the agent's floor. Generalizes
// clearStaleCodexPins (which only nulled a stale codex pin at discovery time)
// to every provider and to route time. The candidate set is the ALREADY
// fenced, ranked list, so residency, sensitivity and capability floors have
// been applied before a successor is considered — nothing here can cross a
// policy boundary the pipeline enforced.

export interface SuccessorCandidate {
  endpointId: string;
  providerId: string;
  modelId: string;
  modelFamily?: string | null;
  qualityTier?: string | null;
  /** When the model was first discovered, if known; newer wins within a family. */
  discoveredAt?: Date | string | null;
}

export interface SuccessorSelection<T extends SuccessorCandidate> {
  successor: T;
  /** Why this one: same family, or same provider when the family is unknown. */
  basis: "same-family" | "same-provider";
}

const TIER_RANK: Record<string, number> = { frontier: 4, strong: 3, adequate: 2, basic: 1 };

function tierRank(tier: string | null | undefined): number {
  return tier ? TIER_RANK[tier] ?? 0 : 0;
}

function discoveredMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/** Natural-order compare so "gpt-5.6" sorts after "gpt-5.5" and "gpt-6" after both. */
function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Pick the successor for an unavailable preferred model from the eligible
 * candidates. Same provider is required; same family is preferred. Within the
 * pool: higher quality tier, then most recently discovered, then the highest
 * model id by natural order (a later version number).
 */
export function resolveModelSuccessor<T extends SuccessorCandidate>(input: {
  candidates: readonly T[];
  preferredProviderId: string;
  preferredModelId: string;
  /** The unavailable model's family. Required for a same-family successor. */
  preferredModelFamily?: string | null;
  /**
   * Permit a same-provider successor when no family match exists. Off by
   * default: a plain provider preference must not be re-labelled as a
   * "successor" of a model the caller never had on that provider.
   */
  allowProviderFallback?: boolean;
}): SuccessorSelection<T> | null {
  const sameProvider = input.candidates.filter(
    (candidate) => candidate.providerId === input.preferredProviderId && candidate.modelId !== input.preferredModelId,
  );
  if (sameProvider.length === 0) return null;

  const family = input.preferredModelFamily ?? null;
  const sameFamily = family ? sameProvider.filter((candidate) => candidate.modelFamily === family) : [];
  if (sameFamily.length === 0 && !input.allowProviderFallback) return null;
  const pool = sameFamily.length > 0 ? sameFamily : sameProvider;
  const basis: SuccessorSelection<T>["basis"] = sameFamily.length > 0 ? "same-family" : "same-provider";

  const [best] = [...pool].sort((left, right) =>
    tierRank(right.qualityTier) - tierRank(left.qualityTier)
    || discoveredMs(right.discoveredAt) - discoveredMs(left.discoveredAt)
    || naturalCompare(right.modelId, left.modelId),
  );
  return best ? { successor: best, basis } : null;
}

/**
 * The family of a pinned model, read from its profile row even when the model
 * has retired (a retired model no longer reaches the routing manifests, so the
 * pipeline cannot infer its lineage). Advisory: a lookup failure yields null.
 */
export async function lookupPinnedModelFamily(
  db: { modelProfile: { findUnique(args: unknown): Promise<{ modelFamily: string | null } | null> } },
  providerId: string | undefined,
  modelId: string | undefined,
): Promise<string | null> {
  if (!providerId || !modelId) return null;
  const row = await db.modelProfile
    .findUnique({ where: { providerId_modelId: { providerId, modelId } }, select: { modelFamily: true } })
    .catch(() => null);
  return row?.modelFamily ?? null;
}
