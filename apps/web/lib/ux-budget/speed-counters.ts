// Deterministic speed counters read from a route's buffered Performance
// entries inside the UX route sweep's existing settle (BI-BDB43823). Pure:
// the sweep serialises the entries in the page and this module counts them,
// so the counting is unit-testable without a browser.

export const SPEED_COUNTERS = ["scriptBytes", "requestCount", "layoutShifts", "longTasks"] as const;
export type SpeedCounterName = (typeof SPEED_COUNTERS)[number];
export type SpeedCounters = Record<SpeedCounterName, number>;

/** The minimal serialisable shape of the entries the sweep collects. */
export type SpeedEntries = {
  resources: Array<{ initiatorType: string; encodedBodySize: number }>;
  layoutShifts: Array<{ value: number; hadRecentInput: boolean }>;
  longTasks: Array<{ duration: number }>;
};

const LONG_TASK_MS = 50;

export function readSpeedCounters(entries: SpeedEntries): SpeedCounters {
  let scriptBytes = 0;
  for (const r of entries.resources) {
    if (r.initiatorType === "script" && Number.isFinite(r.encodedBodySize)) scriptBytes += r.encodedBodySize;
  }
  return {
    scriptBytes,
    requestCount: entries.resources.length,
    layoutShifts: entries.layoutShifts.filter((s) => !s.hadRecentInput && s.value > 0).length,
    longTasks: entries.longTasks.filter((t) => t.duration > LONG_TASK_MS).length,
  };
}

/**
 * Runs IN THE PAGE via page.evaluate (passed as a real function, like the
 * sweep's other in-page readers). Buffered observers return entries recorded
 * before the call, so no extra navigation or wait is needed.
 */
export async function collectSpeedEntries(): Promise<SpeedEntries> {
  const buffered = (type: string) =>
    new Promise<PerformanceEntry[]>((resolve) => {
      try {
        const seen: PerformanceEntry[] = [];
        const po = new PerformanceObserver((list) => seen.push(...list.getEntries()));
        po.observe({ type, buffered: true });
        setTimeout(() => {
          po.disconnect();
          resolve(seen);
        }, 0);
      } catch {
        resolve([]);
      }
    });
  const [shifts, tasks] = await Promise.all([buffered("layout-shift"), buffered("longtask")]);
  const resources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map((r) => ({
    initiatorType: r.initiatorType,
    encodedBodySize: r.encodedBodySize,
  }));
  return {
    resources,
    layoutShifts: shifts.map((s) => {
      const shift = s as PerformanceEntry & { value: number; hadRecentInput: boolean };
      return { value: shift.value, hadRecentInput: shift.hadRecentInput };
    }),
    longTasks: tasks.map((t) => ({ duration: t.duration })),
  };
}
