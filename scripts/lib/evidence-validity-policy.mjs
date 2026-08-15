// One bounded freshness policy for CI evidence, regardless of whether the
// producer is hosted merge-group CI or the governed local merged-tree gate.
export const CI_EVIDENCE_VALIDITY_LIFETIME_MS = 24 * 60 * 60_000;

export function createCiEvidenceValidity({ issuedAt = new Date().toISOString() } = {}) {
  const issuedAtMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedAtMs)) throw new Error(`invalid evidence issuedAt: ${issuedAt}`);
  return {
    schemaVersion: 1,
    issuedAt,
    expiresAt: new Date(issuedAtMs + CI_EVIDENCE_VALIDITY_LIFETIME_MS).toISOString(),
  };
}
