// apps/web/app/api/calendar/sync/route.ts
// Webhook receiver stub for external calendar sync (Google, Outlook).
// Not yet implemented — returns 501 to indicate the endpoint exists but isn't active.

import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  console.log("[calendar-sync] webhook received:", JSON.stringify(body)?.slice(0, 200));

  return Response.json(
    {
      status: "not_implemented",
      message: "Calendar sync webhooks are not yet active. This endpoint is reserved for future Google/Outlook integration.",
    },
    { status: 501 },
  );
}

export async function GET() {
  return Response.json({
    status: "ok",
    message: "Calendar sync endpoint. POST to receive webhook notifications from external calendar providers.",
    supportedProviders: ["google", "outlook", "ical"],
    implementationStatus: "stub",
  });
}
