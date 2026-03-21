import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import crypto from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = await req.json();
  const { itemId, providerId, slotStart, slotEnd } = body as {
    itemId: string;
    providerId?: string;
    slotStart: string;
    slotEnd: string;
  };

  if (!itemId || !slotStart || !slotEnd) {
    return NextResponse.json(
      { error: "itemId, slotStart, and slotEnd are required" },
      { status: 400 }
    );
  }

  // Find storefront
  const storefront = await prisma.storefrontConfig.findFirst({
    where: { organization: { slug }, isPublished: true },
    select: { id: true },
  });
  if (!storefront) {
    return NextResponse.json({ error: "Storefront not found" }, { status: 404 });
  }

  const now = new Date();
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  // Rate limit: max 50 concurrent active holds per storefront
  const globalCount = await prisma.bookingHold.count({
    where: { storefrontId: storefront.id, expiresAt: { gt: now } },
  });
  if (globalCount >= 50) {
    return NextResponse.json(
      { error: "Too many active holds" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // Rate limit: max 3 active holds per IP per storefront
  const ipCount = await prisma.bookingHold.count({
    where: {
      storefrontId: storefront.id,
      holderIp: clientIp,
      expiresAt: { gt: now },
    },
  });
  if (ipCount >= 3) {
    return NextResponse.json(
      { error: "Too many active holds from this client" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const slotStartDate = new Date(slotStart);
  const slotEndDate = new Date(slotEnd);

  // Check for conflicting holds on the same provider + slot
  if (providerId) {
    const conflict = await prisma.bookingHold.findFirst({
      where: {
        storefrontId: storefront.id,
        providerId,
        expiresAt: { gt: now },
        slotStart: { lt: slotEndDate },
        slotEnd: { gt: slotStartDate },
      },
    });
    if (conflict) {
      return NextResponse.json(
        { error: "Slot is already held" },
        { status: 409 }
      );
    }
  }

  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  const hold = await prisma.bookingHold.create({
    data: {
      storefrontId: storefront.id,
      itemId,
      providerId: providerId ?? null,
      slotStart: slotStartDate,
      slotEnd: slotEndDate,
      holderToken: crypto.randomUUID(),
      holderIp: clientIp,
      expiresAt,
    },
    select: { holderToken: true, expiresAt: true },
  });

  return NextResponse.json(hold, { status: 201 });
}
