import type { TimeWindow, BusyPeriod } from "./types";

interface SlotConfig {
  durationMinutes: number;
  intervalMinutes: number;
  beforeBuffer: number;
  afterBuffer: number;
}

interface GeneratedSlot {
  startMinutes: number;
  endMinutes: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function generateSlotCandidates(
  windows: TimeWindow[],
  busy: BusyPeriod[],
  config: SlotConfig
): GeneratedSlot[] {
  const { durationMinutes, intervalMinutes, beforeBuffer, afterBuffer } = config;
  const slots: GeneratedSlot[] = [];

  for (const window of windows) {
    let cursor = window.startMinutes;
    while (cursor + durationMinutes <= window.endMinutes) {
      // Slot itself must fit within window; buffers extend the footprint for busy-period overlap checks only
      const footprintStart = cursor - beforeBuffer;
      const footprintEnd = cursor + durationMinutes + afterBuffer;
      const conflict = busy.some((b) => overlaps(footprintStart, footprintEnd, b.startMinutes, b.endMinutes));
      if (!conflict) {
        slots.push({ startMinutes: cursor, endMinutes: cursor + durationMinutes });
      }

      cursor += intervalMinutes;
    }
  }

  return slots;
}
