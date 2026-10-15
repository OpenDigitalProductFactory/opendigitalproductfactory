// BI-F9EE05E5 slice C: the operator's three choices while an upgrade waits
// (quiescence spec §11a). One dispatcher, called by the control route, which
// the proxy lets through during a drain; server actions post to the page and
// the proxy refuses those exactly when these choices are needed.

import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import type { QuiescenceControlAction } from "./drain-wait";

export const QUIESCENCE_CONTROL_ACTIONS: readonly QuiescenceControlAction[] = ["keep-waiting", "force", "abort"];

export function parseQuiescenceControlRequest(body: unknown): ActionResult<{ runId: string; action: QuiescenceControlAction }> {
  if (!body || typeof body !== "object") return err("Request body must be JSON.");
  const { runId, action } = body as { runId?: unknown; action?: unknown };
  if (typeof runId !== "string" || !/^QR-[A-Za-z0-9-]{1,64}$/.test(runId)) return err("runId is required.");
  if (typeof action !== "string" || !(QUIESCENCE_CONTROL_ACTIONS as readonly string[]).includes(action)) {
    return err(`action must be one of: ${QUIESCENCE_CONTROL_ACTIONS.join(", ")}.`);
  }
  return ok({ runId, action: action as QuiescenceControlAction });
}

export async function applyQuiescenceControl(
  runId: string,
  action: QuiescenceControlAction,
  operatorUserId: string,
): Promise<ActionResult> {
  if (action === "keep-waiting") {
    const { extendQuiescenceWait } = await import("./drain-wait");
    const result = await extendQuiescenceWait(runId, operatorUserId);
    return result.ok ? ok() : err(result.error);
  }
  if (action === "force") {
    const { escalateQuiescenceToForced } = await import("./quiescence");
    const result = await escalateQuiescenceToForced(runId, operatorUserId);
    return result.ok ? ok() : err(result.reason);
  }
  const { abortQuiescence } = await import("./quiescence");
  await abortQuiescence(runId, operatorUserId);
  return ok();
}
