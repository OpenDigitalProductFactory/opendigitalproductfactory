import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const body = (await req.json()) as {
    name?: string;
    email?: string;
    phone?: string;
    isActive?: boolean;
    priority?: number;
    weight?: number;
    // Service assignment: full replacement list of item IDs
    serviceItemIds?: string[];
    // Availability: replace all regular (non-exception) rows
    availability?: Array<{
      days: number[];
      startTime: string;
      endTime: string;
    }>;
    // Exceptions: replace all exception rows
    exceptions?: Array<{
      date: string; // ISO date string
      isBlocked: boolean;
      startTime?: string;
      endTime?: string;
      reason?: string;
    }>;
  };

  const provider = await prisma.serviceProvider.findUnique({ where: { id } });
  if (!provider) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Update scalar fields
  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.email !== undefined) updateData.email = body.email;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.priority !== undefined) updateData.priority = body.priority;
  if (body.weight !== undefined) updateData.weight = body.weight;

  if (Object.keys(updateData).length > 0) {
    await prisma.serviceProvider.update({ where: { id }, data: updateData });
  }

  // Replace service assignments
  if (body.serviceItemIds !== undefined) {
    await prisma.providerService.deleteMany({ where: { providerId: id } });
    if (body.serviceItemIds.length > 0) {
      await prisma.providerService.createMany({
        data: body.serviceItemIds.map((itemId) => ({ providerId: id, itemId })),
        skipDuplicates: true,
      });
    }
  }

  // Replace regular availability rows (non-exception)
  if (body.availability !== undefined) {
    await prisma.providerAvailability.deleteMany({
      where: { providerId: id, date: null },
    });
    if (body.availability.length > 0) {
      await prisma.providerAvailability.createMany({
        data: body.availability.map((a) => ({
          providerId: id,
          days: a.days,
          startTime: a.startTime,
          endTime: a.endTime,
          isBlocked: false,
        })),
      });
    }
  }

  // Replace exception rows
  if (body.exceptions !== undefined) {
    await prisma.providerAvailability.deleteMany({
      where: { providerId: id, NOT: { date: null } },
    });
    if (body.exceptions.length > 0) {
      await prisma.providerAvailability.createMany({
        data: body.exceptions.map((e) => ({
          providerId: id,
          days: [],
          date: new Date(e.date),
          isBlocked: e.isBlocked,
          startTime: e.startTime ?? "00:00",
          endTime: e.endTime ?? "23:59",
          reason: e.reason ?? null,
        })),
      });
    }
  }

  const updated = await prisma.serviceProvider.findUnique({
    where: { id },
    include: {
      services: { include: { item: { select: { id: true, name: true, ctaType: true } } } },
      availability: { orderBy: { createdAt: "asc" } },
    },
  });

  return NextResponse.json({ provider: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const provider = await prisma.serviceProvider.findUnique({ where: { id } });
  if (!provider) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Cascade deletes ProviderService and ProviderAvailability via DB relations
  await prisma.serviceProvider.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
