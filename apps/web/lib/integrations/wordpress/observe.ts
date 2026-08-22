import { observeExternalChannelProjection } from "../external-channel-projection";
import { fingerprintObservedWordPressResource } from "./projection";

type ProjectionDb = Parameters<typeof observeExternalChannelProjection>[0];

export async function observeWordPressProjection(input: {
  db: ProjectionDb;
  projectionId: string;
  client: {
    getContent(resourceKind: "post" | "page" | "media", externalId: string): Promise<{ record: unknown; modifiedAt: Date | null }>;
  };
}) {
  const projection = await input.db.externalChannelProjection.findUnique({ where: { externalChannelProjectionId: input.projectionId } });
  if (!projection?.externalRef) return { ok: false as const, error: "projection_not_bound" };
  const observed = await input.client.getContent(projection.resourceKind, projection.externalRef);
  return observeExternalChannelProjection(input.db, {
    projectionId: input.projectionId,
    remoteFingerprint: fingerprintObservedWordPressResource(observed.record),
    remoteModifiedAt: observed.modifiedAt,
  });
}
