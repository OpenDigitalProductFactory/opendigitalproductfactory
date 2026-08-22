import {
  executeProjectedPublication,
  externalPublishFailed,
  externalPublishSucceeded,
  type ExternalChannelPublishResult,
} from "../external-channel-publication";
import { WordPressClientError } from "./client";
import {
  fingerprintWordPressProjection,
  serializeWordPressProjection,
  type WordPressProjectionDocument,
} from "./projection";

type ProjectionDb = Parameters<typeof executeProjectedPublication>[0]["db"];

export async function projectApprovedWordPressContent(input: {
  db: ProjectionDb;
  connectionId: string;
  credentialId: string | null;
  document: WordPressProjectionDocument;
  client: {
    upsertContent(input: { resourceKind: "post" | "page"; externalId: string | null; payload: Record<string, unknown> }): Promise<{ id: string; url: string | null; record: Record<string, unknown> }>;
  };
}): Promise<ExternalChannelPublishResult> {
  if (input.document.resourceKind !== "post" && input.document.resourceKind !== "page") {
    return externalPublishFailed("unsupported_content_resource", { retryable: false });
  }
  const payload = serializeWordPressProjection(input.document);
  const localFingerprint = fingerprintWordPressProjection(input.document);
  return executeProjectedPublication({
    db: input.db,
    intent: {
      connectorKey: "wordpress-self-hosted",
      connectionId: input.connectionId,
      credentialId: input.credentialId,
      sourceType: input.document.sourceType,
      sourceId: input.document.sourceId,
      sourceVersion: input.document.sourceVersion,
      resourceKind: input.document.resourceKind,
      locale: input.document.locale,
      localFingerprint,
      payload,
    },
    publish: async ({ existingExternalId }) => {
      try {
        const result = await input.client.upsertContent({ resourceKind: input.document.resourceKind as "post" | "page", externalId: existingExternalId, payload });
        return externalPublishSucceeded({
          externalId: result.id,
          externalUrl: result.url,
          remoteModifiedAt: typeof result.record.modified_gmt === "string" ? new Date(`${result.record.modified_gmt}Z`) : null,
        });
      } catch (error) {
        const candidate = error instanceof WordPressClientError ? error : null;
        return externalPublishFailed(candidate?.code ?? "wordpress_content_failed", {
          retryable: candidate?.ambiguous ? false : candidate?.retryable ?? false,
          outcomeCertainty: candidate?.ambiguous ? "ambiguous" : "known",
        });
      }
    },
  });
}
