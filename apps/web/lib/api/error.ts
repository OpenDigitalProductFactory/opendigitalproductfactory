// apps/web/lib/api/error.ts
//
// Standardised API error handling.
//
// ApiError is throwable from middleware/helpers. Route handlers catch it and
// call toResponse(), or use apiErrorResponse() for direct returns.

import { NextResponse } from "next/server";

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

/**
 * A throwable API error that carries HTTP status and structured error info.
 *
 * Usage in middleware/helpers:
 *   throw apiError("NOT_FOUND", "Epic not found", 404);
 *
 * In route handler catch blocks:
 *   if (e instanceof ApiError) return e.toResponse();
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** Convert to a NextResponse JSON error. */
  toResponse(): NextResponse<ApiErrorBody> {
    const body: ApiErrorBody = { code: this.code, message: this.message };
    if (this.details !== undefined) {
      body.details = this.details;
    }
    return NextResponse.json(body, { status: this.status });
  }
}

/**
 * Create and return an ApiError (throwable).
 *
 * Shorthand for `new ApiError(...)` that reads more naturally:
 *   throw apiError("NOT_FOUND", "Epic not found", 404);
 */
export function apiError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): ApiError {
  return new ApiError(code, message, status, details);
}

/**
 * Create a NextResponse JSON error directly (for returning, not throwing).
 */
export function apiErrorResponse(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return new ApiError(code, message, status, details).toResponse();
}
