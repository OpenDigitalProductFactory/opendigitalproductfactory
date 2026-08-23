import { fingerprintExternalChannelPayload, type ExternalChannelResourceKind, type ExternalChannelProjectionSourceType } from "../external-channel-projection";

export interface WordPressProjectionDocument {
  sourceType: ExternalChannelProjectionSourceType;
  sourceId: string;
  sourceVersion: string;
  resourceKind: ExternalChannelResourceKind;
  locale: string;
  title: string;
  body: string;
  bodyFormat: "markdown" | "html" | "plain";
  excerpt: string | null;
  slug: string | null;
  status: "draft" | "future" | "publish";
  scheduledAt: string | null;
  termIds: readonly number[];
  featuredMediaId: number | null;
}

const ALLOWED_METADATA = new Set(["excerpt", "slug", "requestedStatus", "scheduledAt", "termIds", "featuredMediaId"]);

export function buildWordPressProjectionDocument(input: {
  sourceType: ExternalChannelProjectionSourceType;
  sourceId: string;
  sourceVersion: string;
  resourceKind: "post" | "page";
  locale: string;
  title: string;
  body: string;
  bodyFormat: "markdown" | "html" | "plain";
  metadata: unknown;
  publicPublicationAuthorized: boolean;
}): WordPressProjectionDocument {
  const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
    ? input.metadata as Record<string, unknown>
    : {};
  const unsupported = Object.keys(metadata).filter((key) => !ALLOWED_METADATA.has(key));
  if (unsupported.length) throw new Error(`Unsupported WordPress projection fields: ${unsupported.join(", ")}`);
  if (!input.title.trim() || input.title.length > 500) throw new Error("WordPress projection title must contain 1 to 500 characters.");
  if (!input.body.trim() || input.body.length > 1_000_000) throw new Error("WordPress projection body must contain 1 to 1,000,000 characters.");
  if (input.bodyFormat === "markdown") throw new Error("Markdown requires an explicit approved HTML rendering before WordPress projection.");
  if (metadata.excerpt !== undefined && typeof metadata.excerpt !== "string") throw new Error("WordPress projection excerpt must be a string.");
  if (typeof metadata.excerpt === "string" && metadata.excerpt.length > 10_000) throw new Error("WordPress projection excerpt exceeds 10,000 characters.");
  if (metadata.slug !== undefined && typeof metadata.slug !== "string") throw new Error("WordPress projection slug must be a string.");
  if (typeof metadata.slug === "string" && metadata.slug.length > 200) throw new Error("WordPress projection slug exceeds 200 characters.");
  const requestedStatus = metadata.requestedStatus;
  if (requestedStatus !== undefined && !["draft", "future", "publish"].includes(String(requestedStatus))) {
    throw new Error("WordPress projection requestedStatus must be draft, future, or publish.");
  }
  const status = input.publicPublicationAuthorized && (requestedStatus === "publish" || requestedStatus === "future")
    ? requestedStatus
    : "draft";
  if (metadata.scheduledAt !== undefined && (typeof metadata.scheduledAt !== "string" || Number.isNaN(Date.parse(metadata.scheduledAt)))) {
    throw new Error("WordPress projection scheduledAt must be a valid timestamp.");
  }
  const scheduledAt = typeof metadata.scheduledAt === "string" && !Number.isNaN(Date.parse(metadata.scheduledAt))
    ? new Date(metadata.scheduledAt).toISOString()
    : null;
  if (status === "future" && !scheduledAt) throw new Error("Scheduled WordPress publication requires a valid scheduledAt timestamp.");
  if (metadata.termIds !== undefined && (!Array.isArray(metadata.termIds)
    || metadata.termIds.length > 100
    || !metadata.termIds.every((value) => Number.isSafeInteger(value) && Number(value) > 0))) {
    throw new Error("WordPress projection termIds must contain at most 100 positive integer IDs.");
  }
  if (metadata.featuredMediaId !== undefined && (!Number.isSafeInteger(metadata.featuredMediaId) || Number(metadata.featuredMediaId) <= 0)) {
    throw new Error("WordPress projection featuredMediaId must be a positive integer ID.");
  }
  const termIds = Array.isArray(metadata.termIds) ? metadata.termIds.map(Number) : [];
  return Object.freeze({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion,
    resourceKind: input.resourceKind,
    locale: input.locale,
    title: input.title.trim(),
    body: input.body,
    bodyFormat: input.bodyFormat,
    excerpt: typeof metadata.excerpt === "string" ? metadata.excerpt : null,
    slug: typeof metadata.slug === "string" ? metadata.slug : null,
    status,
    scheduledAt,
    termIds: Object.freeze(termIds),
    featuredMediaId: Number.isSafeInteger(metadata.featuredMediaId) ? Number(metadata.featuredMediaId) : null,
  });
}

export function serializeWordPressProjection(document: WordPressProjectionDocument): Record<string, unknown> {
  return {
    title: document.title,
    content: document.body,
    status: document.status,
    ...(document.status === "future" && document.scheduledAt ? { date_gmt: document.scheduledAt } : {}),
    ...(document.excerpt ? { excerpt: document.excerpt } : {}),
    ...(document.slug ? { slug: document.slug } : {}),
    ...(document.termIds.length ? { categories: document.termIds } : {}),
    ...(document.featuredMediaId ? { featured_media: document.featuredMediaId } : {}),
  };
}

export function fingerprintWordPressProjection(document: WordPressProjectionDocument): string {
  return fingerprintExternalChannelPayload(serializeWordPressProjection(document));
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function editableText(value: unknown): string {
  const field = object(value);
  return typeof field.raw === "string" ? field.raw : typeof field.rendered === "string" ? field.rendered : "";
}

export function normalizeObservedWordPressResource(value: unknown): Record<string, unknown> {
  const remote = object(value);
  return {
    title: editableText(remote.title),
    content: editableText(remote.content),
    ...(editableText(remote.excerpt) ? { excerpt: editableText(remote.excerpt) } : {}),
    ...(typeof remote.slug === "string" && remote.slug ? { slug: remote.slug } : {}),
    status: typeof remote.status === "string" ? remote.status : "draft",
    ...(typeof remote.date_gmt === "string" && remote.date_gmt && !Number.isNaN(Date.parse(remote.date_gmt.endsWith("Z") ? remote.date_gmt : `${remote.date_gmt}Z`))
      ? { date_gmt: new Date(remote.date_gmt.endsWith("Z") ? remote.date_gmt : `${remote.date_gmt}Z`).toISOString() }
      : {}),
    ...(Array.isArray(remote.categories) ? { categories: remote.categories.filter(Number.isInteger).map(Number).sort((a, b) => a - b) } : {}),
    ...(Number.isInteger(remote.featured_media) && Number(remote.featured_media) > 0 ? { featured_media: Number(remote.featured_media) } : {}),
  };
}

export function fingerprintObservedWordPressResource(value: unknown): string {
  return fingerprintExternalChannelPayload(normalizeObservedWordPressResource(value));
}
