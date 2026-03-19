// GET /api/v1/agent/stream — SSE endpoint for agent events (stub)
//
// For now this sends a single "connected" event then closes.
// The real implementation will subscribe to the agent event bus.

import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send a connected event
      const data = `data: ${JSON.stringify({ type: "connected" })}\n\n`;
      controller.enqueue(encoder.encode(data));

      // Close the stream — stub behaviour
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
