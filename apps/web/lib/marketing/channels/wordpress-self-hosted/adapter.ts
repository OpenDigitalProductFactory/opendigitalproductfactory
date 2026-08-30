import { createWordPressClient, WordPressClientError } from "@/lib/integrations/wordpress/client";
import type { WordPressCredential } from "@/lib/integrations/wordpress/connector";
import {
  buildWordPressProjectionDocument,
  fingerprintWordPressProjection,
  serializeWordPressProjection,
} from "@/lib/integrations/wordpress/projection";
import { readStoredWordPressCredential, readWordPressPublicPublicationPolicy } from "@/lib/integrations/wordpress/stored-credential";
import { externalPublishFailed, externalPublishSucceeded } from "@/lib/integrations/external-channel-publication";
import { ok } from "@/lib/shared/action-result";

import type {
  AdapterValidationResult,
  ChannelCredentialBundle,
  OutboundChannelAdapter,
  OutboundDraftLike,
  ProjectionPublicationContext,
  PublishResult,
} from "../contracts";

const ASSET_RESOURCE = new Map<string, "post" | "page">([
  ["wordpress-post", "post"],
  ["wordpress-page", "page"],
]);
const WORDPRESS_METADATA_FIELDS = new Set(["title", "locale", "publicPublicationAuthorized", "excerpt", "slug", "requestedStatus", "scheduledAt", "termIds", "featuredMediaId"]);
const WORDPRESS_CHANNEL_IDS = new Set(["wordpress-self-hosted", "wordpress"]);

type Client = Pick<ReturnType<typeof createWordPressClient>, "upsertContent">;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function title(draft: OutboundDraftLike): string | null {
  const value = record(draft.metadata).title;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createWordPressOutboundAdapter(dependencies: {
  createClient?: (input: { credential: WordPressCredential }) => Client;
} = {}): OutboundChannelAdapter {
  const createClient = dependencies.createClient ?? ((input: { credential: WordPressCredential }) => createWordPressClient(input));
  return {
    channelId: "wordpress-self-hosted",
    displayName: "WordPress",
    capabilities: ["draft-preview", "publish-post", "publish-page", "upload-media", "upsert-content"],
    credentialIntegrationId: "wordpress-self-hosted",
    assetTypes: [...ASSET_RESOURCE.keys()],

    validateDraft(draft: OutboundDraftLike): AdapterValidationResult {
      if (!WORDPRESS_CHANNEL_IDS.has(draft.channelId)) return { ok: false, reason: "Draft is not routed to WordPress." };
      if (!ASSET_RESOURCE.has(draft.assetType)) return { ok: false, reason: `Unsupported WordPress asset type ${JSON.stringify(draft.assetType)}.` };
      if (!title(draft)) return { ok: false, reason: "WordPress title is required in draft metadata." };
      if (!draft.body.trim()) return { ok: false, reason: "WordPress body is empty." };
      if (draft.bodyFormat === "markdown") return { ok: false, reason: "Render Markdown to approved HTML before WordPress projection." };
      const unsupported = Object.keys(record(draft.metadata)).filter((key) => !WORDPRESS_METADATA_FIELDS.has(key));
      if (unsupported.length) return { ok: false, reason: `Unsupported WordPress fields: ${unsupported.join(", ")}.` };
      return ok();
    },

    projectionIntent(draft: OutboundDraftLike, credential: ChannelCredentialBundle) {
      const validation = this.validateDraft(draft);
      if (!validation.ok) throw new Error(validation.reason);
      const resourceKind = ASSET_RESOURCE.get(draft.assetType)!;
      const metadata = record(draft.metadata);
      const publicPublicationAuthorized = metadata.publicPublicationAuthorized === true && readWordPressPublicPublicationPolicy(credential.fields);
      const document = buildWordPressProjectionDocument({
        sourceType: "outbound_draft",
        sourceId: draft.draftId,
        sourceVersion: draft.updatedAt.toISOString(),
        resourceKind,
        locale: typeof metadata.locale === "string" ? metadata.locale : "und",
        title: title(draft)!,
        body: draft.body,
        bodyFormat: draft.bodyFormat as "markdown" | "html" | "plain",
        metadata: Object.fromEntries(Object.entries(metadata).filter(([key]) => !["title", "locale", "publicPublicationAuthorized"].includes(key))),
        publicPublicationAuthorized,
      });
      return {
        connectorKey: "wordpress-self-hosted",
        connectionId: credential.integrationId,
        credentialId: credential.credentialId,
        sourceType: document.sourceType,
        sourceId: document.sourceId,
        sourceVersion: document.sourceVersion,
        resourceKind: document.resourceKind,
        locale: document.locale,
        localFingerprint: fingerprintWordPressProjection(document),
        payload: serializeWordPressProjection(document),
      };
    },

    async publish(draft: OutboundDraftLike, credential: ChannelCredentialBundle, context?: ProjectionPublicationContext): Promise<PublishResult> {
      if (!context) return externalPublishFailed("WordPress publication requires a durable projection reservation.", { retryable: false });
      const parsed = readStoredWordPressCredential(credential.fields);
      if (!parsed) return externalPublishFailed("WordPress credential is incomplete. Reconnect the integration.", { retryable: false });
      const resourceKind = ASSET_RESOURCE.get(draft.assetType);
      if (!resourceKind) return externalPublishFailed("Unsupported WordPress resource kind.", { retryable: false });
      try {
        const result = await createClient({ credential: parsed }).upsertContent({ resourceKind, externalId: context.existingExternalId, payload: context.payload });
        return externalPublishSucceeded({
          externalId: result.id,
          externalUrl: result.url,
          remoteModifiedAt: typeof result.record.modified_gmt === "string" ? new Date(`${result.record.modified_gmt}Z`) : null,
        });
      } catch (error) {
        const candidate = error instanceof WordPressClientError ? error : null;
        return externalPublishFailed(candidate?.code ?? "wordpress_request_failed", {
          retryable: candidate?.ambiguous ? false : candidate?.retryable ?? false,
          outcomeCertainty: candidate?.ambiguous ? "ambiguous" : "known",
        });
      }
    },
  };
}
