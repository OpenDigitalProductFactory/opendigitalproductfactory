import { createHash } from "node:crypto";

import {
  executeProjectedPublication,
  externalPublishFailed,
  externalPublishSucceeded,
  type ExternalChannelPublishResult,
} from "../external-channel-publication";
import { bindExternalChannelProjection } from "../external-channel-projection";
import { WordPressClientError } from "./client";
import type { ExternalChannelProjectionSourceType } from "../external-channel-projection";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

type ProjectionDb = Parameters<typeof executeProjectedPublication>[0]["db"];

export async function projectWordPressMedia(input: {
  db: ProjectionDb;
  connectionId: string;
  credentialId: string | null;
  sourceType: ExternalChannelProjectionSourceType;
  sourceId: string;
  sourceVersion: string;
  locale: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  altText: string;
  caption: string;
  client: { upsertContent(input: { resourceKind: "media"; externalId: string | null; payload: Uint8Array | Record<string, unknown>; contentType?: string; fileName?: string }): Promise<{ id: string; url: string | null; record: Record<string, unknown> }> };
}): Promise<ExternalChannelPublishResult> {
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) return externalPublishFailed("unsupported_media_type", { retryable: false });
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_MEDIA_BYTES) return externalPublishFailed("media_size_out_of_bounds", { retryable: false });
  if (!input.fileName.trim() || input.fileName.length > 255 || /["\r\n]/.test(input.fileName)
    || input.altText.length > 1_000 || input.caption.length > 10_000) {
    return externalPublishFailed("media_metadata_out_of_bounds", { retryable: false });
  }
  const fingerprint = `sha256:${createHash("sha256").update(input.bytes).update("\0").update(input.altText).update("\0").update(input.caption).digest("hex")}`;
  return executeProjectedPublication({
    db: input.db,
    intent: {
      connectorKey: "wordpress-self-hosted",
      connectionId: input.connectionId,
      credentialId: input.credentialId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      resourceKind: "media",
      locale: input.locale,
      localFingerprint: fingerprint,
      payload: input.bytes,
    },
    publish: async ({ projectionId, existingExternalId }) => {
      try {
        let externalId = existingExternalId;
        let result: Awaited<ReturnType<typeof input.client.upsertContent>>;
        if (!externalId) {
          result = await input.client.upsertContent({ resourceKind: "media", externalId: null, payload: input.bytes, contentType: input.mimeType, fileName: input.fileName });
          externalId = result.id;
          const earlyBinding = await bindExternalChannelProjection(input.db, {
            projectionId,
            externalId,
            externalUrl: result.url,
            remoteFingerprint: fingerprint,
            remoteModifiedAt: typeof result.record.modified_gmt === "string" ? new Date(`${result.record.modified_gmt}Z`) : null,
          });
          if (!earlyBinding.ok) return externalPublishFailed("media_binding_failed", { retryable: false, outcomeCertainty: "ambiguous" });
        } else {
          result = { id: externalId, url: null, record: {} };
        }
        if (input.altText || input.caption) {
          result = await input.client.upsertContent({ resourceKind: "media", externalId, payload: { alt_text: input.altText, caption: input.caption } });
        }
        return externalPublishSucceeded({
          externalId,
          externalUrl: result.url,
          remoteFingerprint: fingerprint,
          remoteModifiedAt: typeof result.record.modified_gmt === "string" ? new Date(`${result.record.modified_gmt}Z`) : null,
          channelMetadata: { hasAltText: Boolean(input.altText), hasCaption: Boolean(input.caption), mimeType: input.mimeType, byteLength: input.bytes.byteLength },
        });
      } catch (error) {
        const candidate = error instanceof WordPressClientError ? error : null;
        return externalPublishFailed(candidate?.code ?? "wordpress_media_failed", {
          retryable: candidate?.ambiguous ? false : candidate?.retryable ?? false,
          outcomeCertainty: candidate?.ambiguous ? "ambiguous" : "known",
        });
      }
    },
  });
}
