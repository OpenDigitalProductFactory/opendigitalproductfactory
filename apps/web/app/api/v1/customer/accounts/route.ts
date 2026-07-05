// GET /api/v1/customer/accounts — paginated list of customer accounts

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { CUSTOMER_TOMBSTONE_STATUSES } from "@dpf/db/customer-lifecycle";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const search = url.searchParams.get("search");

    const status = url.searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (cursor) {
      where.id = { lt: cursor };
    }
    if (status) {
      where.status = status;
    } else {
      // Default reads exclude merge tombstones (superseded rows).
      where.status = { notIn: [...CUSTOMER_TOMBSTONE_STATUSES] };
    }
    if (search) {
      // Use full-text search if available, fall back to ILIKE
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { contacts: { some: { email: { contains: search, mode: "insensitive" } } } },
        { contacts: { some: { firstName: { contains: search, mode: "insensitive" } } } },
        { contacts: { some: { lastName: { contains: search, mode: "insensitive" } } } },
      ];
    }

    const accounts = await prisma.customerAccount.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: { contacts: true },
    });

    return apiSuccess(buildPaginatedResponse(accounts, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
