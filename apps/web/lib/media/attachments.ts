// Media asset orchestration + polymorphic attachment helpers.
//
// createMediaAsset       hash → dedupe → probe → store → MediaAsset row
// attachMedia            attach an asset to any owner (ordered, role-tagged)
// listOwnerMedia         fetch an owner's gallery for a role, ordered
// deleteMediaForOwner    sweep attachments when an owner is deleted (no owner FK)
// syncPrimaryImage       refresh the denormalized scalar imageUrl/logoUrl/... cache
// mediaAssetUrl          the retrieval URL for an asset id
//
// See docs/superpowers/specs/2026-06-12-media-asset-management-design.md.

import { prisma } from "@dpf/db";
import { probeImage } from "./image-probe";
import { prepareMediaBlobContentForStorage, writeMediaBlob } from "./media-storage";

export type MediaOwnerType =
  | "StorefrontItem"
  | "RentableUnit"
  | "AdoptableAnimal"
  | "ServiceProvider"
  | "StorefrontConfig"
  | "StorefrontSection"
  | "Organization"
  | "RentalConditionRecord"
  // A UX-critique entry (a craft-override WikiPage) owns its screenshot as an
  // attachment, so the image is anchored to the entry rather than left as a
  // free-floating asset an unreferenced-asset sweep could reclaim. `ownerType`
  // is a plain String column, so this is a pure type widening — no migration.
  | "WikiPage";

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB

/** The retrieval URL for a stored asset. Content-addressed → safe to cache hard. */
export function mediaAssetUrl(assetId: string): string {
  return `/api/media/${assetId}`;
}

export type CreateMediaAssetInput = {
  organizationId: string;
  content: Buffer;
  declaredMimeType?: string | null;
  originalName?: string | null;
  altText?: string | null;
  createdById?: string | null;
};

export type CreateMediaAssetResult =
  | { ok: true; assetId: string; deduped: boolean }
  | { ok: false; error: string };

/**
 * Store an image and return its MediaAsset id. Deduplicates within the org on the
 * content hash, so re-uploading identical bytes reuses the existing row + blob.
 */
export async function createMediaAsset(
  input: CreateMediaAssetInput,
): Promise<CreateMediaAssetResult> {
  const { organizationId, content } = input;
  if (content.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, error: `Image exceeds ${MAX_IMAGE_BYTES / (1024 * 1024)}MB limit` };
  }

  let preparedContent: ReturnType<typeof prepareMediaBlobContentForStorage>;
  try {
    preparedContent = prepareMediaBlobContentForStorage(content, {
      allowedMimeTypes: ALLOWED_IMAGE_MIME_TYPES,
      maxBytes: MAX_IMAGE_BYTES,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid media upload." };
  }
  const probed = probeImage(preparedContent);
  const mimeType = probed.mimeType ?? input.declaredMimeType ?? null;
  if (!mimeType || !ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    return {
      ok: false,
      error: `Unsupported or unrecognised image type. Accepted: ${[...ALLOWED_IMAGE_MIME_TYPES].join(", ")}`,
    };
  }

  const blob = await writeMediaBlob(preparedContent);

  // Content-addressed dedupe within the org.
  const existing = await prisma.mediaAsset.findUnique({
    where: { organizationId_sha256: { organizationId, sha256: blob.sha256 } },
    select: { id: true },
  });
  if (existing) return { ok: true, assetId: existing.id, deduped: true };

  const asset = await prisma.mediaAsset.create({
    data: {
      organizationId,
      sha256: blob.sha256,
      storageKey: blob.storageKey,
      storageDriver: "filesystem",
      kind: "image",
      mimeType,
      sizeBytes: blob.sizeBytes,
      width: probed.width ?? undefined,
      height: probed.height ?? undefined,
      altText: input.altText ?? undefined,
      originalName: input.originalName ?? undefined,
      createdById: input.createdById ?? undefined,
      status: "ready",
    },
    select: { id: true },
  });

  return { ok: true, assetId: asset.id, deduped: false };
}

export type AttachMediaInput = {
  organizationId: string;
  mediaAssetId: string;
  ownerType: MediaOwnerType;
  ownerId: string;
  role?: string;
  sortOrder?: number;
  caption?: string | null;
};

/** Attach an asset to an owner. If sortOrder is omitted it appends to the end. */
export async function attachMedia(input: AttachMediaInput): Promise<string> {
  const role = input.role ?? "gallery";
  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const last = await prisma.mediaAttachment.findFirst({
      where: { ownerType: input.ownerType, ownerId: input.ownerId, role },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    sortOrder = (last?.sortOrder ?? -1) + 1;
  }

  const attachment = await prisma.mediaAttachment.create({
    data: {
      organizationId: input.organizationId,
      mediaAssetId: input.mediaAssetId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      role,
      sortOrder,
      caption: input.caption ?? undefined,
    },
    select: { id: true },
  });

  await syncPrimaryImage(input.ownerType, input.ownerId);
  return attachment.id;
}

export type OwnerMediaItem = {
  attachmentId: string;
  assetId: string;
  url: string;
  role: string;
  sortOrder: number;
  caption: string | null;
  altText: string | null;
  width: number | null;
  height: number | null;
};

/** An owner's media for a role (or all roles), ordered for display. */
export async function listOwnerMedia(
  ownerType: MediaOwnerType,
  ownerId: string,
  role?: string,
): Promise<OwnerMediaItem[]> {
  const rows = await prisma.mediaAttachment.findMany({
    where: { ownerType, ownerId, ...(role ? { role } : {}) },
    orderBy: [{ role: "asc" }, { sortOrder: "asc" }],
    select: {
      id: true,
      mediaAssetId: true,
      role: true,
      sortOrder: true,
      caption: true,
      asset: { select: { altText: true, width: true, height: true } },
    },
  });

  return rows.map((r) => ({
    attachmentId: r.id,
    assetId: r.mediaAssetId,
    url: mediaAssetUrl(r.mediaAssetId),
    role: r.role,
    sortOrder: r.sortOrder,
    caption: r.caption,
    altText: r.asset.altText,
    width: r.asset.width,
    height: r.asset.height,
  }));
}

/**
 * Remove every attachment for an owner. Call from the owner's delete path — the
 * polymorphic join has no owner-side FK, so this is how orphans are prevented.
 * The underlying MediaAsset rows/blobs are intentionally left (still dedup-shared
 * by other owners); an unreferenced-asset sweep is a separate maintenance job.
 */
export async function deleteMediaForOwner(
  ownerType: MediaOwnerType,
  ownerId: string,
): Promise<number> {
  const { count } = await prisma.mediaAttachment.deleteMany({
    where: { ownerType, ownerId },
  });
  return count;
}

// Which scalar cache column each owner type keeps in sync, and the attachment
// role that feeds it. Owners absent here simply have no scalar cache to refresh.
const PRIMARY_CACHE: Partial<
  Record<MediaOwnerType, { roles: string[]; apply: (id: string, url: string | null) => Promise<unknown> }>
> = {
  StorefrontItem: {
    roles: ["primary", "product", "gallery"],
    apply: (id, url) => prisma.storefrontItem.update({ where: { id }, data: { imageUrl: url } }),
  },
  ServiceProvider: {
    roles: ["avatar", "primary"],
    apply: (id, url) => prisma.serviceProvider.update({ where: { id }, data: { avatarUrl: url } }),
  },
  StorefrontConfig: {
    roles: ["hero", "primary"],
    apply: (id, url) => prisma.storefrontConfig.update({ where: { id }, data: { heroImageUrl: url } }),
  },
  Organization: {
    roles: ["logo", "primary"],
    apply: (id, url) => prisma.organization.update({ where: { id }, data: { logoUrl: url } }),
  },
};

/**
 * Refresh an owner's denormalized scalar image URL from its primary attachment,
 * so every surface that still reads `imageUrl`/`logoUrl`/`avatarUrl`/`heroImageUrl`
 * keeps working while galleries are layered on additively.
 */
export async function syncPrimaryImage(
  ownerType: MediaOwnerType,
  ownerId: string,
): Promise<void> {
  const cache = PRIMARY_CACHE[ownerType];
  if (!cache) return;

  const attachments = await prisma.mediaAttachment.findMany({
    where: { ownerType, ownerId, role: { in: cache.roles } },
    orderBy: [{ sortOrder: "asc" }],
    select: { mediaAssetId: true, role: true, sortOrder: true },
  });

  // Pick by role precedence (cache.roles order), then sortOrder.
  let chosen: { mediaAssetId: string } | undefined;
  for (const role of cache.roles) {
    const match = attachments.filter((a) => a.role === role).sort((a, b) => a.sortOrder - b.sortOrder)[0];
    if (match) {
      chosen = match;
      break;
    }
  }

  await cache.apply(ownerId, chosen ? mediaAssetUrl(chosen.mediaAssetId) : null);

  // AdoptableAnimal caches the primary asset *id* (not a URL) on the row.
  if (ownerType === "AdoptableAnimal") {
    const first = await prisma.mediaAttachment.findFirst({
      where: { ownerType, ownerId },
      orderBy: [{ sortOrder: "asc" }],
      select: { mediaAssetId: true },
    });
    await prisma.adoptableAnimal.update({
      where: { id: ownerId },
      data: { primaryPhotoAssetId: first?.mediaAssetId ?? null },
    });
  }
}

/**
 * Detach one attachment by id (does not delete the shared asset/blob). Returns
 * the owner so the caller can resync its primary cache, or null if not found.
 */
export async function detachMedia(
  attachmentId: string,
): Promise<{ ownerType: MediaOwnerType; ownerId: string } | null> {
  const existing = await prisma.mediaAttachment.findUnique({
    where: { id: attachmentId },
    select: { ownerType: true, ownerId: true },
  });
  if (!existing) return null;
  await prisma.mediaAttachment.delete({ where: { id: attachmentId } });
  const owner = { ownerType: existing.ownerType as MediaOwnerType, ownerId: existing.ownerId };
  await syncPrimaryImage(owner.ownerType, owner.ownerId);
  return owner;
}

/**
 * Reorder an owner's gallery for a role. `orderedAttachmentIds` is the desired
 * order; each is written its index as sortOrder. Ids not belonging to the owner
 * are ignored. Refreshes the primary cache (position 0 becomes primary).
 */
export async function reorderOwnerMedia(
  ownerType: MediaOwnerType,
  ownerId: string,
  orderedAttachmentIds: string[],
  role?: string,
): Promise<void> {
  const owned = await prisma.mediaAttachment.findMany({
    where: { ownerType, ownerId, ...(role ? { role } : {}) },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((a) => a.id));
  await prisma.$transaction(
    orderedAttachmentIds
      .filter((id) => ownedIds.has(id))
      .map((id, index) =>
        prisma.mediaAttachment.update({ where: { id }, data: { sortOrder: index } }),
      ),
  );
  await syncPrimaryImage(ownerType, ownerId);
}

/** Make one attachment the primary (sortOrder 0); others shift down. */
export async function setPrimaryAttachment(attachmentId: string): Promise<void> {
  const target = await prisma.mediaAttachment.findUnique({
    where: { id: attachmentId },
    select: { ownerType: true, ownerId: true, role: true },
  });
  if (!target) return;
  const siblings = await prisma.mediaAttachment.findMany({
    where: { ownerType: target.ownerType, ownerId: target.ownerId, role: target.role },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  const reordered = [attachmentId, ...siblings.map((s) => s.id).filter((id) => id !== attachmentId)];
  await reorderOwnerMedia(
    target.ownerType as MediaOwnerType,
    target.ownerId,
    reordered,
    target.role,
  );
}

/** Update an attachment's caption. */
export async function updateAttachmentCaption(
  attachmentId: string,
  caption: string | null,
): Promise<void> {
  await prisma.mediaAttachment.update({
    where: { id: attachmentId },
    data: { caption },
  });
}

/** Update the alt text on the underlying asset (SEO + accessibility). */
export async function updateAssetAltText(
  assetId: string,
  altText: string | null,
): Promise<void> {
  await prisma.mediaAsset.update({ where: { id: assetId }, data: { altText } });
}
