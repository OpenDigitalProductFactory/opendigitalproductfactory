import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createSseResponse } from "@/lib/sse/sse-stream";
import { subscribeToWorkCapsuleActivityEvents } from "@/lib/work-capsules/activity-events";
import { loadDeliveryTaskHubPage, loadDeliveryTaskHubRow } from "@/lib/work-capsules/delivery-task-hub-store";
import { DELIVERY_TASK_HUB_EVENT, startDeliveryTaskHubSession } from "@/lib/work-capsules/delivery-task-stream";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    return new Response("Unauthorized", { status: 401 });
  }

  return createSseResponse({
    signal: request.signal,
    start(controller) {
      let stopped = false;
      let dispose: (() => void) | null = null;
      void startDeliveryTaskHubSession({
        send: (event) => controller.sendNamed(DELIVERY_TASK_HUB_EVENT, event),
        loadSnapshot: () => loadDeliveryTaskHubPage(prisma),
        loadRow: (workroomId) => loadDeliveryTaskHubRow(prisma, workroomId),
        subscribe: subscribeToWorkCapsuleActivityEvents,
      }).then((cleanup) => {
        if (stopped) cleanup();
        else dispose = cleanup;
      }).catch(() => {
        if (!controller.closed) controller.sendNamed(DELIVERY_TASK_HUB_EVENT, {
          type: "error",
          error: "stream_start_failed",
          observedAt: new Date().toISOString(),
        });
      });
      return () => {
        stopped = true;
        dispose?.();
      };
    },
  });
}
