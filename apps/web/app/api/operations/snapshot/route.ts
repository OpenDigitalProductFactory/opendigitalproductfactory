import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/error";
import { auth } from "@/lib/auth";
import { loadVersionedOperationsSnapshot } from "@/lib/twin/operations-loader";
import { formatOperationsServerTiming } from "@/lib/twin/operations-telemetry";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return apiErrorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }

  const snapshot = await loadVersionedOperationsSnapshot();
  if (!snapshot) {
    const response = apiErrorResponse(
      "OPERATIONS_NOT_CONFIGURED",
      "Operations is not configured",
      409,
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": formatOperationsServerTiming(snapshot.telemetry),
      "X-Operations-Version": snapshot.version,
      "X-Operations-Freshness": snapshot.freshness,
    },
  });
}
