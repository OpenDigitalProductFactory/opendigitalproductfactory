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

    const {
      title,
      body: itemBody,
      status,
      priority,
      epicId,
      scopeKind,
      archetypeCategories,
      archetypeIds,
      scopeRationale,
      lifecycleTags,
    } = parsed.data;

    if (status === "deferred" || status === "retired") {
      throw apiError(
        "VALIDATION_ERROR",
        "Use the governed backlog lifecycle action for deferred or retired decisions.",
        422,
      );
    }

    const isNowDone = status === "done";
    const wasDone = existing.status === "done" || existing.status === "retired";

    const item = await prisma.backlogItem.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(itemBody !== undefined && { body: itemBody.trim() || null }),
        ...(status !== undefined && { status }),
        ...(priority !== undefined && { priority }),
        ...(epicId !== undefined && { epicId }),
        ...(scopeKind !== undefined && { scopeKind }),
        ...(archetypeCategories !== undefined && { archetypeCategories }),
        ...(archetypeIds !== undefined && { archetypeIds }),
        ...(scopeRationale !== undefined && { scopeRationale: scopeRationale?.trim() || null }),
        ...(lifecycleTags !== undefined && { lifecycleTags }),
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

    const { assertBacklogItemGovernanceDeletable } = await import("@/lib/backlog/initiative-governance-deletion");
    await assertBacklogItemGovernanceDeletable(id);
    await prisma.backlogItem.delete({ where: { id } });

    return apiSuccess({ deleted: true });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    if (e instanceof Error && "code" in e && e.code === "INITIATIVE_GOVERNANCE_RETENTION") {
      return NextResponse.json(
        { code: "INITIATIVE_GOVERNANCE_RETENTION", message: e.message },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
