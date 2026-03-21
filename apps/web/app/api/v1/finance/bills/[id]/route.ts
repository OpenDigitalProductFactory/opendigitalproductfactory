// GET /api/v1/finance/bills/[id] — fetch a single bill
// PATCH /api/v1/finance/bills/[id] — update a bill

import { NextResponse } from "next/server";
import { updateBillSchema } from "@/lib/ap-validation";
import { getBill } from "@/lib/actions/ap";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    await authenticateRequest(request);

    const { id } = await params;
    const bill = await getBill(id);
    if (!bill) {
      return NextResponse.json({ code: "NOT_FOUND", message: "Bill not found" }, { status: 404 });
    }

    return apiSuccess(bill);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await authenticateRequest(request);

    const { id } = await params;
    const body = await request.json();
    const parsed = updateBillSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const bill = await prisma.bill.update({
      where: { id },
      data: parsed.data,
    });

    return apiSuccess(bill);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
