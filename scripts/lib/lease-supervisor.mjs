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

/**
 * How long to wait before retrying a renewal whose outcome we never learned.
 *
 * A renewal that THROWS proves nothing: the lease service was unreachable, not
 * lost. Waiting a full heartbeat interval to find out spends a third of the
 * authority budget on a transport hiccup. At a 120s TTL the deadline fires 115s
 * after the last good renewal and heartbeats land at +40s and +80s, so two slow
 * renewals in a row killed the run -- and they are slow precisely when the run
 * itself is saturating the host (BI-ECAE03F7).
 *
 * The backoff starts at a fortieth of the interval and doubles, capped at the
 * interval itself. At a 40s interval that is 1s, 2s, 4s, 8s, 16s, 32s: six
 * further chances inside the same budget that previously allowed one, without
 * hammering a service that is already struggling.
 */
export function uncertainRetryDelayMs(ttlMs, attempt) {
  const intervalMs = heartbeatIntervalMs(ttlMs);
  const base = Math.max(1, Math.floor(intervalMs / 40));
  const exponent = Math.min(Math.max(1, attempt) - 1, 5);
  return Math.min(intervalMs, base * 2 ** exponent);
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
  scheduleRetry = (callback, delayMs) => setTimeout(callback, delayMs),
  cancelRetry = (timer) => clearTimeout(timer),
  now = () => Date.now(),
  safetyMarginMs = authoritySafetyMarginMs(ttlMs),
  onEvent = () => {},
}) {
  const startedAt = new Date().toISOString();
  let fencedReason = "";
  let heartbeatInFlight = null;
  let deadlineInFlight = null;
  let deadlineTimer = null;
  let retryTimer = null;
  let uncertainStreak = 0;
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

  const cancelRetryTimer = () => {
    if (retryTimer === null) return;
    cancelRetry(retryTimer);
    retryTimer = null;
  };

  const scheduleUncertainRetry = () => {
    if (fencedReason) return;
    cancelRetryTimer();
    const delayMs = uncertainRetryDelayMs(ttlMs, uncertainStreak);
    onEvent({
      type: "heartbeat-retry-scheduled",
      at: new Date().toISOString(),
      delayMs,
      attempt: uncertainStreak,
    });
    retryTimer = scheduleRetry(() => {
      retryTimer = null;
      return heartbeat();
    }, delayMs);
  };

  const heartbeat = async () => {
    if (fencedReason || heartbeatInFlight) return heartbeatInFlight;
    heartbeatInFlight = (async () => {
      let response;
      try {
        response = await renew();
      } catch (error) {
        // Unreachable, not lost. Retry soon instead of surrendering a third of
        // the authority budget to a transport hiccup (BI-ECAE03F7).
        uncertainStreak += 1;
        onEvent({
          type: "heartbeat-uncertain",
          at: new Date().toISOString(),
          reason: error?.message || String(error),
          expiresAt: new Date(knownExpiryMs).toISOString(),
          attempt: uncertainStreak,
        });
        scheduleUncertainRetry();
        return;
      }
      if (response?.success === true) {
        uncertainStreak = 0;
        cancelRetryTimer();
        knownExpiryMs = renewedExpiryMs(response) ?? now() + ttlMs;
        armAuthorityDeadline();
        onEvent({
          type: "heartbeat-renewed",
          at: new Date().toISOString(),
          expiresAt: new Date(knownExpiryMs).toISOString(),
        });
        return;
      }
      // A response that refuses is authoritative: the lease is genuinely gone and
      // another holder may exist. Never retry that -- only unreachability.
      cancelRetryTimer();
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
    cancelRetryTimer();
    if (deadlineTimer !== null) cancelDeadline(deadlineTimer);
    if (heartbeatInFlight) await heartbeatInFlight;
    if (deadlineInFlight) await deadlineInFlight;
    await release();
    onEvent({ type: "released", at: new Date().toISOString() });
  }
}
