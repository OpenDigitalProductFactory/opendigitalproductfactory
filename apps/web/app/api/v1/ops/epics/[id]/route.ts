// PATCH /api/v1/ops/epics/:id — update an epic

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { updateEpicSchema } from "@dpf/validators";
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
    const parsed = updateEpicSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const existing = await prisma.epic.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing) {
      throw apiError("NOT_FOUND", "Epic not found", 404);
    }

    const { title, description, status } = parsed.data;

    const isNowDone = status === "done";
    const wasDone = existing.status === "done";

    const epic = await prisma.epic.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description: description.trim() || null }),
        ...(status !== undefined && { status }),
        ...(isNowDone && !wasDone ? { completedAt: new Date() } : {}),
        ...(!isNowDone && wasDone ? { completedAt: null } : {}),
      },
    });

    return apiSuccess(epic);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
