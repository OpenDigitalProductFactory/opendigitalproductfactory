/**
 * Resolve a Workroom outcome anchor onto the subject binding lookups read.
 *
 * `Workroom.backlogItemId` is what every subject lookup keys on — reviewer
 * recovery in `governed-work-claim.ts`, and `subjectWhere` in
 * `backlog/initiative-readiness/repository-artifact.ts`, which sits behind plan
 * coverage and canonical-design resolution.
 *
 * Its only writer was the successful-claim path, which is readiness-gated. So a
 * room adopted BEFORE readiness could never satisfy a subject lookup: adoption
 * recorded the caller's `outcomeAnchor` and every lookup read a column that
 * stayed null (BI-512214EA).
 *
 * `CapsuleAdoptionInput` already carries `backlogItemId` and already late-binds
 * it onto an existing room whose binding is null, so adoption only has to supply
 * the value the caller already stated.
 */
export function backlogItemIdFromOutcomeAnchor(params: Record<string, unknown>): string | null {
  const anchor = params.outcomeAnchor;
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return null;
  const { kind, id } = anchor as { kind?: unknown; id?: unknown };
  if (kind !== "backlog-item" || typeof id !== "string") return null;
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}
