// POST /api/v1/finance/dunning/run — trigger dunning run for overdue invoices
// Callable by cron. Returns { remindersSent }.

import { NextResponse } from "next/server";
import { runDunning } from "@/lib/actions/dunning";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);

    const result = await runDunning();

    return apiSuccess(result);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
