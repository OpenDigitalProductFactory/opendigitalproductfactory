// GET /api/ops/self-upgrade/impact-summary
//
// Read-only endpoint for the operator-facing "What's in this update?" panel.
// This intentionally uses GET instead of a Server Action so the advisory
// summary stays available while the quiescence proxy refuses mutation POSTs.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { summarizeUpgradeImpact } from "@/lib/self-upgrade/impact";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  const user = session?.user;

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_operations",
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "true";
  const result = await summarizeUpgradeImpact({ refresh });

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
