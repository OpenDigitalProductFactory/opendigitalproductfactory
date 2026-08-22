import {
  bindExternalChannelProjection,
  markExternalChannelProjectionAmbiguous,
  reserveExternalChannelProjection,
  type ExternalChannelProjectionSourceType,
} from "./external-channel-projection";
import { err, ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";

export type ExternalChannelPublishSuccess = ActionSuccess & {
      externalId: string;
      externalUrl: string | null;
      remoteFingerprint?: string;
      remoteModifiedAt?: Date | null;
      channelMetadata?: Record<string, unknown>;
    };
export type ExternalChannelPublishFailure = ActionFailure & {
      retryable: boolean;
      outcomeCertainty?: "known" | "ambiguous";
      channelMetadata?: Record<string, unknown>;
    };
export type ExternalChannelPublishResult = ExternalChannelPublishSuccess | ExternalChannelPublishFailure;

export function externalPublishSucceeded(
  result: Omit<ExternalChannelPublishSuccess, "ok">,
): ExternalChannelPublishSuccess {
  return Object.assign(ok(), result);
}

export function externalPublishFailed(
  error: string,
  details: Omit<ExternalChannelPublishFailure, "ok" | "error">,
): ExternalChannelPublishFailure {
  return Object.assign(err(error), details);
}

export type ProjectionPublicationIntent = {
  connectorKey: string;
  connectionId: string;
  credentialId: string | null;
  sourceType: ExternalChannelProjectionSourceType;
  sourceId: string;
  sourceVersion: string;
  resourceKind: "post" | "page" | "media";
  locale: string;
  localFingerprint: string;
  payload: Record<string, unknown> | Uint8Array;
};

export type ProjectionPublicationContext = {
  projectionId: string;
  existingExternalId: string | null;
  payload: Record<string, unknown> | Uint8Array;
};

type ProjectionDb = Parameters<typeof reserveExternalChannelProjection>[0];

export async function executeProjectedPublication(input: {
  db: ProjectionDb;
  intent: ProjectionPublicationIntent;
  publish(context: ProjectionPublicationContext): Promise<ExternalChannelPublishResult>;
}): Promise<ExternalChannelPublishResult> {
  const reservation = await reserveExternalChannelProjection(input.db, {
    connectorKey: input.intent.connectorKey,
    connectionId: input.intent.connectionId,
    credentialId: input.intent.credentialId,
    sourceType: input.intent.sourceType,
    sourceId: input.intent.sourceId,
    sourceVersion: input.intent.sourceVersion,
    resourceKind: input.intent.resourceKind,
    locale: input.intent.locale,
    localFingerprint: input.intent.localFingerprint,
    metadata: { authority: "platform", publication: "approved-snapshot" },
  });
  if (!reservation.ok) {
    return externalPublishFailed("projection_reservation_failed", { retryable: false, channelMetadata: { reason: reservation.error } });
  }
  const projection = reservation.data.projection;
  const result = await input.publish({ projectionId: projection.externalChannelProjectionId, existingExternalId: projection.externalRef, payload: input.intent.payload });
  if (!result.ok) {
    if (result.outcomeCertainty === "ambiguous") {
      await markExternalChannelProjectionAmbiguous(input.db, projection.externalChannelProjectionId, "remote-request-outcome-unknown");
      return externalPublishFailed("ambiguous_remote_outcome", { retryable: false, outcomeCertainty: "ambiguous", channelMetadata: { projectionId: projection.externalChannelProjectionId } });
    }
    return result;
  }
  const binding = await bindExternalChannelProjection(input.db, {
    projectionId: projection.externalChannelProjectionId,
    externalId: result.externalId,
    externalUrl: result.externalUrl,
    remoteFingerprint: result.remoteFingerprint ?? input.intent.localFingerprint,
    remoteModifiedAt: result.remoteModifiedAt ?? null,
  });
  if (!binding.ok) {
    await markExternalChannelProjectionAmbiguous(input.db, projection.externalChannelProjectionId, `binding-failed:${binding.error}`);
    return externalPublishFailed("projection_binding_failed", { retryable: false, outcomeCertainty: "ambiguous", channelMetadata: { projectionId: projection.externalChannelProjectionId } });
  }
  return externalPublishSucceeded({ ...result, channelMetadata: { ...(result.channelMetadata ?? {}), projectionId: projection.externalChannelProjectionId } });
}
