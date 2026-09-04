import { z } from "zod";

import { parseConnectorDefinition } from "../kernel/definition";
import type { SuccessfulConnectorCredential } from "../kernel/credential-store";
import { ConnectorError } from "../kernel/error";
import type { ConnectorSafeProjection } from "../kernel/setup-state";

import { createWordPressClient, type WordPressProbe } from "./client";

export const WORDPRESS_CONNECTOR_KEY = "wordpress-self-hosted";

export const wordpressConnectorDefinition = parseConnectorDefinition({
  schemaVersion: 1,
  key: WORDPRESS_CONNECTOR_KEY,
  displayName: "WordPress (self-hosted)",
  capabilities: [
    "wordpress.discover",
    "wordpress.observe",
    "wordpress.read-content",
  ],
  auth: { kind: "api-key" },
  callback: { kind: "none" },
  operations: [
    { id: "discover", capability: "wordpress.discover", retry: { maxAttempts: 2, initialDelayMs: 250, maxDelayMs: 2_000 } },
    { id: "observe", capability: "wordpress.observe", retry: { maxAttempts: 2, initialDelayMs: 250, maxDelayMs: 2_000 } },
    { id: "read-content", capability: "wordpress.read-content", retry: { maxAttempts: 3, initialDelayMs: 500, maxDelayMs: 5_000 } },
  ],
  health: { probeIntervalSeconds: 3_600 },
  sync: { kind: "incremental", operationId: "read-content", cursorField: "modified_gmt,id" },
  authorities: [
    { resource: "wordpress.managed-content", mode: "platform" },
    { resource: "wordpress.presentation", mode: "source" },
    { resource: "wordpress.discovery", mode: "source" },
    { resource: "wordpress.taxonomy-slug", mode: "shared" },
  ],
});

const credentialSchema = z.object({
  siteUrl: z.string().trim().min(1).max(2_048),
  username: z.string().trim().min(1).max(128),
  applicationPassword: z.string().trim().min(1).max(1_024),
}).strict();

export interface WordPressCredential {
  siteUrl: string;
  username: string;
  applicationPassword: string;
}

export function projectWordPressProbe(probe: WordPressProbe): ConnectorSafeProjection {
  return {
    siteName: probe.siteName,
    origin: probe.origin,
    authenticatedUserName: probe.authenticatedUser.name,
    supportedResourceKinds: probe.supportedResourceKinds.join(","),
    supportedTaxonomies: probe.supportedTaxonomies?.join(",") ?? "",
    unsupportedResourceTypes: probe.unsupportedResourceTypes?.join(",") ?? "",
    canCreateDrafts: probe.canCreateDrafts,
    canPublishLive: probe.canPublishLive,
    canUploadMedia: probe.canUploadMedia,
  };
}

export async function parseWordPressCredential(input: unknown): Promise<{
  credential: WordPressCredential;
  serialized: {
    reconnectFields: { siteUrl: string; username: string };
    secretFields: { applicationPassword: string };
    safeProjection: { siteUrl: string; username: string; hasApplicationPassword: true };
  };
}> {
  const parsed = credentialSchema.parse(input);
  const url = new URL(parsed.siteUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("WordPress site URL must be HTTPS and cannot contain credentials, a query, or a fragment.");
  }
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  const siteUrl = url.href.replace(/\/$/, "");
  const credential = { ...parsed, siteUrl };
  return {
    credential,
    serialized: {
      reconnectFields: { siteUrl, username: parsed.username },
      secretFields: { applicationPassword: parsed.applicationPassword },
      safeProjection: { siteUrl, username: parsed.username, hasApplicationPassword: true },
    },
  };
}

export function createWordPressConnectorAdapter(dependencies: {
  createClient?: (input: { credential: WordPressCredential }) => { probe(): Promise<WordPressProbe> };
} = {}) {
  const createClient = dependencies.createClient ?? ((input: { credential: WordPressCredential }) => createWordPressClient(input));
  return {
    definition: wordpressConnectorDefinition,
    async connect(rawInput: unknown): Promise<{ credential: SuccessfulConnectorCredential; probe: WordPressProbe }> {
      let parsed: Awaited<ReturnType<typeof parseWordPressCredential>>;
      try {
        parsed = await parseWordPressCredential(rawInput);
      } catch (cause) {
        throw new ConnectorError("configuration", cause instanceof Error ? cause.message : "Invalid WordPress connection settings.", { cause });
      }
      let probe: WordPressProbe;
      try {
        probe = await createClient({ credential: parsed.credential }).probe();
      } catch (cause) {
        const candidate = cause as { code?: string; message?: string };
        throw new ConnectorError(
          candidate.code === "authentication_failed" ? "authentication" : candidate.code === "permission_denied" ? "authorization" : "upstream_unavailable",
          candidate.message ?? "WordPress connection probe failed.",
          { cause },
        );
      }
      return {
        probe,
        credential: {
          integrationId: WORDPRESS_CONNECTOR_KEY,
          provider: "wordpress",
          reconnectFields: parsed.serialized.reconnectFields,
          secretFields: parsed.serialized.secretFields,
          tokenEnvelope: {},
          safeProjection: {
            ...parsed.serialized.safeProjection,
            ...projectWordPressProbe(probe),
            publicPublicationEnabled: false,
          },
        },
      };
    },
  };
}
