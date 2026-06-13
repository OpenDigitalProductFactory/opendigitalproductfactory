import { prisma } from "@dpf/db";

/**
 * EA view scopes that render on the `/ea/value-streams` surface:
 * - `reference_model_projection` — value streams projected from a reference
 *   model (IT4IT, BIAN, …).
 * - `archetype_value_stream` — the org's own derived operational value stream
 *   (P0 Capture). One list, two sources; see
 *   docs/superpowers/specs/2026-06-12-value-stream-architecture-platform-design.md.
 */
export const VALUE_STREAM_VIEW_SCOPES = [
  "reference_model_projection",
  "archetype_value_stream",
] as const;

export function isOperationalValueStreamScope(scopeType: string | null | undefined): boolean {
  return scopeType === "archetype_value_stream";
}

/**
 * Explicit return shape (not the inferred Prisma `findMany` type). The inferred
 * type for a query with `select` + `_count` is large, and letting it propagate
 * across the module boundary into the page server component pushed the apps/web
 * `tsc` heap over its ceiling (OOM, PR #1798 CI). A plain interface keeps the
 * boundary cheap; the Prisma result is structurally assignable to it.
 */
export interface ValueStreamViewListItem {
  id: string;
  name: string;
  description: string | null;
  scopeType: string;
  scopeRef: string | null;
  createdAt: Date;
  notation: { name: string };
  _count: { viewElements: number };
}

export async function listValueStreamViews(): Promise<ValueStreamViewListItem[]> {
  return prisma.eaView.findMany({
    where: { scopeType: { in: [...VALUE_STREAM_VIEW_SCOPES] } },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      description: true,
      scopeType: true,
      scopeRef: true,
      createdAt: true,
      notation: { select: { name: true } },
      _count: { select: { viewElements: true } },
    },
  });
}
