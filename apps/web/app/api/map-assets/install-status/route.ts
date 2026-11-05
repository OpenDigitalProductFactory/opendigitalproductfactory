// @exposure authenticated
// GET /api/map-assets/install-status — the street-map install status projection
// the Street maps panel observes (BI-43BBCC26). Reads one stored status row; it
// never starts, retries or inspects an install.

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readInstallSnapshot } from "@/lib/twin/map-pack-install/status.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json(await readInstallSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
