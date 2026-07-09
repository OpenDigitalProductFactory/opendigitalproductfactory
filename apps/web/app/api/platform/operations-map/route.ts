// GET /api/platform/operations-map — Ops Map data refresh endpoint.
// BI-44D3203D / BI-40EFC7DE: the operations-map page renders a one-shot
// server snapshot; this route lets the client shell re-fetch the same
// projected payload on a live-refresh interval and re-scope it to the
// replay window the operator is viewing (?start=...&end=... ISO/epoch-ms).
// Auth mirrors the (shell)/platform layout gate: view_platform or 404.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  loadOperationsMapData,
  type OperationsMapEvidenceWindow,
} from "@/lib/ai-operations-map/load-map-data";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
};

export async function GET(request: NextRequest) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_platform",
    )
  ) {
    // Same posture as the platform shell layout: don't reveal the surface.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const window = parseEvidenceWindow(searchParams.get("start"), searchParams.get("end"));
  if (window instanceof Error) {
    return NextResponse.json({ error: window.message }, { status: 400 });
  }

  const data = await loadOperationsMapData(window ? { window } : undefined);
  return NextResponse.json(data, { headers: NO_CACHE_HEADERS });
}

/**
 * Parse the optional window params. Accepts ISO-8601 or epoch milliseconds.
 * Both-or-neither: a lone start/end is a caller bug and 400s rather than
 * silently loading the default view.
 */
function parseEvidenceWindow(
  start: string | null,
  end: string | null,
): OperationsMapEvidenceWindow | null | Error {
  if (start === null && end === null) return null;
  if (start === null || end === null) {
    return new Error("start and end must be provided together");
  }
  const startDate = parseTimestamp(start);
  const endDate = parseTimestamp(end);
  if (!startDate || !endDate) {
    return new Error("start and end must be ISO-8601 dates or epoch milliseconds");
  }
  if (startDate.getTime() >= endDate.getTime()) {
    return new Error("start must be before end");
  }
  return { start: startDate, end: endDate };
}

function parseTimestamp(value: string): Date | null {
  const asNumber = Number(value);
  const date = Number.isFinite(asNumber) && value.trim() !== ""
    ? new Date(asNumber)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
