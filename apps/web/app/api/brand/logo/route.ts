// POST /api/brand/logo — upload an organisation logo (any common image, incl SVG).
//
// The harmonised logo path: whatever the operator uploads is normalised on their
// behalf (SVG is rasterised to PNG) and stored as a served MediaAsset, with
// Organization.logoUrl set to the /api/media URL. Returns { url } for the wizard
// to show immediately. The operator never picks a format.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { ingestLogoUpload, mediaAssetUrl } from "@/lib/media";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await prisma.organization.findFirst({ select: { id: true, name: true } });
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
    return NextResponse.json({ error: "A logo file is required" }, { status: 422 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That image is a bit large — please use one under 5 MB." }, { status: 413 });
  }

  const content = Buffer.from(await file.arrayBuffer());
  const assetId = await ingestLogoUpload({
    organizationId: org.id,
    content,
    mimeType: file.type || null,
    name: org.name,
    createdById: (session.user as { id?: string }).id ?? null,
  });

  if (!assetId) {
    return NextResponse.json(
      { error: "We couldn't read that as an image. Try a PNG, JPG, or SVG of your logo." },
      { status: 422 },
    );
  }

  return NextResponse.json({ url: mediaAssetUrl(assetId) }, { status: 201 });
}
