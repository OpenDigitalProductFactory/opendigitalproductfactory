// POST /api/v1/upload — upload a file.
// Images are now stored for real as content-addressed MediaAssets (see
// docs/superpowers/specs/2026-06-12-media-asset-management-design.md); PDFs still
// return a placeholder pending the document-ingest path. Response shape
// ({ fileId, url }) is unchanged for backward compatibility.

import * as crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { ALLOWED_IMAGE_MIME_TYPES, createMediaAsset, mediaAssetUrl } from "@/lib/media";

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

    // Images: store for real as a content-addressed MediaAsset.
    if (ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
      const org = await prisma.organization.findFirst({ select: { id: true } });
      if (!org) {
        return NextResponse.json(
          { code: "CONFLICT", message: "No organization configured" },
          { status: 409 },
        );
      }
      const content = Buffer.from(await file.arrayBuffer());
      const created = await createMediaAsset({
        organizationId: org.id,
        content,
        declaredMimeType: file.type,
        originalName: file.name || null,
      });
      if (!created.ok) {
        return NextResponse.json({ code: "VALIDATION_ERROR", message: created.error }, { status: 422 });
      }
      return apiSuccess({ fileId: created.assetId, url: mediaAssetUrl(created.assetId) }, 201);
    }

    // Non-image (e.g. PDF): placeholder pending the document-ingest path.
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
