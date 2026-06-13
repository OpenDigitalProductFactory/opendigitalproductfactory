// Storefront admin: list + reorder an owner's media gallery.
//   GET   /api/storefront/admin/media?ownerType=&ownerId=&role=  -> OwnerMediaItem[]
//   PATCH /api/storefront/admin/media  { ownerType, ownerId, role?, order: id[] }
// Upload itself goes through POST /api/media (upload + optional attach).

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { listOwnerMedia, reorderOwnerMedia, type MediaOwnerType } from "@/lib/media";

export const runtime = "nodejs";

function isAdmin(session: { user?: unknown } | null): boolean {
  return Boolean(session?.user && (session.user as { type?: string }).type === "admin");
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const ownerType = url.searchParams.get("ownerType") as MediaOwnerType | null;
  const ownerId = url.searchParams.get("ownerId");
  const role = url.searchParams.get("role") ?? undefined;
  if (!ownerType || !ownerId) {
    return NextResponse.json({ error: "ownerType and ownerId are required" }, { status: 400 });
  }

  const media = await listOwnerMedia(ownerType, ownerId, role);
  return NextResponse.json({ media });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    ownerType?: MediaOwnerType;
    ownerId?: string;
    role?: string;
    order?: string[];
  };
  if (!body.ownerType || !body.ownerId || !Array.isArray(body.order)) {
    return NextResponse.json({ error: "ownerType, ownerId and order[] are required" }, { status: 400 });
  }

  await reorderOwnerMedia(body.ownerType, body.ownerId, body.order, body.role);
  return NextResponse.json({ success: true });
}
