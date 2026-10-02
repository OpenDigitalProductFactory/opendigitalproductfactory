// @exposure authenticated
// GET /api/map-assets/runtime/:file — the two MapLibre runtime modules its
// worker needs, served first-party from the pinned package (BI-814F86E1).

import { auth } from "@/lib/auth";
import { handleMapRuntimeRequest } from "@/lib/twin/map-assets.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ file: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const [{ file }, session] = await Promise.all([context.params, auth()]);
  return handleMapRuntimeRequest({ authenticated: Boolean(session?.user) }, file);
}
