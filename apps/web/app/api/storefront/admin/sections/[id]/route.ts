import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma, type Prisma } from "@dpf/db";
import { applySectionTextPatch } from "@/lib/storefront/section-text";

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
    if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const patch = applySectionTextPatch({ type: section.type, content: section.content, text: body.text });
    if (!patch.ok) return NextResponse.json({ error: patch.error }, { status: 400 });
    data.content = patch.content as Prisma.InputJsonValue;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  await prisma.storefrontSection.update({ where: { id }, data });
  return NextResponse.json({ success: true });
}
