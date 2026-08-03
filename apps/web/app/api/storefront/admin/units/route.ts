// Storefront admin: rentable-unit collection (equipment / self-storage fleet).
//   GET  /api/storefront/admin/units  -> units grouped by rental class, with photos
//   POST /api/storefront/admin/units  -> create a unit under a rental class
// Equipment photos attach via /api/media (ownerType=RentableUnit, role=equipment).

import * as crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma, type Prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { listOwnerMedia } from "@/lib/media";
import {
  parseRentalPhysicalProfile,
  serializeRentalPhysicalProfile,
  readRentalPoolCapacity,
  serializeRentalPoolCapacity,
} from "@/lib/storefront/rental-physical-profile";
import { resolveRentalStorefront } from "@/lib/storefront/rental-scope.server";
import { apiErrorResponse } from "@/lib/api/error";

export const runtime = "nodejs";

function isAdmin(session: { user?: unknown } | null): boolean {
  return Boolean(session?.user && (session.user as { type?: string }).type === "admin");
}

export async function GET() {
  const session = await auth();
  if (!isAdmin(session)) return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);

  const config = await resolveRentalStorefront();
  if (!config) return apiErrorResponse("NOT_FOUND", "No storefront configured", 404);

  // Rental classes (the rate-card StorefrontItems) and their stocked units.
  const classes = await prisma.storefrontItem.findMany({
    where: { storefrontId: config.id, ctaType: "rental", isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, bookingConfig: true },
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
      attributes: true,
    },
  });

  const withMedia = await Promise.all(
    units.map(async (u) => ({
      ...u,
      meterReading: u.meterReading?.toString() ?? null,
      physicalProfile: parseRentalPhysicalProfile(u.attributes),
      media: await listOwnerMedia("RentableUnit", u.id, "equipment"),
    })),
  );

  return NextResponse.json({
    classes: classes.map((item) => ({
      id: item.id,
      name: item.name,
      poolCapacity: readRentalPoolCapacity(item.bookingConfig),
    })),
    units: withMedia,
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session)) return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  const config = await resolveRentalStorefront();
  if (!config) return apiErrorResponse("NOT_FOUND", "No storefront configured", 404);
  const body = (await req.json()) as { storefrontItemId?: string; poolCapacity?: number };
  if (!body.storefrontItemId || typeof body.poolCapacity !== "number") {
    return apiErrorResponse("INVALID_INPUT", "storefrontItemId and poolCapacity are required", 400);
  }
  const item = await prisma.storefrontItem.findFirst({
    where: { id: body.storefrontItemId, storefrontId: config.id, ctaType: "rental" },
    select: { id: true, bookingConfig: true },
  });
  if (!item) return apiErrorResponse("NOT_FOUND", "Rental class not found", 404);
  const bookingConfig = serializeRentalPoolCapacity(item.bookingConfig, body.poolCapacity);
  await prisma.storefrontItem.update({
    where: { id: item.id },
    data: { bookingConfig: bookingConfig as Prisma.InputJsonValue },
  });
  return NextResponse.json({
    id: item.id,
    poolCapacity: readRentalPoolCapacity(bookingConfig),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdmin(session)) return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);

  const config = await resolveRentalStorefront();
  if (!config) return apiErrorResponse("NOT_FOUND", "No storefront configured", 404);

  const body = (await req.json()) as {
    storefrontItemId?: string;
    label?: string;
    unitRef?: string | null;
    physicalProfile?: unknown;
  };
  if (!body.storefrontItemId || !body.label?.trim()) {
    return apiErrorResponse("INVALID_INPUT", "storefrontItemId and label are required", 400);
  }

  const item = await prisma.storefrontItem.findFirst({
    where: { id: body.storefrontItemId, storefrontId: config.id },
    select: { id: true },
  });
  if (!item) return apiErrorResponse("NOT_FOUND", "Rental class not found", 404);

  const unit = await prisma.rentableUnit.create({
    data: {
      unitId: `RU-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      storefrontId: config.id,
      storefrontItemId: item.id,
      label: body.label.trim(),
      unitRef: body.unitRef?.trim() || null,
      status: "available",
      attributes: serializeRentalPhysicalProfile(
        null,
        parseRentalPhysicalProfile({ rentalPhysical: body.physicalProfile }),
      ) as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json(
    {
      ...unit,
      meterReading: unit.meterReading?.toString() ?? null,
      physicalProfile: parseRentalPhysicalProfile(unit.attributes),
      media: [],
    },
    { status: 201 },
  );
}
