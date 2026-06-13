// Storefront admin: mutate or remove a single media attachment.
//   PATCH  /api/storefront/admin/media/:attachmentId
//          { setPrimary?: true, caption?: string|null, assetId?, altText?: string|null }
//   DELETE /api/storefront/admin/media/:attachmentId   -> detach (asset/blob kept)

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  detachMedia,
  setPrimaryAttachment,
  updateAssetAltText,
  updateAttachmentCaption,
} from "@/lib/media";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ attachmentId: string }> };

function isAdmin(session: { user?: unknown } | null): boolean {
  return Boolean(session?.user && (session.user as { type?: string }).type === "admin");
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!isAdmin(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attachmentId } = await context.params;
  const body = (await req.json()) as {
    setPrimary?: boolean;
    caption?: string | null;
    assetId?: string;
    altText?: string | null;
  };

  if (body.setPrimary) await setPrimaryAttachment(attachmentId);
  if (body.caption !== undefined) await updateAttachmentCaption(attachmentId, body.caption);
  if (body.assetId && body.altText !== undefined) await updateAssetAltText(body.assetId, body.altText);

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!isAdmin(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attachmentId } = await context.params;
  const owner = await detachMedia(attachmentId);
  if (!owner) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
