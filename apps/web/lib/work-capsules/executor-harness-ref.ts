// BI-75AB446B: the orchestrating harness's own references for the session that
// claims a room. T3 Code exports T3CODE_THREAD_ID to every provider session it
// starts; the claim records it so the room can be found from the thread and the
// thread from the room.
//
// The fields follow the seam both sides already use: DPF's T3 port reads a
// thread's `threadId` and `providerInstanceId` (lib/build/t3-code), and DPF2's
// governed T3 binds a claim to the same pair. Project and environment name
// where the thread lives.
//
// These describe. They are never an authority identity: executor kind, the
// provider session id (`executorRef`) and grants are untouched (BI-53BED66C D5).

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export const EXECUTOR_HARNESS_REF_FIELDS = ["threadId", "projectId", "environmentId", "providerInstanceId"] as const;
export type ExecutorHarnessRef = { threadId: string } & Partial<Record<Exclude<(typeof EXECUTOR_HARNESS_REF_FIELDS)[number], "threadId">, string>>;

/** T3 thread ids include `thread:delegated-task:command%3Amcp%3A…` and `mcp:launch:<hash>`. */
const REF_VALUE = /^[A-Za-z0-9._:%@-]{1,256}$/;

const FORMAT = "harnessRef is { threadId, projectId?, environmentId?, providerInstanceId? }; each is 1-256 characters of letters, digits and . _ : % @ - (for T3 Code, threadId is T3CODE_THREAD_ID).";

export const HARNESS_REF_REQUIRES_HARNESS = 'harnessRef describes the orchestrating harness, so name it: pass harness "t3-code" with harnessRef, or omit harnessRef.';

/** The claim's `harnessRef`, or null when the caller sent none. Format only; the caller checks a harness was named. */
export function parseExecutorHarnessRef(raw: unknown): ActionResult<ExecutorHarnessRef | null> {
  if (raw === undefined || raw === null) return ok(null);
  if (typeof raw !== "object" || Array.isArray(raw)) return err(`harnessRef must be an object. ${FORMAT}`);
  const input = raw as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !(EXECUTOR_HARNESS_REF_FIELDS as readonly string[]).includes(key));
  if (unknown.length) return err(`harnessRef has unknown field(s): ${unknown.join(", ")}. ${FORMAT}`);
  const ref: Record<string, string> = {};
  for (const field of EXECUTOR_HARNESS_REF_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !REF_VALUE.test(value.trim())) return err(`harnessRef.${field} is not a usable reference. ${FORMAT}`);
    ref[field] = value.trim();
  }
  if (!ref["threadId"]) return err(`harnessRef.threadId is required. ${FORMAT}`);
  return ok(ref as ExecutorHarnessRef);
}

/** The reference already recorded for this harness and session, if any. */
export function recordedExecutorHarnessRef(state: Record<string, unknown>, harness: string, sessionRef: string): ExecutorHarnessRef | null {
  const current = state["executorHarness"];
  if (!current || typeof current !== "object" || Array.isArray(current)) return null;
  const row = current as Record<string, unknown>;
  if (row["harness"] !== harness || row["executorRef"] !== sessionRef) return null;
  const ref = row["ref"];
  return ref && typeof ref === "object" && !Array.isArray(ref) && typeof (ref as Record<string, unknown>)["threadId"] === "string"
    ? ref as ExecutorHarnessRef : null;
}
