import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { captureBusinessDocument } from "@/lib/onboarding/capture-business-document";

export const runtime = "nodejs";

// Capture a business plan / key document uploaded during onboarding into the
// Document DMS (org-scoped). Corpus indexing (enrichOrgCorpus) is wired later
// via the capture lib's `enrich` seam once BI-7C9D6198 lands.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return NextResponse.json(
      { error: "Organization not found. Complete account setup first." },
      { status: 400 },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const titleRaw = formData.get("title");
  const title = typeof titleRaw === "string" && titleRaw.trim().length > 0 ? titleRaw : null;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await captureBusinessDocument({
      organizationId: org.id,
      fileName: file.name,
      mimeType: file.type,
      buffer,
      title,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Capture failed" },
      { status: 400 },
    );
  }
}
