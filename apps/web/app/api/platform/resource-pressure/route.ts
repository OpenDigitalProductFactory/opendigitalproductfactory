// GET /api/platform/resource-pressure — live resource snapshot for the
// "Right Now" cockpit (BI-1A68257F / EP-FULL-OBS). The page server-renders one
// snapshot; the client shell re-fetches this on a short interval so the memory
// pressure / local-model bucket stay honest. Auth mirrors the (shell)/platform
// layout gate: view_platform or 404 (don't reveal the surface).

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadResourcePressure } from "@/lib/platform-runtime/resource-pressure";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
};

export async function GET() {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_platform",
    )
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = await loadResourcePressure();
  return NextResponse.json(data, { headers: NO_CACHE_HEADERS });
}
