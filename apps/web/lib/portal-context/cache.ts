import { createHash } from "node:crypto";

import type { PortalContextInput } from "./types";

const ENVELOPE_BUCKET_MS = 30_000;

export function bucketPortalContextTimestamp(now = new Date()): Date {
  return new Date(Math.floor(now.getTime() / ENVELOPE_BUCKET_MS) * ENVELOPE_BUCKET_MS);
}

export function createPortalContextEnvelopeId(input: PortalContextInput, userId: string, bucket: Date): string {
  const parts = [
    input.pathname,
    input.buildId ?? "",
    input.capsuleId ?? "",
    input.threadId ?? "",
    userId,
    bucket.toISOString(),
  ];

  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

export function portalContextCacheTags(input: PortalContextInput, userId: string): string[] {
  return [
    "portal-context",
    `portal-context:user:${userId}`,
    input.buildId ? `portal-context:build:${input.buildId}` : null,
    input.capsuleId ? `portal-context:capsule:${input.capsuleId}` : null,
    input.threadId ? `portal-context:thread:${input.threadId}` : null,
  ].filter((tag): tag is string => Boolean(tag));
}
