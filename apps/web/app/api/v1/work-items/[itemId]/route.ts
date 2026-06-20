// GET   /api/v1/work-items/:itemId — job detail (must be assigned to caller).
// PATCH /api/v1/work-items/:itemId — field check-in/out status transition.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import {
  toWorkItemDetail,
  isWorkItemStatus,
  isValidWorkItemTransition,
  statusUpdateData,
} from "@/lib/api/work-items";
import { resolveWorkItemAccount } from "@/lib/api/work-item-account-resolution";

const DETAIL_SELECT = {
  id: true,
  itemId: true,
  title: true,
  status: true,
  urgency: true,
  effortClass: true,
  dueAt: true,
  queueId: true,
  teamId: true,
  createdAt: true,
  description: true,
  sourceType: true,
  sourceId: true,
  assignedToUserId: true,
  claimedAt: true,
  completedAt: true,
} as const;

async function loadAssigned(itemId: string, userId: string) {
  const row = await prisma.workItem.findUnique({
    where: { itemId },
    select: DETAIL_SELECT,
  });
  if (!row) throw apiError("NOT_FOUND", "Work item not found", 404);
  if (row.assignedToUserId !== userId) {
    throw apiError("FORBIDDEN", "Work item is not assigned to you", 403);
  }
  return row;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const { user } = await authenticateRequest(request);
    const { itemId } = await params;
    const row = await loadAssigned(itemId, user.id);
    const account = await resolveWorkItemAccount({
      sourceType: row.sourceType,
      sourceId: row.sourceId,
    });
    return apiSuccess(toWorkItemDetail(row, account));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const { user } = await authenticateRequest(request);
    const { itemId } = await params;

    const body = (await request.json().catch(() => ({}))) as {
      status?: unknown;
    };
    if (!isWorkItemStatus(body.status)) {
      throw apiError("VALIDATION_ERROR", "Body must be { status }", 422);
    }
    const to = body.status;

    const row = await loadAssigned(itemId, user.id);
    const from = isWorkItemStatus(row.status) ? row.status : "queued";
    if (!isValidWorkItemTransition(from, to)) {
      throw apiError(
        "INVALID_TRANSITION",
        `Cannot move work item from ${from} to ${to}`,
        409,
      );
    }

    const updated = await prisma.workItem.update({
      where: { itemId },
      data: statusUpdateData(to, new Date()),
      select: DETAIL_SELECT,
    });
    const account = await resolveWorkItemAccount({
      sourceType: updated.sourceType,
      sourceId: updated.sourceId,
    });

    return apiSuccess(toWorkItemDetail(updated, account));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
