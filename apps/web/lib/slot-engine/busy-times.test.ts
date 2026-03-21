import { describe, it, expect } from "vitest";
import { subtractBusyTimes } from "./busy-times";
import type { TimeWindow, BusyPeriod } from "./types";

describe("subtractBusyTimes", () => {
  it("returns full window when no busy periods", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 1020 }];
    const result = subtractBusyTimes(windows, []);
    expect(result).toEqual([{ startMinutes: 540, endMinutes: 1020 }]);
  });

  it("removes middle section for busy period", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 1020 }];
    const busy: BusyPeriod[] = [{ startMinutes: 660, endMinutes: 720 }];
    const result = subtractBusyTimes(windows, busy);
    expect(result).toEqual([
      { startMinutes: 540, endMinutes: 660 },
      { startMinutes: 720, endMinutes: 1020 },
    ]);
  });

  it("handles busy period at start of window", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 1020 }];
    const busy: BusyPeriod[] = [{ startMinutes: 540, endMinutes: 600 }];
    const result = subtractBusyTimes(windows, busy);
    expect(result).toEqual([{ startMinutes: 600, endMinutes: 1020 }]);
  });

  it("handles busy period at end of window", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 1020 }];
    const busy: BusyPeriod[] = [{ startMinutes: 960, endMinutes: 1020 }];
    const result = subtractBusyTimes(windows, busy);
    expect(result).toEqual([{ startMinutes: 540, endMinutes: 960 }]);
  });

  it("handles multiple busy periods splitting one window", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 1020 }];
    const busy: BusyPeriod[] = [
      { startMinutes: 600, endMinutes: 660 },
      { startMinutes: 780, endMinutes: 840 },
    ];
    const result = subtractBusyTimes(windows, busy);
    expect(result).toEqual([
      { startMinutes: 540, endMinutes: 600 },
      { startMinutes: 660, endMinutes: 780 },
      { startMinutes: 840, endMinutes: 1020 },
    ]);
  });

  it("returns empty when busy period covers entire window", () => {
    const windows: TimeWindow[] = [{ startMinutes: 540, endMinutes: 600 }];
    const busy: BusyPeriod[] = [{ startMinutes: 540, endMinutes: 600 }];
    expect(subtractBusyTimes(windows, busy)).toEqual([]);
  });
});
