import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { order } = (await req.json()) as { storefrontId: string; order: string[] };
  await Promise.all(
    order.map((id, i) => prisma.storefrontSection.update({ where: { id }, data: { sortOrder: i } }))
  );
  return NextResponse.json({ success: true });
}
