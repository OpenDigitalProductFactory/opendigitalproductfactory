// PATCH /api/v1/ops/backlog/:id — update a backlog item
// DELETE /api/v1/ops/backlog/:id — delete a backlog item

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { updateBacklogItemSchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;

    const body = await request.json();
    const parsed = updateBacklogItemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const existing = await prisma.backlogItem.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw apiError("NOT_FOUND", "Backlog item not found", 404);
    }

    const { title, body: itemBody, status, priority, epicId } = parsed.data;

    const isNowDone = status === "done" || status === "deferred";
    const wasDone = existing.status === "done" || existing.status === "deferred";

    const item = await prisma.backlogItem.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(itemBody !== undefined && { body: itemBody.trim() || null }),
        ...(status !== undefined && { status }),
        ...(priority !== undefined && { priority }),
        ...(epicId !== undefined && { epicId }),
        ...(isNowDone && !wasDone ? { completedAt: new Date() } : {}),
        ...(!isNowDone && wasDone ? { completedAt: null } : {}),
      },
    });

    return apiSuccess(item);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;

    const existing = await prisma.backlogItem.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw apiError("NOT_FOUND", "Backlog item not found", 404);
    }

    await prisma.backlogItem.delete({ where: { id } });

    return apiSuccess({ deleted: true });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
