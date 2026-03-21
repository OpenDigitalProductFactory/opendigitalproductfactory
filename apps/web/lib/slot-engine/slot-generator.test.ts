import { describe, it, expect } from "vitest";
import { generateSlotCandidates } from "./slot-generator";
import type { TimeWindow, BusyPeriod } from "./types";

describe("generateSlotCandidates", () => {
  it("generates slots at interval within window", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 720 }]; // 9-12
    const slots = generateSlotCandidates(windows, [], {
      durationMinutes: 45,
      intervalMinutes: 45,
      beforeBuffer: 0,
      afterBuffer: 0,
    });
    expect(slots).toHaveLength(4);
    expect(slots[0]).toEqual({ startMinutes: 540, endMinutes: 585 });
    expect(slots[3]).toEqual({ startMinutes: 675, endMinutes: 720 });
  });

  it("respects buffer time in slot footprint (buffers affect busy overlap, not window fit)", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 720 }]; // 9-12
    const busy: BusyPeriod[] = [{ startMinutes: 600, endMinutes: 645 }]; // 10:00-10:45 booking
    const slots = generateSlotCandidates(windows, busy, {
      durationMinutes: 45,
      intervalMinutes: 45,
      beforeBuffer: 10,
      afterBuffer: 10,
    });
    // 9:00 footprint [8:50, 9:55] — no overlap with busy → included
    // 9:45 footprint [9:35, 10:40] — overlaps busy 10:00 → excluded
    // 10:30 footprint [10:20, 11:25] — overlaps busy end 10:45 → excluded
    // 11:15 footprint [11:05, 12:10] — no overlap with busy → included (slot 11:15-12:00 fits in window)
    expect(slots.map((s) => s.startMinutes)).toEqual([540, 675]);
  });

  it("returns empty when window too small for duration", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 570 }]; // 30 min window
    const slots = generateSlotCandidates(windows, [], {
      durationMinutes: 45,
      intervalMinutes: 45,
      beforeBuffer: 0,
      afterBuffer: 0,
    });
    expect(slots).toEqual([]);
  });
});
