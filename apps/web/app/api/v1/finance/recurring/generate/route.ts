// POST /api/v1/finance/recurring/generate — trigger generation of due recurring invoices
// Callable by cron. Returns { generated, sent }.

import { NextResponse } from "next/server";
import { generateDueInvoices } from "@/lib/actions/recurring";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);

    const result = await generateDueInvoices();

    return apiSuccess(result);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
