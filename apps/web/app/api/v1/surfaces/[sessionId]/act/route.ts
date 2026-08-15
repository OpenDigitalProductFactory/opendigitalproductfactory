import { NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { authorizedSurfaceRuntime } from "@/lib/coworker/authorized-surface-registry";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const [{ user }, { sessionId }, body] = await Promise.all([
      authenticateRequest(request),
      params,
      request.json() as Promise<Record<string, unknown>>,
    ]);
    const result = await authorizedSurfaceRuntime.act({
      sessionId,
      caller: { delegatingUserId: user.id, actingAgentId: `mobile-renderer:${user.id}` },
      actionId: typeof body.actionId === "string" ? body.actionId : "",
      expectedRevision: typeof body.expectedRevision === "string" ? body.expectedRevision : "",
      args: body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? body.args as Record<string, unknown>
        : {},
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
    });
    if (!result.ok) {
      const status = result.code === "surface_revision_stale" ? 409
        : result.code === "surface_action_not_authorized" || result.code === "surface_not_authorized" ? 403
          : 400;
      return NextResponse.json(result, { status });
    }
    return apiSuccess(result);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "Unable to act on authorized surface" }, { status: 500 });
  }
}
