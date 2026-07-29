import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { canTransitionOrder, isOrderStatus } from "@/lib/storefront/order-lifecycle";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { status?: unknown };
  if (!isOrderStatus(body.status)) {
    return NextResponse.json({ error: "A valid target status is required" }, { status: 400 });
  }

  const order = await prisma.storefrontOrder.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (!canTransitionOrder(order.status, body.status)) {
    return NextResponse.json(
      { error: `An order that is ${order.status} cannot become ${body.status}` },
      { status: 409 },
    );
  }

  await prisma.storefrontOrder.update({
    where: { id },
    data: { status: body.status },
  });

  return NextResponse.json({ success: true, status: body.status });
}
