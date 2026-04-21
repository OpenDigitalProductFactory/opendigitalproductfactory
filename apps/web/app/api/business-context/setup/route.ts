import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    description,
    targetMarket,
    companySize,
    geographicScope,
    revenueModel,
    contactEmail,
    contactPhone,
  } = (await req.json()) as {
    description?: string;
    targetMarket?: string;
    companySize?: string;
    geographicScope?: string;
    revenueModel?: string;
    contactEmail?: string;
    contactPhone?: string;
  };

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return NextResponse.json(
      { error: "Organization not found. Complete account setup first." },
      { status: 400 },
    );
  }

  // industry is derived from archetype.category; set only by /api/storefront/admin/setup
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      ...(contactEmail !== undefined && { email: contactEmail }),
      ...(contactPhone !== undefined && { phone: contactPhone }),
    },
  });

  // Upsert BusinessContext — the canonical source of truth for business strategy
  const businessContext = await prisma.businessContext.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      description: description ?? null,
      targetMarket: targetMarket ?? null,
      companySize: companySize ?? null,
      geographicScope: geographicScope ?? null,
      revenueModel: revenueModel ?? null,
      customerSegments: [],
    },
    update: {
      ...(description !== undefined && { description }),
      ...(targetMarket !== undefined && { targetMarket }),
      ...(companySize !== undefined && { companySize }),
      ...(geographicScope !== undefined && { geographicScope }),
      ...(revenueModel !== undefined && { revenueModel }),
    },
  });

  return NextResponse.json({ success: true, id: businessContext.id });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await prisma.organization.findFirst({
    select: { id: true, email: true, phone: true },
  });
  if (!org) {
    return NextResponse.json({ businessContext: null });
  }

  const bc = await prisma.businessContext.findUnique({
    where: { organizationId: org.id },
  });

  return NextResponse.json({
    businessContext: bc,
    contactEmail: org.email,
    contactPhone: org.phone,
  });
}
