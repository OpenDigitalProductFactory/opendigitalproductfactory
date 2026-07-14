// BI-2750EB6F: the pure decision behind the coworker chat turn-completion
// watchdog. A busy turn is "stalled" when no sign of server life (an SSE data
// frame OR the periodic liveness heartbeat) has been observed for longer than
// the limit — the condition under which the client surfaces a failure and
// clears the spinner, since every server-dependent clearer (SSE `done`, DB
// recovery poll, transport reconnect) is itself blocked when the portal event
// loop is saturated. Pure so the threshold semantics are unit-tested without a
// full panel render.
export function isTurnStalled(
  lastServerActivityAtMs: number,
  nowMs: number,
  limitMs: number,
): boolean {
  return nowMs - lastServerActivityAtMs >= limitMs;
}
