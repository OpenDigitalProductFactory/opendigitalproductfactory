// apps/web/lib/routing/endpoint-retirement-guard.ts
//
// Guards that sit in front of auto-retirement (BI-32426CA0).
//
// Retiring an endpoint is not a downrank. `queryEndpointManifests`
// (apps/web/lib/routing/loader.ts) filters candidates on `retiredAt: null`, so a
// retirement REMOVES the endpoint from routing entirely. Where one provider is
// the sole holder of a sensitivity clearance — typically the bundled local model
// for `restricted` — retiring it leaves that class with zero eligible endpoints
// and every request in it fails with the generic "No AI model can handle this
// request right now".
//
// Lives outside eval-runner.ts so the retirement policy is testable on its own
// and the eval runner stays under the module-size ceiling.

import { prisma } from "@dpf/db";
import { MODEL_ROUTING_ENDPOINT_TYPES } from "./provider-eligibility";

/**
 * Which sensitivity classes would lose their last routable endpoint if this
 * profile were retired.
 *
 * Mirrors the candidate query in `queryEndpointManifests` exactly —
 * modelStatus active|degraded, retiredAt null, provider active|degraded,
 * provider endpointType routable. A transcription/embedding endpoint therefore
 * never counts as cover, which matters: on the install that motivated this, the
 * only other provider holding `restricted` clearance was a transcription
 * endpoint that can never serve a chat request, so a naive "is any other
 * provider cleared?" check would have wrongly concluded nothing was at risk.
 *
 * Returns [] when the provider holds no clearance at all — there is nothing to
 * strand.
 */
export async function sensitivityClassesLeftUncoveredByRetiring(
  providerId: string,
  modelId: string,
): Promise<string[]> {
  const self = await prisma.modelProfile.findUnique({
    where: { providerId_modelId: { providerId, modelId } },
    select: { id: true, provider: { select: { sensitivityClearance: true } } },
  });
  const covered = self?.provider?.sensitivityClearance ?? [];
  if (covered.length === 0) return [];

  const peers = await prisma.modelProfile.findMany({
    where: {
      id: { not: self!.id },
      modelStatus: { in: ["active", "degraded"] },
      retiredAt: null,
      provider: {
        status: { in: ["active", "degraded"] },
        endpointType: { in: [...MODEL_ROUTING_ENDPOINT_TYPES] },
      },
    },
    select: { provider: { select: { sensitivityClearance: true } } },
  });

  const peerCover = new Set(peers.flatMap((p) => p.provider?.sensitivityClearance ?? []));
  return covered.filter((level) => !peerCover.has(level));
}
