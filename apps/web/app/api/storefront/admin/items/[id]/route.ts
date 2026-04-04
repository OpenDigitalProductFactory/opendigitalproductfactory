import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { isActive } = (await req.json()) as { isActive: boolean };
  await prisma.storefrontItem.update({ where: { id }, data: { isActive } });
  return NextResponse.json({ success: true });
}

type UpdateItemBody = {
  name?: string;
  description?: string | null;
  category?: string | null;
  ctaType?: string;
  priceType?: string | null;
  priceAmount?: number | null;
  priceCurrency?: string;
  imageUrl?: string | null;
  ctaLabel?: string | null;
  bookingConfig?: {
    durationMinutes: number;
    schedulingPattern?: string;
    assignmentMode?: string;
    capacity?: number;
    beforeBufferMinutes?: number;
    afterBufferMinutes?: number;
  } | null;
  goalAmount?: number | null;
  suggestedAmount?: number | null;
};

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json()) as UpdateItemBody;

  const existing = await prisma.storefrontItem.findUnique({ where: { id }, select: { id: true, ctaType: true, storefrontId: true } });
  if (!existing) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // Build bookingConfig
  const effectiveCtaType = body.ctaType ?? existing.ctaType;
  let bookingConfigUpdate: Record<string, string | number | boolean> | null | undefined = undefined;

  if (effectiveCtaType === "booking" && body.bookingConfig) {
    bookingConfigUpdate = {
      durationMinutes: body.bookingConfig.durationMinutes,
      schedulingPattern: body.bookingConfig.schedulingPattern ?? "slot",
      assignmentMode: body.bookingConfig.assignmentMode ?? "next-available",
      ...(body.bookingConfig.capacity != null && { capacity: body.bookingConfig.capacity }),
      ...(body.bookingConfig.beforeBufferMinutes != null && { beforeBufferMinutes: body.bookingConfig.beforeBufferMinutes }),
      ...(body.bookingConfig.afterBufferMinutes != null && { afterBufferMinutes: body.bookingConfig.afterBufferMinutes }),
    };
  } else if (effectiveCtaType === "donation") {
    bookingConfigUpdate = {
      ...(body.goalAmount != null && { goalAmount: body.goalAmount }),
      ...(body.suggestedAmount != null && { suggestedAmount: body.suggestedAmount }),
    };
  } else if (body.ctaType && body.ctaType !== "booking" && existing.ctaType === "booking") {
    // Switching away from booking — clear bookingConfig
    bookingConfigUpdate = null;
  }

  // Build update data object, only including fields that were provided
  const updateData: Record<string, unknown> = {};
  if (body.name != null) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.category !== undefined) updateData.category = body.category;
  if (body.ctaType != null) updateData.ctaType = body.ctaType;
  if (body.priceType !== undefined) updateData.priceType = body.priceType;
  if (body.priceAmount !== undefined) updateData.priceAmount = body.priceAmount;
  if (body.priceCurrency != null) updateData.priceCurrency = body.priceCurrency;
  if (body.imageUrl !== undefined) updateData.imageUrl = body.imageUrl;
  if (body.ctaLabel !== undefined) updateData.ctaLabel = body.ctaLabel;
  if (bookingConfigUpdate !== undefined) {
    updateData.bookingConfig = bookingConfigUpdate;
  }

  const item = await prisma.storefrontItem.update({
    where: { id },
    data: updateData,
  });

  // Handle CTA type change: booking <-> non-booking provider service links
  if (body.ctaType && body.ctaType !== existing.ctaType) {
    if (body.ctaType === "booking") {
      // Add provider links for new booking item
      const providers = await prisma.serviceProvider.findMany({
        where: { storefrontId: existing.storefrontId, isActive: true },
        select: { id: true },
      });
      if (providers.length > 0) {
        await prisma.providerService.createMany({
          data: providers.map((p) => ({ providerId: p.id, itemId: id })),
          skipDuplicates: true,
        });
      }
    } else if (existing.ctaType === "booking") {
      // Remove provider links when switching away from booking
      await prisma.providerService.deleteMany({ where: { itemId: id } });
    }
  }

  return NextResponse.json({
    ...item,
    priceAmount: item.priceAmount?.toString() ?? null,
  });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // Check if item has any bookings, orders, or inquiries
  const [bookingCount, inquiryCount] = await Promise.all([
    prisma.storefrontBooking.count({ where: { itemId: id } }),
    prisma.storefrontInquiry.count({ where: { itemId: id } }),
  ]);

  if (bookingCount > 0 || inquiryCount > 0) {
    // Soft delete: deactivate instead of removing
    await prisma.storefrontItem.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ success: true, softDeleted: true, message: "Item has existing bookings/inquiries and was deactivated instead of deleted." });
  }

  // Hard delete: remove provider service links first, then item
  await prisma.providerService.deleteMany({ where: { itemId: id } });
  await prisma.storefrontItem.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
