// Storefront admin: rentable-unit collection (equipment / self-storage fleet).
//   GET  /api/storefront/admin/units  -> units grouped by rental class, with photos
//   POST /api/storefront/admin/units  -> create a unit under a rental class
// Equipment photos attach via /api/media (ownerType=RentableUnit, role=equipment).

import * as crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { listOwnerMedia } from "@/lib/media";

export const runtime = "nodejs";

function isAdmin(session: { user?: unknown } | null): boolean {
  return Boolean(session?.user && (session.user as { type?: string }).type === "admin");
}

export async function GET() {
  const session = await auth();
  if (!isAdmin(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (!config) return NextResponse.json({ error: "No storefront configured" }, { status: 404 });

  // Rental classes (the rate-card StorefrontItems) and their stocked units.
  const classes = await prisma.storefrontItem.findMany({
    where: { storefrontId: config.id, ctaType: "rental", isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  const units = await prisma.rentableUnit.findMany({
    where: { storefrontId: config.id },
    orderBy: [{ storefrontItemId: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      unitId: true,
      storefrontItemId: true,
      label: true,
      unitRef: true,
      status: true,
      meterReading: true,
    },
  });

  const withMedia = await Promise.all(
    units.map(async (u) => ({
      ...u,
      meterReading: u.meterReading?.toString() ?? null,
      media: await listOwnerMedia("RentableUnit", u.id, "equipment"),
    })),
  );

  return NextResponse.json({ classes, units: withMedia });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (!config) return NextResponse.json({ error: "No storefront configured" }, { status: 404 });

  const body = (await req.json()) as {
    storefrontItemId?: string;
    label?: string;
    unitRef?: string | null;
  };
  if (!body.storefrontItemId || !body.label?.trim()) {
    return NextResponse.json({ error: "storefrontItemId and label are required" }, { status: 400 });
  }

  const item = await prisma.storefrontItem.findFirst({
    where: { id: body.storefrontItemId, storefrontId: config.id },
    select: { id: true },
  });
  if (!item) return NextResponse.json({ error: "Rental class not found" }, { status: 404 });

  const unit = await prisma.rentableUnit.create({
    data: {
      unitId: `RU-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      storefrontId: config.id,
      storefrontItemId: item.id,
      label: body.label.trim(),
      unitRef: body.unitRef?.trim() || null,
      status: "available",
    },
  });

  return NextResponse.json(
    { ...unit, meterReading: unit.meterReading?.toString() ?? null, media: [] },
    { status: 201 },
  );
}
