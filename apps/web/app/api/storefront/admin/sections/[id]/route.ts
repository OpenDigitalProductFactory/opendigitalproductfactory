import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma, type Prisma } from "@dpf/db";
import { applySectionTextPatch } from "@/lib/storefront/section-text";
import { apiErrorResponse } from "@/lib/api/error";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json()) as { isVisible?: unknown; text?: unknown };

  const data: Prisma.StorefrontSectionUpdateInput = {};
  if (typeof body.isVisible === "boolean") data.isVisible = body.isVisible;

  // Owner-written section text (BI-C279E20B): validated against the section
  // type's editable fields and merged into the existing content.
  if (body.text !== undefined) {
    const section = await prisma.storefrontSection.findUnique({
      where: { id },
      select: { type: true, content: true },
    });
    if (!section) return apiErrorResponse("NOT_FOUND", "Section not found", 404);
    const patch = applySectionTextPatch({ type: section.type, content: section.content, text: body.text });
    if (!patch.ok) return apiErrorResponse("INVALID_SECTION_TEXT", patch.error, 400);
    data.content = patch.data as Prisma.InputJsonValue;
  }

  if (Object.keys(data).length === 0) {
    return apiErrorResponse("NOTHING_TO_UPDATE", "Nothing to update", 400);
  }
  await prisma.storefrontSection.update({ where: { id }, data });
  return NextResponse.json({ success: true });
}
