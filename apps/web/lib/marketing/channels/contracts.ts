// Outbound channel adapter contracts.
//
// Per the marketing-execution-loop spec §5.2, every channel adapter
// (LinkedIn personal publish, email, ads, etc.) implements one shape:
// validate the draft, publish it, optionally fetch engagement, optionally
// receive inbound. The platform owns state machine, approval, audit,
// scheduling, and UX; the adapter only knows the provider-specific
// fetch/serialize semantics.

import type {
  ExternalChannelPublishResult,
  ProjectionPublicationContext,
  ProjectionPublicationIntent,
} from "@/lib/integrations/external-channel-publication";

export type { ProjectionPublicationContext, ProjectionPublicationIntent } from "@/lib/integrations/external-channel-publication";

// Structural types reflect the Prisma OutboundDraft and OutboundPublication
// rows. Re-declaring locally avoids importing Prisma generated names through
// @dpf/db (which only re-exports `prisma` + `Prisma` namespace) and keeps
// adapters portable.
export type OutboundDraftLike = {
  draftId: string;
  organizationId: string;
  domain: string;
  sourceType: string;
  sourceId: string | null;
  strategyId: string | null;
  status: string;
  channelId: string;
  assetType: string;
  body: string;
  bodyFormat: string;
  metadata: unknown;
  createdByAgentId: string | null;
  originalPromptId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OutboundPublicationLike = {
  publicationId: string;
  draftId: string;
  channelId: string;
  credentialId: string | null;
  externalId: string;
  externalUrl: string | null;
  publishedAt: Date;
  publishedByUserId: string;
  toolExecutionId: string | null;
  channelMetadata: unknown;
  lastMetricsPolledAt: Date | null;
  lastMetricsSnapshot: unknown;
};

export type ChannelCapability =
  | "draft-preview"
  | "publish-post"
  | "publish-page"
  | "upload-media"
  | "upsert-content"
  | "send-email"
  | "place-ad"
  | "fetch-engagement"
  | "receive-inbound";

export type AdapterValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export type PublishResult = ExternalChannelPublishResult;

export type EngagementSnapshot = {
  channelId: string;
  externalId: string;
  polledAt: Date;
  metrics: Record<string, number>;
  raw: unknown;
};

export type InboundMessage = {
  externalThreadId: string;
  externalMessageId: string | null;
  fromAddress: string | null;
  fromDisplayName: string | null;
  subject: string | null;
  body: string;
  receivedAt: Date;
  metadata?: Record<string, unknown>;
};

export interface OutboundChannelAdapter {
  readonly channelId: string;
  readonly displayName: string;
  readonly capabilities: ReadonlyArray<ChannelCapability>;
  readonly credentialIntegrationId: string;
  readonly assetTypes: ReadonlyArray<string>;

  validateDraft(draft: OutboundDraftLike): AdapterValidationResult;

  projectionIntent?(
    draft: OutboundDraftLike,
    credential: ChannelCredentialBundle,
  ): ProjectionPublicationIntent;

  publish?(
    draft: OutboundDraftLike,
    credential: ChannelCredentialBundle,
    context?: ProjectionPublicationContext,
  ): Promise<PublishResult>;

  fetchEngagement?(
    publication: OutboundPublicationLike,
    credential: ChannelCredentialBundle,
  ): Promise<EngagementSnapshot>;

  receiveInbound?(
    payload: unknown,
    credential: ChannelCredentialBundle,
  ): Promise<InboundMessage[]>;
}

/**
 * Decrypted credential bundle handed to the adapter. The platform reads
 * `IntegrationCredential.fieldsEnc` and `tokenCacheEnc` via the existing
 * credential-crypto helpers and hands the adapter a typed view. Adapters
 * never touch the credential table directly.
 */
export type ChannelCredentialBundle = {
  credentialId: string;
  integrationId: string;
  provider: string;
  status: string;
  fields: Record<string, unknown>;
  tokens: Record<string, unknown>;
};
