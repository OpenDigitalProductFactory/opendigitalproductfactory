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

export async function listValueStreamViews() {
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
