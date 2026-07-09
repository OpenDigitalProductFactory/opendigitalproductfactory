import { describe, expect, it } from "vitest";
import { formatRefreshAge, windowMateriallyDiffers } from "./OperationsMapLiveShell";

const HOUR = 60 * 60_000;

describe("windowMateriallyDiffers", () => {
  it("always fetches when nothing has been fetched yet", () => {
    expect(windowMateriallyDiffers(null, { start: 0, end: HOUR })).toBe(true);
  });

  it("ignores padding-sized drift from the panel's post-swap republish", () => {
    const previous = { start: 0, end: 24 * HOUR };
    // 5% of a 24h span is 72min; a 30min end drift (new events + padding)
    // must NOT trigger another fetch, or refresh would feedback-loop.
    expect(windowMateriallyDiffers(previous, { start: 0, end: previous.end + 30 * 60_000 })).toBe(false);
  });

  it("fetches when the operator scrubs to a different window", () => {
    const previous = { start: 0, end: 24 * HOUR };
    expect(windowMateriallyDiffers(previous, { start: -10 * 24 * HOUR, end: -9 * 24 * HOUR })).toBe(true);
  });

  it("fetches when the operator zooms materially", () => {
    const previous = { start: 0, end: 24 * HOUR };
    expect(windowMateriallyDiffers(previous, { start: 8 * HOUR, end: 16 * HOUR })).toBe(true);
  });

  it("uses at least a one-minute tolerance for tiny spans", () => {
    const previous = { start: 0, end: 15 * 60_000 };
    expect(windowMateriallyDiffers(previous, { start: 30_000, end: 15 * 60_000 + 30_000 })).toBe(false);
  });
});

describe("formatRefreshAge", () => {
  it("labels fresh data as just now", () => {
    expect(formatRefreshAge(3_000)).toBe("just now");
  });

  it("labels seconds, minutes, and hours", () => {
    expect(formatRefreshAge(30_000)).toBe("30s ago");
    expect(formatRefreshAge(5 * 60_000)).toBe("5m ago");
    expect(formatRefreshAge(3 * HOUR)).toBe("3h ago");
  });
});
