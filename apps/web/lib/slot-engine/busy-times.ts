import type { TimeWindow, BusyPeriod } from "./types";

export function subtractBusyTimes(
  windows: TimeWindow[],
  busy: BusyPeriod[]
): TimeWindow[] {
  if (busy.length === 0) return [...windows];

  const sorted = [...busy].sort((a, b) => a.startMinutes - b.startMinutes);
  let free: TimeWindow[] = [...windows];

  for (const bp of sorted) {
    const next: TimeWindow[] = [];
    for (const w of free) {
      if (bp.endMinutes <= w.startMinutes || bp.startMinutes >= w.endMinutes) {
        next.push(w);
        continue;
      }
      if (bp.startMinutes > w.startMinutes) {
        next.push({ startMinutes: w.startMinutes, endMinutes: bp.startMinutes });
      }
      if (bp.endMinutes < w.endMinutes) {
        next.push({ startMinutes: bp.endMinutes, endMinutes: w.endMinutes });
      }
    }
    free = next;
  }

  return free;
}
