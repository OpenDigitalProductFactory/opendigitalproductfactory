import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/actions/shared/guards";
import { apiErrorResponse } from "@/lib/api/error";
import { getSelfUpgradeStatusSnapshot } from "@/lib/self-upgrade/status-snapshot";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await requireCapability("view_operations");
    const snapshot = await getSelfUpgradeStatusSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const status = error instanceof Error && error.message === "Unauthorized" ? 401 : 500;
    const response = apiErrorResponse(
      status === 401 ? "UNAUTHORIZED" : "TEMPORARILY_UNAVAILABLE",
      status === 401 ? "Unauthorized" : "Status temporarily unavailable",
      status,
    );
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  }
}
