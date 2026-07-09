import { describe, it, expect } from "vitest";
import {
  selectExpirableEntries,
  selectPrunableMessages,
  lastTouch,
  DEFAULT_MEMORY_UNUSED_DAYS,
  DEFAULT_MESSAGE_RETENTION_DAYS,
  type ExpirableEntry,
} from "./memory-expiry";

const NOW = new Date("2026-07-09T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("lastTouch", () => {
  it("uses lastAccessedAt when present", () => {
    const e: ExpirableEntry = { id: "a", createdAt: daysAgo(100), lastAccessedAt: daysAgo(2) };
    expect(lastTouch(e)).toEqual(daysAgo(2));
  });
  it("falls back to createdAt when never accessed", () => {
    const e: ExpirableEntry = { id: "a", createdAt: daysAgo(100), lastAccessedAt: null };
    expect(lastTouch(e)).toEqual(daysAgo(100));
  });
});

describe("selectExpirableEntries", () => {
  it("expires entries untouched past the window and keeps recently-used ones", () => {
    const entries: ExpirableEntry[] = [
      { id: "old-unused", createdAt: daysAgo(100), lastAccessedAt: null },
      { id: "old-but-recently-used", createdAt: daysAgo(100), lastAccessedAt: daysAgo(3) },
      { id: "fresh", createdAt: daysAgo(2), lastAccessedAt: null },
    ];
    const ids = selectExpirableEntries(entries, { now: NOW });
    expect(ids).toEqual(["old-unused"]);
  });

  it("never expires protected entries", () => {
    const entries: ExpirableEntry[] = [
      { id: "protected-old", createdAt: daysAgo(365), lastAccessedAt: null, protected: true },
    ];
    expect(selectExpirableEntries(entries, { now: NOW })).toEqual([]);
  });

  it("honors a custom unusedDays window", () => {
    const entries: ExpirableEntry[] = [
      { id: "e", createdAt: daysAgo(10), lastAccessedAt: null },
    ];
    expect(selectExpirableEntries(entries, { now: NOW, unusedDays: 7 })).toEqual(["e"]);
    expect(selectExpirableEntries(entries, { now: NOW, unusedDays: 30 })).toEqual([]);
  });

  it("uses a sane default window", () => {
    expect(DEFAULT_MEMORY_UNUSED_DAYS).toBe(28);
  });
});

describe("selectPrunableMessages", () => {
  const watermark = daysAgo(120);

  it("prunes messages at/behind the watermark AND older than retention", () => {
    const messages = [
      { id: "old-summarized", createdAt: daysAgo(150) }, // behind 120d watermark, 150>90d retention → prune
      { id: "at-watermark-old", createdAt: watermark }, // exactly at watermark, 120>90d → prune
      { id: "between-watermark-and-now", createdAt: daysAgo(100) }, // newer than watermark → not summarized → keep
      { id: "after-watermark", createdAt: daysAgo(10) }, // newer than watermark → keep
    ];
    const ids = selectPrunableMessages(messages, { now: NOW, watermarkAt: watermark });
    expect(ids).toContain("old-summarized");
    expect(ids).toContain("at-watermark-old");
    expect(ids).not.toContain("between-watermark-and-now");
    expect(ids).not.toContain("after-watermark");
  });

  it("keeps summarized messages that are still within the retention window", () => {
    const wm = daysAgo(30);
    const messages = [{ id: "summarized-but-recent", createdAt: daysAgo(40) }];
    // behind watermark (40>30) but only 40d old < 90d retention → keep
    expect(selectPrunableMessages(messages, { now: NOW, watermarkAt: wm })).toEqual([]);
  });

  it("prunes nothing when there is no checkpoint watermark", () => {
    const messages = [{ id: "x", createdAt: daysAgo(1000) }];
    expect(selectPrunableMessages(messages, { now: NOW, watermarkAt: null })).toEqual([]);
  });

  it("uses a sane default retention window", () => {
    expect(DEFAULT_MESSAGE_RETENTION_DAYS).toBe(90);
  });
});
