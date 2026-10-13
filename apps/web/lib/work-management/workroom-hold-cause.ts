/**
 * Hold causes, as tags and as words (EP-B70E718D). Pure and browser-safe: the
 * flow map renders these in the client, so this module must never import the
 * telemetry writer or anything that reaches the database.
 */

/**
 * The hold's cause as a stable tag: the drive reason, narrowed by the first
 * conformance deviation when there is one (`conformance_pause:missing_explicit_coordinator`),
 * so a pile of rooms names the actual problem.
 */
export function holdCauseTag(reason: string | null, detail?: string | null): string | null {
  if (!reason) return null;
  return detail ? `${reason}:${detail}` : reason;
}

/** "missing explicit coordinator (conformance pause)", "waiting on a person", "executor writeback unavailable". */
export function describeHoldCause(cause: string | null): string {
  if (!cause) return "blocked";
  if (cause === "awaiting-person") return "waiting on a person";
  const [reason, detail] = cause.split(":");
  const words = (text: string) => text.replaceAll("_", " ");
  return detail ? `${words(detail)} (${words(reason!)})` : words(reason!);
}
