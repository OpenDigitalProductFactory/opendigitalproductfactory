import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createStorefrontInquiryBacklogDraft } from "@/lib/governed-backlog-workflow";
import { ingestBacklogItem } from "@/lib/operate/backlog-ingest";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_backlog",
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    digitalProductId?: string;
  };

  if (!body.digitalProductId) {
    return NextResponse.json(
      { error: "digitalProductId is required to create a product backlog item" },
      { status: 400 },
    );
  }

  const [inquiry, digitalProduct] = await Promise.all([
    prisma.storefrontInquiry.findUnique({
      where: { id },
      select: {
        id: true,
        inquiryRef: true,
        customerName: true,
        customerEmail: true,
        message: true,
        storefront: {
          select: { organizationId: true },
        },
      },
    }),
    prisma.digitalProduct.findUnique({
      where: { id: body.digitalProductId },
      select: { id: true, name: true },
    }),
  ]);

  if (!inquiry) {
    return NextResponse.json({ error: "Inquiry not found" }, { status: 404 });
  }

  if (!digitalProduct) {
    return NextResponse.json({ error: "Digital product not found" }, { status: 400 });
  }

  const draft = createStorefrontInquiryBacklogDraft({
    inquiryId: inquiry.id,
    inquiryRef: inquiry.inquiryRef,
    customerName: inquiry.customerName,
    customerEmail: inquiry.customerEmail,
    message: inquiry.message,
    itemLabel: digitalProduct.name,
  });

  const existing = await prisma.backlogItem.findUnique({
    where: { itemId: draft.itemId },
    select: { id: true, itemId: true, title: true, status: true },
  });

  if (existing) {
    return NextResponse.json({
      success: true,
      created: false,
      backlogItem: existing,
      signal: draft.signalLabel,
    });
  }

  const ingested = await ingestBacklogItem({
    itemId: draft.itemId,
    title: draft.title,
    type: draft.type,
    // Storefront inquiries are engaged product feature work, not a bug or
    // chore. Keep the governed draft's explicit allocation basis.
    workType: draft.workType,
    status: draft.status,
    source: draft.source,
    priority: draft.priority,
    body: draft.body,
    organizationId: inquiry.storefront.organizationId,
    digitalProductId: digitalProduct.id,
    submittedById: user.id,
    origin: { kind: "storefront-inquiry", id: inquiry.inquiryRef },
  });
  const backlogItem = {
    id: ingested.id,
    itemId: ingested.itemId,
    title: draft.title,
    status: draft.status,
  };

  return NextResponse.json({
    success: true,
    created: ingested.created,
    backlogItem,
    signal: draft.signalLabel,
    recommendedTriageOutcome: draft.recommendedTriageOutcome,
  });
}
