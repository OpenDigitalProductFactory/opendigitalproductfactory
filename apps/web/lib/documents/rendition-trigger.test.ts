import { describe, expect, it, vi } from "vitest";
import { createRenditionResumeWatch, requestDocumentRenditions } from "./rendition-trigger";

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
