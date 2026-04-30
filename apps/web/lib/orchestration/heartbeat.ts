// apps/web/lib/orchestration/heartbeat.ts
// runId-scoped heartbeat timer for orchestration primitives.
// See: spec §Heartbeat Contract — interval scoped to runId, started at primitive entry,
// cleared in finally before return, reset by any event activity for the same runId.

type Timeout = ReturnType<typeof setTimeout>;

type HeartbeatEntry = {
  timer: Timeout;
  heartbeatMs: number;
  onTick: () => void;
  stopped: boolean;
};

const heartbeats = new Map<string, HeartbeatEntry>();

function schedule(runId: string, entry: HeartbeatEntry): void {
  entry.timer = setTimeout(() => {
    if (entry.stopped) return;
    entry.onTick();
    schedule(runId, entry);
  }, entry.heartbeatMs);
}

export function startHeartbeat(runId: string, heartbeatMs: number, onTick: () => void): void {
  // Replace any existing heartbeat for this runId — defensive against
  // re-entry where a primitive is restarted with the same runId.
  stopHeartbeat(runId);

  const entry: HeartbeatEntry = {
    heartbeatMs,
    onTick,
    stopped: false,
    timer: undefined as unknown as Timeout,
  };
  heartbeats.set(runId, entry);
  schedule(runId, entry);
}

// Resets the quiet timer. Equivalent to: any event activity for the same
// runId pushes the next heartbeat firing back by heartbeatMs.
export function noteActivity(runId: string): void {
  const entry = heartbeats.get(runId);
  if (!entry || entry.stopped) return;
  clearTimeout(entry.timer);
  schedule(runId, entry);
}

export function stopHeartbeat(runId: string): void {
  const entry = heartbeats.get(runId);
  if (!entry) return;
  entry.stopped = true;
  clearTimeout(entry.timer);
  heartbeats.delete(runId);
}
