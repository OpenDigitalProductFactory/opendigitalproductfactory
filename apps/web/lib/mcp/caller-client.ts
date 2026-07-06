// Caller-client derivation for decision-ledger attribution (BI-0EEBA669).
// Lives outside the route module because Next.js app-router route files may
// only export HTTP handlers/segment config.

/**
 * Derive a stable client identifier from a request User-Agent product token:
 * "claude-code/2.1 (darwin)" → "claude-code/2.1". Decision-ledger writers
 * persist it so a consult can be matched back to the client that made it —
 * and a client that never appears visibly never consulted. Sanitized to a
 * conservative charset and capped so a hostile UA cannot smuggle markup or
 * bloat into the audit payload.
 */
export function deriveCallerClient(userAgent: string | null): string | undefined {
  if (!userAgent) return undefined;
  const first = userAgent.trim().split(/\s+/)[0] ?? "";
  const cleaned = first.replace(/[^A-Za-z0-9._/@+-]/g, "");
  if (!cleaned) return undefined;
  return cleaned.slice(0, 64);
}
