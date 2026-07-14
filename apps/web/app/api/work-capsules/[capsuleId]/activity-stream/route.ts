import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createSseResponse } from "@/lib/sse/sse-stream";
import {
  subscribeToWorkCapsuleActivityEvents,
  type WorkCapsuleActivityEvent,
} from "@/lib/work-capsules/activity-events";
import {
  loadAgentSessionEntryByActivityId,
  loadInitialAgentSessionEntries,
  WORK_CAPSULE_ACTIVITY_EVENT,
} from "@/lib/work-capsules/activity-stream";

export const dynamic = "force-dynamic";

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ capsuleId: string }> },
) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    return unauthorized();
  }

  const { capsuleId } = await params;

  return createSseResponse({
    signal: request.signal,
    start(controller) {
      let workCapsuleId: string | null = null;
      let active = true;
      let unsubscribe: (() => void) | null = null;

      void (async () => {
        const initial = await loadInitialAgentSessionEntries({
          db: prisma,
          capsuleId,
        });
        if (!active || controller.closed) return;
        if (!initial) {
          controller.sendNamed("error", { error: "not_found" });
          controller.close();
          return;
        }
        workCapsuleId = initial.workCapsuleId;
        controller.sendNamed(WORK_CAPSULE_ACTIVITY_EVENT, {
          type: "snapshot",
          entries: initial.entries,
        });
      })().catch(() => {
        if (!controller.closed) {
          controller.sendNamed("error", { error: "initial_replay_failed" });
        }
      });

      void subscribeToWorkCapsuleActivityEvents(async (event: WorkCapsuleActivityEvent) => {
        if (!active || controller.closed) return;
        if (!workCapsuleId || event.workCapsuleId !== workCapsuleId) return;
        const entry = await loadAgentSessionEntryByActivityId({
          db: prisma,
          workCapsuleId,
          activityId: event.activityId,
        });
        if (!entry || !active || controller.closed) return;
        controller.sendNamed(WORK_CAPSULE_ACTIVITY_EVENT, {
          type: "activity",
          entry,
        });
      }).then((cleanup) => {
        if (!active) cleanup();
        else unsubscribe = cleanup;
      }).catch(() => {
        if (!controller.closed) {
          controller.sendNamed("error", { error: "subscribe_failed" });
        }
      });

      return () => {
        active = false;
        unsubscribe?.();
      };
    },
  });
}
