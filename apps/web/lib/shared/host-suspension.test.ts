import { describe, expect, it } from "vitest";
import { createHostSuspensionLedger } from "./host-suspension";

function fakeClock() {
  const clock = { wall: 1_000_000, mono: 5_000, wallMs: () => clock.wall, monotonicMs: () => clock.mono };
  return clock;
}

describe("host suspension ledger (BI-4FDE4050)", () => {
  it("credits nothing while wall and process time advance together", () => {
    const clock = fakeClock();
    const ledger = createHostSuspensionLedger(clock);
    const since = new Date(clock.wall);
    clock.wall += 300_000; clock.mono += 300_000;
    expect(ledger.suspendedMsSince(since)).toBe(0);
  });
  it("credits a wall-clock jump that the monotonic clock did not see", () => {
    const clock = fakeClock();
    const ledger = createHostSuspensionLedger(clock);
    clock.wall += 10_000; clock.mono += 10_000;
    const beat = new Date(clock.wall);
    ledger.observe();
    clock.wall += 540_000; clock.mono += 20_000; // slept 520 s
    expect(ledger.suspendedMsSince(beat)).toBe(520_000);
  });
  it("does not credit a suspension that ended before the signal", () => {
    const clock = fakeClock();
    const ledger = createHostSuspensionLedger(clock);
    clock.wall += 600_000; clock.mono += 5_000; // slept, then observed on wake
    ledger.observe();
    clock.wall += 1_000; clock.mono += 1_000;
    const beat = new Date(clock.wall);
    clock.wall += 200_000; clock.mono += 200_000;
    expect(ledger.suspendedMsSince(beat)).toBe(0);
  });
  it("keeps sub-second clock noise as noise and never credits a backward wall step", () => {
    const clock = fakeClock();
    const ledger = createHostSuspensionLedger(clock);
    const since = new Date(clock.wall);
    clock.wall += 60_400; clock.mono += 60_000;
    expect(ledger.suspendedMsSince(since)).toBe(400);
    clock.wall -= 30_000;
    expect(ledger.suspendedMsSince(since)).toBe(0);
  });
  it("credits nothing before the process existed: a restart is still loss", () => {
    const clock = fakeClock();
    const beforeStart = new Date(clock.wall - 600_000);
    const ledger = createHostSuspensionLedger(clock);
    clock.wall += 1_000; clock.mono += 1_000;
    expect(ledger.suspendedMsSince(beforeStart)).toBe(0);
  });
});
