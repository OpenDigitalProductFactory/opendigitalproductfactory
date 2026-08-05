// GET /api/platform/workforce-activity — live workforce activity snapshot for
// the "Right Now" view (BI-1A68257F). The page server-renders one snapshot; the
// client shell re-fetches this on a short interval. Auth mirrors the
// (shell)/platform layout gate: view_platform or 404.
//
// Data-governance note: this payload is intentionally aggregate — per-coworker
// outcome COUNTS and a sensitive-data flag, never the underlying records — so a
// platform administrator who is not in HR/finance can see the shape of activity
// without the sensitive detail.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { apiErrorResponse } from "@/lib/api/error";
import { loadWorkforceActivity } from "@/lib/platform-runtime/workforce-activity";

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
    return apiErrorResponse("NOT_FOUND", "Not found", 404);
  }

  const data = await loadWorkforceActivity();
  return NextResponse.json(data, { headers: NO_CACHE_HEADERS });
}
