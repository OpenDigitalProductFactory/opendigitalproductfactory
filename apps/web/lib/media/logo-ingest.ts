// Ingest an organisation logo into the managed media store.
//
// Brand extraction captures the logo as `designSystem.identity.logo.mark` — a
// base64 `data:` URI (uploads) or an external URL (scraped). That left the only
// copy of the logo as a blob inside a JSON column, never served as a real asset.
// This decodes/fetches the bytes once, stores them as a content-addressed
// MediaAsset, and attaches it to the Organization with role="logo" — which syncs
// Organization.logoUrl to the served /api/media URL via syncPrimaryImage.

import { attachMedia, createMediaAsset } from "./attachments";

const MAX_LOGO_BYTES = 5 * 1024 * 1024; // logos are small; cap fetches

type LogoRef = { url?: string | null; mimeType?: string | null } | null | undefined;

export function decodeDataUri(url: string): { content: Buffer; mimeType: string } | null {
  const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mimeType = match[1] || "image/png";
  const isBase64 = Boolean(match[2]);
  const raw = match[3] ?? "";
  const content = isBase64
    ? Buffer.from(raw, "base64")
    : Buffer.from(decodeURIComponent(raw), "utf-8");
  if (content.byteLength === 0) return null;
  return { content, mimeType };
}

async function fetchUrl(url: string, declaredMime?: string | null): Promise<{ content: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_LOGO_BYTES) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || declaredMime || "image/png";
    return { content: buf, mimeType };
  } catch {
    return null;
  }
}

/**
 * Persist an organisation's logo from an extracted asset ref as a MediaAsset and
 * attach it with role="logo". Returns the asset id, or null if there was nothing
 * usable to ingest (so callers can stay non-fatal). Never throws for an
 * unreadable/oversized/non-image source.
 *
 * Note: createMediaAsset accepts only raster images (png/jpeg/gif/webp), so an
 * SVG logo returns null here and the design-system copy is left as-is — serving
 * unsanitised SVG same-origin is an XSS risk, so safe SVG-logo ingestion is a
 * deliberate follow-up rather than something this path silently enables.
 */
export async function ingestOrganizationLogo(input: {
  organizationId: string;
  ref: LogoRef;
  name?: string | null;
  createdById?: string | null;
}): Promise<string | null> {
  const url = input.ref?.url?.trim();
  if (!url) return null;

  // Already a managed media URL — nothing to do.
  if (url.startsWith("/api/media/")) return null;

  const decoded = url.startsWith("data:")
    ? decodeDataUri(url)
    : /^https?:\/\//i.test(url)
      ? await fetchUrl(url, input.ref?.mimeType)
      : null;
  if (!decoded) return null;

  const created = await createMediaAsset({
    organizationId: input.organizationId,
    content: decoded.content,
    declaredMimeType: input.ref?.mimeType ?? decoded.mimeType,
    originalName: `${input.name?.trim() || "brand"}-logo`,
    altText: input.name ? `${input.name} logo` : "Organisation logo",
    createdById: input.createdById ?? null,
  });
  if (!created.ok) return null;

  await attachMedia({
    organizationId: input.organizationId,
    mediaAssetId: created.assetId,
    ownerType: "Organization",
    ownerId: input.organizationId,
    role: "logo",
    sortOrder: 0,
  });

  return created.assetId;
}
