// Storefront admin: rentable-unit item.
//   PUT    /api/storefront/admin/units/:id  -> update label / unitRef / status
//   DELETE /api/storefront/admin/units/:id  -> delete (blocked if it has agreements)

import { NextResponse, type NextRequest } from "next/server";
import { prisma, type Prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { deleteMediaForOwner } from "@/lib/media";
import {
  parseRentalPhysicalProfile,
  serializeRentalPhysicalProfile,
} from "@/lib/storefront/rental-physical-profile";
import { resolveRentalStorefront } from "@/lib/storefront/rental-scope.server";
import { apiErrorResponse } from "@/lib/api/error";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function isAdmin(session: { user?: unknown } | null): boolean {
  return Boolean(session?.user && (session.user as { type?: string }).type === "admin");
}

const UNIT_STATUSES = new Set([
  "available",
  "reserved",
  "out",
  "returned",
  "maintenance",
  "retired",
]);

export async function PUT(req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!isAdmin(session)) return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);

  const { id } = await context.params;
  const config = await resolveRentalStorefront();
  if (!config) return apiErrorResponse("NOT_FOUND", "No storefront configured", 404);
  const existing = await prisma.rentableUnit.findFirst({
    where: { id, storefrontId: config.id },
    select: { id: true, attributes: true },
  });
  if (!existing) return apiErrorResponse("NOT_FOUND", "Unit not found", 404);

  const body = (await req.json()) as {
    label?: string;
    unitRef?: string | null;
    status?: string;
    physicalProfile?: unknown;
  };
  const data: Record<string, unknown> = {};
  if (body.label != null) data.label = body.label.trim();
  if (body.unitRef !== undefined) data.unitRef = body.unitRef?.trim() || null;
  if (body.status != null) {
    if (!UNIT_STATUSES.has(body.status)) {
      return apiErrorResponse("INVALID_INPUT", `Invalid status '${body.status}'`, 400);
    }
    data.status = body.status;
  }
  if (body.physicalProfile !== undefined) {
    data.attributes = serializeRentalPhysicalProfile(
      existing.attributes,
      parseRentalPhysicalProfile({ rentalPhysical: body.physicalProfile }),
    ) as Prisma.InputJsonValue;
  }

  const unit = await prisma.rentableUnit.update({ where: { id }, data });
  return NextResponse.json({
    ...unit,
    meterReading: unit.meterReading?.toString() ?? null,
    physicalProfile: parseRentalPhysicalProfile(unit.attributes),
  });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!isAdmin(session)) return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);

  const { id } = await context.params;
  const config = await resolveRentalStorefront();
  if (!config) return apiErrorResponse("NOT_FOUND", "No storefront configured", 404);
  const existing = await prisma.rentableUnit.findFirst({
    where: { id, storefrontId: config.id },
    select: { id: true },
  });
  if (!existing) return apiErrorResponse("NOT_FOUND", "Unit not found", 404);

  // Don't orphan rental history — block deletion if the unit has agreements.
  const agreementCount = await prisma.rentalAgreement.count({ where: { rentableUnitId: id } });
  if (agreementCount > 0) {
    await prisma.rentableUnit.update({ where: { id }, data: { status: "retired" } });
    return NextResponse.json({
      success: true,
      retired: true,
      message: "Unit has rental history — retired instead of deleted.",
    });
  }

  await deleteMediaForOwner("RentableUnit", id);
  await prisma.rentableUnit.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
