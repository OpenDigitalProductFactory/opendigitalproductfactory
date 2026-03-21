// POST /api/v1/upload — upload a file (validation only, storage TBD)

import * as crypto from "crypto";
import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "application/pdf",
]);

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Request must be multipart/form-data" },
        { status: 422 },
      );
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "A file field is required" },
        { status: 422 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { code: "FILE_TOO_LARGE", message: "File size exceeds 10 MB limit" },
        { status: 422 },
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        {
          code: "INVALID_FILE_TYPE",
          message: `File type '${file.type}' is not allowed. Accepted: ${[...ALLOWED_MIME_TYPES].join(", ")}`,
        },
        { status: 422 },
      );
    }

    const fileId = crypto.randomUUID();

    return apiSuccess({ fileId, url: `/uploads/${fileId}` }, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
