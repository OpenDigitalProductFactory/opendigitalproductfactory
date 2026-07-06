/**
 * Attribute-level master-data history (BI-130EF887).
 *
 * Append-only record of identity-attribute changes — the temporal layer
 * commercial MDM keeps ("what was this account called in March"). Written by
 * the governed update paths; best-effort (history must never fail the write
 * it describes).
 */
import { prisma } from "@dpf/db";
import type { DedupGatedDomain } from "./dedup-gate";

export type AttributeChangeSource = "api-patch" | "merge" | "unmerge" | "steward" | "system";

/**
 * Diff `before` vs `after` over `attributes` and append one row per changed
 * attribute. Values are stringified; null/undefined stored as NULL.
 */
export async function recordAttributeChanges(args: {
  domain: DedupGatedDomain;
  entityId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  attributes: readonly string[];
  actorId?: string | null;
  source: AttributeChangeSource;
}): Promise<void> {
  const rows = args.attributes.flatMap((attribute) => {
    const oldRaw = args.before[attribute];
    const newRaw = args.after[attribute];
    const oldValue = oldRaw === null || oldRaw === undefined ? null : String(oldRaw);
    const newValue = newRaw === null || newRaw === undefined ? null : String(newRaw);
    if (oldValue === newValue) return [];
    return [
      {
        domain: args.domain,
        entityId: args.entityId,
        attribute,
        oldValue,
        newValue,
        actorId: args.actorId ?? null,
        source: args.source,
      },
    ];
  });
  if (rows.length === 0) return;
  try {
    await prisma.mdmAttributeChange.createMany({ data: rows });
  } catch (err) {
    // Best-effort by contract — never fail the governed write over history.
    console.error("[mdm-history] failed to record attribute changes", err);
  }
}

/** Recent history for one record, newest first. */
export async function listAttributeHistory(
  domain: DedupGatedDomain,
  entityId: string,
  take = 50,
) {
  return prisma.mdmAttributeChange.findMany({
    where: { domain, entityId },
    orderBy: { changedAt: "desc" },
    take,
  });
}
