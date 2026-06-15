import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { reason?: string };
  const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;

  const booking = await prisma.storefrontBooking.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  await prisma.storefrontBooking.update({
    where: { id },
    data: {
      status: "cancelled",
      cancellationReason: reason ?? null,
      cancelledAt: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}
