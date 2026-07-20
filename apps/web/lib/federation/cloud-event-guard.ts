const DEFAULT_REPLAY_WINDOW_MS = 15 * 60_000;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Transport guard shared by demand inbox/control endpoints. */
export function validateFederationCloudEvent(
  value: unknown,
  context: { linkId: string; now?: Date; replayWindowMs?: number },
): string[] {
  if (!record(value)) return ["event:invalid"];
  const violations: string[] = [];
  if (value.specversion !== "1.0") violations.push("specversion:unsupported");
  if (typeof value.id !== "string" || value.id.length < 1 || value.id.length > 240) violations.push("id:invalid");
  if (typeof value.source !== "string" || value.source.length < 1 || value.source.length > 240) violations.push("source:invalid");
  if (typeof value.type !== "string" || value.type.length < 1 || value.type.length > 160) violations.push("type:invalid");
  if (value.datacontenttype !== "application/json") violations.push("datacontenttype:unsupported");
  if (value.dpflinkid !== context.linkId) violations.push("link:mismatch");
  const eventTime = typeof value.time === "string" ? Date.parse(value.time) : Number.NaN;
  if (!Number.isFinite(eventTime)) {
    violations.push("time:invalid");
  } else {
    const distance = Math.abs((context.now ?? new Date()).getTime() - eventTime);
    if (distance > (context.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS)) {
      violations.push("time:outside-replay-window");
    }
  }
  if (!("data" in value)) violations.push("data:missing");
  return violations;
}
