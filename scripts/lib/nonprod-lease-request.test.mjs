import test from "node:test";
import assert from "node:assert/strict";
import { leaseRequestTiming } from "./nonprod-lease-request.mjs";

test("relative lease requests retain explicit duration, independent deadline and legacy fallback", () => {
  const now = new Date("2026-10-16T20:00:00Z");
  const deadline = now.getTime() + 600_000;
  const result = leaseRequestTiming({ now, durationMs: 120_000, deadline });
  assert.deepEqual(result, {
    expiresAt: "2026-10-16T20:02:00.000Z", requestedTtlMs: 120_000,
    waitDeadlineAt: "2026-10-16T20:10:00.000Z",
  });
  // An old server ignores the new field and still receives a bounded absolute request.
  assert.equal(Date.parse(result.expiresAt) - now.getTime(), 120_000);
});

test("an expired operation deadline cannot be rebased by building fresh arguments", () => {
  const now = new Date("2026-10-16T20:00:00Z");
  assert.throws(() => leaseRequestTiming({ now, durationMs: 120_000, deadline: now.getTime() }), /deadline/);
});

test("rejects invalid requested durations rather than silently changing approved arguments", () => {
  const now = new Date("2026-10-16T20:00:00Z");
  for (const durationMs of [0, -1, NaN, Infinity, 1_200_001]) {
    assert.throws(() => leaseRequestTiming({ now, durationMs, deadline: now.getTime() + 60_000 }), /duration/);
  }
});
