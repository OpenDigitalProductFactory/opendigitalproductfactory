// apps/web/lib/self-upgrade/portal-agent-request.ts
//
// BI-2128872C. An agent driving the portal in a browser (signed in as the
// platform automation persona) and pressing "Upgrade now" is an agent request,
// not an operator override. It takes exactly the path the MCP tool takes —
// requestSelfUpgrade with actorKind "agent": routine, release-batched, and
// deferred to the next maintenance window when outside it — and the answer is
// mapped onto the shape the portal trigger control already renders.

import { requestSelfUpgrade } from "@/lib/self-upgrade/request";

export type PortalAgentUpgradeResult =
  | { queued: true; admitted: true; runId: string; dispatchStatus: string }
  | { queued: false; reason: string; message?: string; runId?: string; runAt?: string | null };

export async function requestUpgradeAsPortalAgent(triggeredBy: string): Promise<PortalAgentUpgradeResult> {
  const result = await requestSelfUpgrade({ requestedBy: triggeredBy, actorKind: "agent" });
  switch (result.status) {
    case "queued":
      return { queued: true, admitted: true, runId: result.runId, dispatchStatus: result.dispatchStatus };
    case "already_active":
      return { queued: false, reason: "already-active", runId: result.runId };
    case "deferred_to_window":
      return { queued: false, reason: "deferred-to-window", message: result.message, runAt: result.runAt };
    case "batch_below_threshold":
      return { queued: false, reason: "batch-below-threshold", message: result.message };
    case "human_override_required":
    case "unsupported_install_mode":
      return { queued: false, reason: result.reason, message: result.message };
    case "dispatch_failed":
      return { queued: false, reason: "dispatch-failed", message: result.message, runId: result.runId };
  }
}
