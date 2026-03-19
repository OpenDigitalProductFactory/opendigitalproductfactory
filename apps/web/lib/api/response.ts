// apps/web/lib/api/response.ts
//
// Standardised API success response builder.

import { NextResponse } from "next/server";

/**
 * Create a JSON success response.
 *
 * Usage:
 *   return apiSuccess({ id: "123", name: "My Epic" });
 *   return apiSuccess({ id: "123" }, 201);
 */
export function apiSuccess<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}
