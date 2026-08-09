import { NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { authorizedSurfaceRuntime } from "@/lib/coworker/authorized-surface-registry";
import { createMobileSurfaceContext } from "@/lib/coworker/mobile-authorized-surface";

export const dynamic = "force-dynamic";

function userContext(user: { id: string; platformRole: string | null; isSuperuser: boolean }) {
  return { userId: user.id, platformRole: user.platformRole, isSuperuser: user.isSuperuser };
}
export async function GET(request: Request) {
  try {
    const { user } = await authenticateRequest(request);
    const url = new URL(request.url);
    const context = createMobileSurfaceContext({
      userId: user.id,
      userContext: userContext(user),
      selector: {
        taskIntent: url.searchParams.get("taskIntent") ?? undefined,
        workroomType: url.searchParams.get("workroomType") ?? undefined,
        resourceType: url.searchParams.get("resourceType") ?? undefined,
      },
    });
    return apiSuccess({ surfaces: await authorizedSurfaceRuntime.list(context) });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "Unable to list authorized surfaces" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await authenticateRequest(request);
    const body = await request.json() as Record<string, unknown>;
    const selector = {
      surfaceId: typeof body.surfaceId === "string" ? body.surfaceId : undefined,
      route: typeof body.route === "string" ? body.route : undefined,
      taskIntent: typeof body.taskIntent === "string" ? body.taskIntent : undefined,
      workroomType: typeof body.workroomType === "string" ? body.workroomType : undefined,
      resourceType: typeof body.resourceType === "string" ? body.resourceType : undefined,
      mobileViewId: typeof body.mobileViewId === "string" ? body.mobileViewId : undefined,
    };
    const context = createMobileSurfaceContext({
      userId: user.id,
      userContext: userContext(user),
      selector,
    });
    const opened = await authorizedSurfaceRuntime.open({ context, selector });
    if (!opened.ok) return NextResponse.json(opened, { status: opened.code === "surface_not_authorized" ? 403 : 404 });
    return apiSuccess(opened);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "Unable to open authorized surface" }, { status: 500 });
  }
}
