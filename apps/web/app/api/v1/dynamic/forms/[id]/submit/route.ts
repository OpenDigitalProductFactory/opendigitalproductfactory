// POST /api/v1/dynamic/forms/:id/submit — submit a dynamic form (stub — not yet implemented)

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";

export async function POST(
  request: Request,
  { params: _params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    return NextResponse.json(
      { code: "NOT_IMPLEMENTED", message: "Dynamic forms not yet available" },
      { status: 404 },
    );
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
