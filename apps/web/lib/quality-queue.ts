const QUEUE_KEY = "dpf-quality-queue";

type QueuedReport = {
  type: string;
  title: string;
  description?: string;
  severity?: string;
  routeContext?: string;
  errorStack?: string;
  source?: string;
  userAgent?: string;
  userId?: string;
  queuedAt: string;
};

export function queueReport(report: Omit<QueuedReport, "queuedAt">): void {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    let queue: QueuedReport[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) queue = parsed;
      } catch {
        // Corrupt data — discard
      }
    }
    queue.push({ ...report, queuedAt: new Date().toISOString() });
    // Keep max 50 queued reports
    if (queue.length > 50) queue = queue.slice(-50);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

export async function flushQueue(): Promise<number> {
  let flushed = 0;
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return 0;
    let queue: QueuedReport[];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        localStorage.removeItem(QUEUE_KEY);
        return 0;
      }
      queue = parsed;
    } catch {
      localStorage.removeItem(QUEUE_KEY);
      return 0;
    }

    const remaining: QueuedReport[] = [];
    for (const report of queue) {
      try {
        const res = await fetch("/api/quality/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(report),
        });
        if (res.ok) {
          flushed++;
        } else {
          remaining.push(report);
        }
      } catch {
        remaining.push(report);
      }
    }

    if (remaining.length > 0) {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    } else {
      localStorage.removeItem(QUEUE_KEY);
    }
  } catch {
    // Silent fail
  }
  return flushed;
}

export async function submitReport(report: Omit<QueuedReport, "queuedAt">): Promise<{ ok: boolean; reportId?: string }> {
  try {
    const res = await fetch("/api/quality/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...report,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok: boolean; reportId?: string };
      return data;
    }
    queueReport(report);
    return { ok: false };
  } catch {
    queueReport(report);
    return { ok: false };
  }
}
