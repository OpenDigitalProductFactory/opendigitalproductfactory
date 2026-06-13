// POST /api/media — upload an image, store it as a MediaAsset, and (optionally)
// attach it to an owner entity. Replaces the validation-only /api/v1/upload stub
// for image uploads. See
// docs/superpowers/specs/2026-06-12-media-asset-management-design.md.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  attachMedia,
  createMediaAsset,
  mediaAssetUrl,
  type MediaOwnerType,
} from "@/lib/media";

export const runtime = "nodejs";

const OWNER_TYPES = new Set<MediaOwnerType>([
  "StorefrontItem",
  "RentableUnit",
  "AdoptableAnimal",
  "ServiceProvider",
  "StorefrontConfig",
  "StorefrontSection",
  "Organization",
  "RentalConditionRecord",
]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return NextResponse.json({ error: "No organization configured" }, { status: 409 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Request must be multipart/form-data" }, { status: 422 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file field is required" }, { status: 422 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_IMAGE_BYTES / (1024 * 1024)}MB limit` },
      { status: 413 },
    );
  }
  if (file.type && !ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type '${file.type}'. Accepted: ${[...ALLOWED_IMAGE_MIME_TYPES].join(", ")}` },
      { status: 415 },
    );
  }

  const content = Buffer.from(await file.arrayBuffer());
  const altText = (formData.get("altText") as string | null) ?? null;

  const created = await createMediaAsset({
    organizationId: org.id,
    content,
    declaredMimeType: file.type || null,
    originalName: file.name || null,
    altText,
    createdById: session.user.id,
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.error }, { status: 422 });
  }

  // Optional attach-on-upload.
  const ownerTypeRaw = formData.get("ownerType") as string | null;
  const ownerId = formData.get("ownerId") as string | null;
  let attachmentId: string | undefined;
  if (ownerTypeRaw && ownerId) {
    if (!OWNER_TYPES.has(ownerTypeRaw as MediaOwnerType)) {
      return NextResponse.json({ error: `Unknown ownerType '${ownerTypeRaw}'` }, { status: 422 });
    }
    attachmentId = await attachMedia({
      organizationId: org.id,
      mediaAssetId: created.assetId,
      ownerType: ownerTypeRaw as MediaOwnerType,
      ownerId,
      role: (formData.get("role") as string | null) ?? undefined,
      caption: (formData.get("caption") as string | null) ?? undefined,
    });
  }

  return NextResponse.json(
    {
      assetId: created.assetId,
      url: mediaAssetUrl(created.assetId),
      deduped: created.deduped,
      ...(attachmentId ? { attachmentId } : {}),
    },
    { status: 201 },
  );
}
