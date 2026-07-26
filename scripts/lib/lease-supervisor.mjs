export function heartbeatIntervalMs(ttlMs) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("lease TTL must be a positive number");
  }
  return Math.max(1, Math.floor(ttlMs / 3));
}

export async function superviseLeaseRun({
  ttlMs,
  run,
  renew,
  terminate,
  release,
  schedule = (callback, intervalMs) => setInterval(callback, intervalMs),
  cancelSchedule = (timer) => clearInterval(timer),
  onEvent = () => {},
}) {
  const startedAt = new Date().toISOString();
  let fencedReason = "";
  let heartbeatInFlight = null;
  let releaseAttempted = false;

  onEvent({ type: "started", at: startedAt });

  const heartbeat = async () => {
    if (fencedReason || heartbeatInFlight) return heartbeatInFlight;
    heartbeatInFlight = (async () => {
      let response;
      try {
        response = await renew();
      } catch (error) {
        response = { success: false, error: error?.message || String(error) };
      }
      if (response?.success === true) {
        onEvent({ type: "heartbeat-renewed", at: new Date().toISOString() });
        return;
      }
      fencedReason = response?.error || "lease-renewal-failed";
      onEvent({
        type: "heartbeat-lost",
        at: new Date().toISOString(),
        reason: fencedReason,
      });
      await terminate();
    })().finally(() => {
      heartbeatInFlight = null;
    });
    return heartbeatInFlight;
  };

  const timer = schedule(heartbeat, heartbeatIntervalMs(ttlMs));
  try {
    const result = await run();
    if (fencedReason) return { status: "fenced", reason: fencedReason, result };
    return { status: "completed", result };
  } finally {
    cancelSchedule(timer);
    if (heartbeatInFlight) await heartbeatInFlight;
    if (!releaseAttempted) {
      releaseAttempted = true;
      await release();
      onEvent({ type: "released", at: new Date().toISOString() });
    }
  }
}
