import { NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { authorizedSurfaceRuntime } from "@/lib/coworker/authorized-surface-registry";

export const dynamic = "force-dynamic";

function caller(userId: string) {
  return { delegatingUserId: userId, actingAgentId: `mobile-renderer:${userId}` };
}

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const [{ user }, { sessionId }] = await Promise.all([authenticateRequest(request), params]);
    const sinceRevision = new URL(request.url).searchParams.get("sinceRevision") ?? undefined;
    const snapshot = await authorizedSurfaceRuntime.snapshot({ sessionId, caller: caller(user.id), sinceRevision });
    if (!snapshot.ok) return NextResponse.json(snapshot, { status: snapshot.code === "surface_not_authorized" ? 403 : 404 });
    return apiSuccess(snapshot);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "Unable to read authorized surface" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const [{ user }, { sessionId }] = await Promise.all([authenticateRequest(request), params]);
    const closed = await authorizedSurfaceRuntime.close(sessionId, caller(user.id));
    return closed
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ code: "surface_not_authorized", message: "Session unavailable" }, { status: 404 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "Unable to close authorized surface" }, { status: 500 });
  }
}
