import { describe, expect, it, vi } from "vitest";
import type { Locator } from "@playwright/test";
import { quotaMeasurementStatus, waitForQuotaControlSettlement, type QuotaControlState } from "./provider-quota-recovery-settlement";

const ready: QuotaControlState = { connected: true, visible: true, disabled: false, busy: false,
  opacity: 1, animations: 0, color: "rgb(255, 255, 255)", backgroundColor: "rgb(37, 99, 235)", transitionDuration: "0.15s" };
function sampler(states: QuotaControlState[]) {
  const last = states.at(-1)!;
  const evaluate = vi.fn(async () => states.shift() ?? last);
  return { control: { evaluate } as unknown as Locator, evaluate };
}
describe("quota measurement completion contract", () => {
  it("observes pending, animation, then settled state before returning evidence", async () => {
    const sample = sampler([{ ...ready, disabled: true, busy: true }, { ...ready, animations: 1, opacity: 0.6 }, ready]);
    expect(await waitForQuotaControlSettlement(sample.control, 2000)).toEqual(ready);
    expect(sample.evaluate.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it("keeps settled non-unit opacity for axe to judge instead of altering styles", async () => {
    const sample = sampler([{ ...ready, opacity: 0.9 }]);
    expect((await waitForQuotaControlSettlement(sample.control)).opacity).toBe(0.9);
  });
  it("refuses a permanently disabled control and retains its last measured state", async () => {
    const sample = sampler([{ ...ready, disabled: true }]);
    await expect(waitForQuotaControlSettlement(sample.control, 100)).rejects.toThrow('"disabled":true');
  });
  it("does not mark a zero-violation capture passed if the control changed afterwards", () => {
    expect(quotaMeasurementStatus(0, { ...ready, busy: true })).toBe("failed");
    expect(quotaMeasurementStatus(0, ready)).toBe("passed");
    expect(quotaMeasurementStatus(1, ready)).toBe("failed");
    expect(quotaMeasurementStatus(0, null)).toBe("passed");
  });
});
