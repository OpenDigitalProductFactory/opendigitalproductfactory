// GET /api/v1/finance/payment-runs — list outbound payment runs
// POST /api/v1/finance/payment-runs — execute a new payment run

import { NextResponse } from "next/server";
import { createPaymentRunSchema } from "@/lib/ap-validation";
import { createPaymentRun, listPaymentRuns } from "@/lib/actions/ap";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const runs = await listPaymentRuns();

    return apiSuccess(runs);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);

    const body = await request.json();
    const parsed = createPaymentRunSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    await createPaymentRun(parsed.data);

    return apiSuccess({ message: "Payment run executed" }, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
