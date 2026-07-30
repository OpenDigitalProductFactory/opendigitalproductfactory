import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { transitionProductSoldByEvidence } from "@/lib/products/product-sold";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const booking = await prisma.storefrontBooking.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.storefrontBooking.update({
      where: { id },
      data: { status: "confirmed" },
    });
    await transitionProductSoldByEvidence({
      db: tx as never,
      kind: "storefront-booking",
      sourceId: id,
      to: "active",
      occurredAt: new Date(),
    });
  });

  // EP-3516E23D field-service dispatch: a confirmed, provider-assigned booking
  // becomes a job on the storefront's dispatch queue (with flow telemetry). The
  // bridge is idempotent and no-ops for unassigned bookings; best-effort so a
  // confirmation never fails because dispatch bridging did.
  try {
    const { bridgeBookingToWorkItem } = await import("@/lib/queue/bridges/booking-bridge");
    await bridgeBookingToWorkItem(id);
  } catch (err) {
    console.warn(
      `[field-dispatch] failed to bridge booking ${id} to a dispatch job: ${
        getErrorMessage(err)
      }`,
    );
  }

  return NextResponse.json({ success: true });
}
