// GET /api/v1/dynamic/views — list dynamic views (not yet implemented).
//
// Returns 404 NOT_IMPLEMENTED to match the sibling view-data route. A 200 +
// empty list would be indistinguishable from a genuinely empty result and
// would hide the fact that dynamic views are unbuilt.

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    return NextResponse.json(
      { code: "NOT_IMPLEMENTED", message: "Dynamic views not yet available" },
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
