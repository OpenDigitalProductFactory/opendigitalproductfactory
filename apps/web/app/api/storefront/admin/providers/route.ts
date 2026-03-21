import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { nanoid } from "nanoid";

export async function GET() {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (!config) return NextResponse.json({ providers: [] });

  const providers = await prisma.serviceProvider.findMany({
    where: { storefrontId: config.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      services: { include: { item: { select: { id: true, name: true, ctaType: true } } } },
      availability: { orderBy: { createdAt: "asc" } },
    },
  });

  return NextResponse.json({ providers });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { storefrontId, name, email, phone } = (await req.json()) as {
    storefrontId: string;
    name: string;
    email?: string;
    phone?: string;
  };

  if (!storefrontId || !name) {
    return NextResponse.json({ error: "storefrontId and name are required" }, { status: 400 });
  }

  const provider = await prisma.serviceProvider.create({
    data: {
      providerId: `SP-${nanoid(6).toUpperCase()}`,
      storefrontId,
      name,
      email: email ?? null,
      phone: phone ?? null,
      isActive: true,
    },
    include: {
      services: { include: { item: { select: { id: true, name: true, ctaType: true } } } },
      availability: true,
    },
  });

  return NextResponse.json({ provider }, { status: 201 });
}
