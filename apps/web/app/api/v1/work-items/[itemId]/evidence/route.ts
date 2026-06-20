// POST /api/v1/work-items/:itemId/evidence — append a completion photo to the
// work item the caller is assigned to. Stored on WorkItem.evidence as JSON
// (additive — no schema migration). The endpoint validates the wire shape
// via lib/api/work-item-evidence and persists the merged record back in one
// update. See docs/superpowers/plans/2026-06-18-ios-app-end-to-end-support.md
// (Slice 3) and apps/web/lib/api/work-item-evidence.ts.

import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import {
  appendPhoto,
  normalizeEvidence,
  normalizePhoto,
} from "@/lib/api/work-item-evidence";
import type {
  AppendJobEvidenceRequest,
  JobEvidenceResponse,
} from "@dpf/types";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const { user } = await authenticateRequest(request);
    const { itemId } = await params;

    const body = (await request.json().catch(() => ({}))) as
      | Partial<AppendJobEvidenceRequest>
      | null;
    const photo = normalizePhoto(body?.photo);
    if (!photo) {
      throw apiError(
        "VALIDATION_ERROR",
        "Body must be { photo: { fileId, url, capturedAt, caption? } } with valid ISO capturedAt",
        422,
      );
    }

    const row = await prisma.workItem.findUnique({
      where: { itemId },
      select: { id: true, assignedToUserId: true, evidence: true },
    });
    if (!row) {
      throw apiError("NOT_FOUND", "Work item not found", 404);
    }
    if (row.assignedToUserId !== user.id) {
      throw apiError("FORBIDDEN", "Work item is not assigned to you", 403);
    }

    const next = appendPhoto(normalizeEvidence(row.evidence), photo);

    await prisma.workItem.update({
      where: { itemId },
      data: { evidence: next as unknown as Prisma.InputJsonValue },
    });

    return apiSuccess<JobEvidenceResponse>({ evidence: next }, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
