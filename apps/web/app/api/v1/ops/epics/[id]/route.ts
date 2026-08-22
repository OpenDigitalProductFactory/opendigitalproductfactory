// PATCH /api/v1/ops/epics/:id — update an epic

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { updateEpicSchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { completeEpicTransition } from "@/lib/backlog/initiative-readiness/epic-terminal-transition";
import { terminalTransitionConflict } from "@/lib/backlog/initiative-readiness/terminal-transition-response";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await authenticateRequest(request);

    const { id } = await params;

    const body = await request.json();
    const parsed = updateEpicSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const existing = await prisma.epic.findUnique({
      where: { id },
      select: {
        id: true,
        epicId: true,
        status: true,
        originatingBacklogItem: { select: { organizationId: true } },
      },
    });
    if (!existing) {
      throw apiError("NOT_FOUND", "Epic not found", 404);
    }

    const {
      title,
      description,
      status,
      scopeKind,
      archetypeCategories,
      archetypeIds,
      scopeRationale,
      lifecycleTags,
    } = parsed.data;

    const isNowDone = status === "done";
    const wasDone = existing.status === "done";

    const updateData = {
      ...(title !== undefined && { title: title.trim() }),
      ...(description !== undefined && { description: description.trim() || null }),
      ...(status !== undefined && { status }),
      ...(scopeKind !== undefined && { scopeKind }),
      ...(archetypeCategories !== undefined && { archetypeCategories }),
      ...(archetypeIds !== undefined && { archetypeIds }),
      ...(scopeRationale !== undefined && { scopeRationale: scopeRationale?.trim() || null }),
      ...(lifecycleTags !== undefined && { lifecycleTags }),
      ...(!isNowDone && wasDone ? { completedAt: null } : {}),
    };

    if (isNowDone && !wasDone) {
      const organizationId = existing.originatingBacklogItem?.organizationId ?? null;
      const terminal = await completeEpicTransition({
        epicId: existing.epicId,
        expectedStatus: existing.status,
        additionalData: updateData,
        actor: {
          actorType: "human",
          actorRef: user.id,
          humanContextRef: user.id,
          agentContextRef: null,
        },
        authority: {
          organizationId,
          actionKey: "update_epic",
          objectRef: existing.epicId,
          rationale: { capability: "manage_backlog", source: "ops-api" },
          authoritySnapshot: {
            decision: "allow",
            effectiveHumanCapability: "manage_backlog",
            effectiveAgentGrant: "human-session",
            tokenScope: "organization",
            organizationId: organizationId ?? "platform",
            actionKey: "update_epic",
            policyVersion: "coworker-authority.v1",
          },
        },
      });
      if (!terminal.ok) {
        return terminalTransitionConflict(terminal);
      }
      const epic = await prisma.epic.findUnique({ where: { id } });
      return apiSuccess(epic);
    }

    const epic = await prisma.epic.update({ where: { id }, data: updateData });

    return apiSuccess(epic);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
