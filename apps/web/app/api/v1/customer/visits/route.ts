// GET /api/v1/customer/visits — the signed-in customer's appointments / visits.
//
// Customer-scoped view of StorefrontBooking: returns rows whose
// customerContact belongs to the signed-in customer's CustomerAccount
// (resolved via the contact -> account chain). The portal-side booking list
// at /api/storefront/bookings is workforce-scoped and unchanged; this is the
// customer half of the generic mobile app's "My visits" surface.

import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@dpf/db";
import { requireCustomerAuth } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";
import type { CustomerVisit, CustomerVisitStatus } from "@dpf/types";

export const dynamic = "force-dynamic";

const VISIT_STATUSES = new Set<CustomerVisitStatus>([
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);

function projectStatus(raw: string): CustomerVisitStatus {
  return VISIT_STATUSES.has(raw as CustomerVisitStatus)
    ? (raw as CustomerVisitStatus)
    : "pending";
}

interface BookingRow {
  id: string;
  bookingRef: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: string;
  notes: string | null;
  cancellationReason: string | null;
  createdAt: Date;
  itemId: string;
  provider: { name: string } | null;
}

function project(row: BookingRow): CustomerVisit {
  return {
    id: row.id,
    bookingRef: row.bookingRef,
    scheduledAt: row.scheduledAt.toISOString(),
    durationMinutes: row.durationMinutes,
    status: projectStatus(row.status),
    itemName: row.itemId,
    providerName: row.provider?.name ?? null,
    notes: row.notes,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const { user } = await requireCustomerAuth(request);

    if (!user.accountId) {
      return apiSuccess(buildPaginatedResponse<CustomerVisit>([], 25));
    }

    // Resolve the customer's contact IDs once — the booking has only
    // customerContactId (no Prisma @relation), so we filter by that set.
    const contacts = await prisma.customerContact.findMany({
      where: { account: { is: { accountId: user.accountId } } },
      select: { id: true },
    });
    if (contacts.length === 0) {
      return apiSuccess(buildPaginatedResponse<CustomerVisit>([], 25));
    }
    const contactIds = contacts.map((c) => c.id);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const statusFilter = url.searchParams.get("status");
    const upcomingOnly = url.searchParams.get("upcoming") === "true";

    const where: Prisma.StorefrontBookingWhereInput = {
      customerContactId: { in: contactIds },
    };
    if (cursor) {
      where.id = { lt: cursor };
    }
    if (statusFilter) {
      where.status = statusFilter;
    }
    if (upcomingOnly) {
      where.scheduledAt = { gte: new Date() };
    }

    const rows = await prisma.storefrontBooking.findMany({
      where,
      orderBy: { scheduledAt: "desc" },
      take: limit + 1,
      select: {
        id: true,
        bookingRef: true,
        scheduledAt: true,
        durationMinutes: true,
        status: true,
        notes: true,
        cancellationReason: true,
        createdAt: true,
        itemId: true,
        provider: { select: { name: true } },
      },
    });

    return apiSuccess(buildPaginatedResponse(rows.map(project), limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
