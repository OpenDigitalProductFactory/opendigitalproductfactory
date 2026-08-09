import { NextResponse } from "next/server";

import type { SurfaceJson } from "@dpf/types";

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
    const rawChanges = body.changes && typeof body.changes === "object" && !Array.isArray(body.changes)
      ? body.changes as Record<string, SurfaceJson>
      : {};
    const result = await authorizedSurfaceRuntime.syncClientState({
      sessionId,
      caller: { delegatingUserId: user.id, actingAgentId: `mobile-renderer:${user.id}` },
      expectedRevision: typeof body.expectedRevision === "string" ? body.expectedRevision : "",
      sequence: typeof body.sequence === "number" ? body.sequence : 0,
      changes: rawChanges,
    });
    if (!result.ok) {
      const status = result.code === "surface_revision_stale" ? 409
        : result.code === "surface_not_authorized" ? 403
          : 400;
      return NextResponse.json(result, { status });
    }
    return apiSuccess(result);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "Unable to synchronize authorized surface state" }, { status: 500 });
  }
}
