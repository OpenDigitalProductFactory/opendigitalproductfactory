// apps/web/app/api/platform/integrations/sync-progress/[syncId]/route.ts
// SSE endpoint for real-time MCP catalog sync progress. Subscribes to the
// agent event bus keyed by syncId and streams events to the browser.

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { agentEventBus } from "@/lib/agent-event-bus";
import { createSseResponse } from "@/lib/sse/sse-stream";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ syncId: string }> },
): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { syncId } = await params;

  return createSseResponse({
    signal: request.signal,
    start: (sse) => {
      const unsub = agentEventBus.subscribe(syncId, (event) => {
        sse.send(event);
        if (event.type === "done") {
          unsub();
          sse.close();
        }
      });
      return unsub;
    },
  });
}
