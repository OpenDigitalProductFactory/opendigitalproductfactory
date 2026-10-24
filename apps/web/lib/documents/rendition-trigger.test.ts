import { describe, expect, it, vi } from "vitest";
import { createDebouncedBackfillRequest, createRenditionResumeWatch, requestDocumentRenditions } from "./rendition-trigger";

describe("requestDocumentRenditions", () => {
  it("sends the durable rendition event for the saved version", async () => {
    const send = vi.fn(async () => undefined);
    expect(await requestDocumentRenditions("ver-1", { send })).toBe(true);
    expect(send).toHaveBeenCalledWith({ name: "documents/rendition.requested", data: { documentVersionId: "ver-1" } });
  });

  it("never fails the save when the job engine is unreachable", async () => {
    const send = vi.fn(async () => { throw new Error("inngest down"); });
    expect(await requestDocumentRenditions("ver-1", { send })).toBe(false);
  });
});

describe("createRenditionResumeWatch", () => {
  it("requests one backfill when the converter becomes available, not on every probe", async () => {
    const answers: Array<boolean | null> = [null, false, true, true, false, true];
    const send = vi.fn(async () => undefined);
    const watch = createRenditionResumeWatch({ probe: async () => answers.shift()!, send });

    for (let i = 0; i < 6; i++) await watch();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({
      name: "documents/rendition.backfill-requested",
      data: { reason: "converter-available" },
    });
  });

  it("passes the probe answer through for the dependency gauge", async () => {
    const watch = createRenditionResumeWatch({ probe: async () => null, send: vi.fn() });
    expect(await watch()).toBeNull();
  });

  it("treats the first available answer after a restart as a flip", async () => {
    const send = vi.fn(async () => undefined);
    const watch = createRenditionResumeWatch({ probe: async () => true, send });
    await watch();
    await watch();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

// BI-153EC72C: portal start and a release change ask for a backfill directly,
// debounced so a burst of asks (boot, then the boot pin change) sends one event.
describe("createDebouncedBackfillRequest", () => {
  it("collapses asks inside the window into one backfill event naming every reason", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn(async () => undefined);
      const request = createDebouncedBackfillRequest({ send, delayMs: 60_000 });
      request("portal-start");
      await vi.advanceTimersByTimeAsync(30_000);
      request("release-change");
      await vi.advanceTimersByTimeAsync(59_000);
      expect(send).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ name: "documents/rendition.backfill-requested", data: { reason: "portal-start+release-change" } });

      request("release-change");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenLastCalledWith({ name: "documents/rendition.backfill-requested", data: { reason: "release-change" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never throws when the job engine is unreachable", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const send = vi.fn(async () => {
        throw new Error("inngest down");
      });
      createDebouncedBackfillRequest({ send, delayMs: 10 })("portal-start");
      await vi.advanceTimersByTimeAsync(10);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not request the rendition backfill"), expect.anything());
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
