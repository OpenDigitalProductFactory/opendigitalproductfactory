export function heartbeatIntervalMs(ttlMs) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("lease TTL must be a positive number");
  }
  return Math.max(1, Math.floor(ttlMs / 3));
}

export function authoritySafetyMarginMs(ttlMs) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("lease TTL must be a positive number");
  }
  return Math.min(5_000, Math.max(1, Math.floor(ttlMs / 10)));
}

function parsedExpiryMs(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function renewedExpiryMs(response) {
  return parsedExpiryMs(
    response?.data?.lease?.expiresAt
      ?? response?.lease?.expiresAt
      ?? response?.expiresAt,
  );
}

export async function superviseLeaseRun({
  ttlMs,
  expiresAt,
  run,
  renew,
  terminate,
  release,
  schedule = (callback, intervalMs) => setInterval(callback, intervalMs),
  cancelSchedule = (timer) => clearInterval(timer),
  scheduleDeadline = (callback, delayMs) => setTimeout(callback, delayMs),
  cancelDeadline = (timer) => clearTimeout(timer),
  now = () => Date.now(),
  safetyMarginMs = authoritySafetyMarginMs(ttlMs),
  onEvent = () => {},
}) {
  const startedAt = new Date().toISOString();
  let fencedReason = "";
  let heartbeatInFlight = null;
  let deadlineInFlight = null;
  let deadlineTimer = null;
  let knownExpiryMs = parsedExpiryMs(expiresAt) ?? now() + ttlMs;

  onEvent({ type: "started", at: startedAt });

  const fence = async (reason, eventType, detail = {}) => {
    if (fencedReason) return;
    fencedReason = reason;
    onEvent({
      type: eventType,
      at: new Date().toISOString(),
      reason,
      ...detail,
    });
    try {
      await terminate();
    } catch (error) {
      onEvent({
        type: "fence-termination-failed",
        at: new Date().toISOString(),
        reason: error?.message || String(error),
      });
    }
  };

  const armAuthorityDeadline = () => {
    if (deadlineTimer !== null) cancelDeadline(deadlineTimer);
    const delayMs = Math.max(0, knownExpiryMs - safetyMarginMs - now());
    deadlineTimer = scheduleDeadline(() => {
      deadlineInFlight = fence(
        "lease-authority-deadline",
        "authority-deadline",
        { expiresAt: new Date(knownExpiryMs).toISOString() },
      );
      return deadlineInFlight;
    }, delayMs);
  };

  armAuthorityDeadline();

  const heartbeat = async () => {
    if (fencedReason || heartbeatInFlight) return heartbeatInFlight;
    heartbeatInFlight = (async () => {
      let response;
      try {
        response = await renew();
      } catch (error) {
        onEvent({
          type: "heartbeat-uncertain",
          at: new Date().toISOString(),
          reason: error?.message || String(error),
          expiresAt: new Date(knownExpiryMs).toISOString(),
        });
        return;
      }
      if (response?.success === true) {
        knownExpiryMs = renewedExpiryMs(response) ?? now() + ttlMs;
        armAuthorityDeadline();
        onEvent({
          type: "heartbeat-renewed",
          at: new Date().toISOString(),
          expiresAt: new Date(knownExpiryMs).toISOString(),
        });
        return;
      }
      await fence(
        response?.error || "lease-renewal-failed",
        "heartbeat-lost",
      );
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
    // finally runs once per superviseLeaseRun call — release is always owned here
    // (idempotent release is the caller's responsibility if they wrap again).
    cancelSchedule(timer);
    if (deadlineTimer !== null) cancelDeadline(deadlineTimer);
    if (heartbeatInFlight) await heartbeatInFlight;
    if (deadlineInFlight) await deadlineInFlight;
    await release();
    onEvent({ type: "released", at: new Date().toISOString() });
  }
}
