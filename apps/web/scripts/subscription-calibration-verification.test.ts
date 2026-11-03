import { describe, expect, it, vi } from "vitest";
import { finishCalibrationCapture } from "./subscription-calibration-verification";

function inspection(late?: "snapshot" | "close" | "handler" | "provider") {
  let blocked = 0, providerRequests = 0, closed = false, settled = false;
  const publish = vi.fn();
  const run = async () => {
    const capture = await finishCalibrationCapture({
      capture: async () => { if (late === "snapshot") blocked++; return { status: "passed" }; },
      close: async () => { closed = true; if (late === "close") blocked++; },
      settle: async () => { settled = true; if (late === "handler") blocked++; if (late === "provider") providerRequests++; },
      verify: () => { if (blocked || providerRequests) throw new Error("Unexpected request"); },
    });
    publish(capture);
  };
  return { run, publish, state: () => ({ blocked, providerRequests, closed, settled }) };
}

describe("calibration capture finalization", () => {
  it("returns a passing capture after a quiet close and settled handlers", async () => {
    const attempt = inspection(); await attempt.run();
    expect(attempt.state()).toMatchObject({ closed: true, settled: true });
    expect(attempt.publish).toHaveBeenCalledOnce();
  });
  for (const phase of ["snapshot", "close", "handler", "provider"] as const) {
    it(`refuses a passing artifact when a request arrives during ${phase}`, async () => {
      const attempt = inspection(phase);
      await expect(attempt.run()).rejects.toThrow("Unexpected request");
      expect(attempt.publish).not.toHaveBeenCalled();
      expect(attempt.state()).toMatchObject({ closed: true, settled: true });
    });
  }
  it("settles owned handlers even when context close fails", async () => {
    const settle = vi.fn(async () => {}), verify = vi.fn();
    await expect(finishCalibrationCapture({ capture: async () => ({}), close: async () => { throw new Error("Close failed"); },
      settle, verify })).rejects.toThrow("Close failed");
    expect(settle).toHaveBeenCalledOnce();
    expect(verify).not.toHaveBeenCalled();
  });
});
