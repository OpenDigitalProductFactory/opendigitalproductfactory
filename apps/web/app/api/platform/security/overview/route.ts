// EP-SOVEREIGN-SOC P4 — SOC console overview API.
// Returns the first-screen aggregates (coverage / detections / cases / SLA) plus
// the recent-case list. Gated by view_operations (the same capability as the
// /ops surface). Read-only, no-store.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadSocConsole } from "@/lib/security/console-loader";

export async function GET(): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_operations")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const overview = await loadSocConsole();
  return NextResponse.json(overview, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
