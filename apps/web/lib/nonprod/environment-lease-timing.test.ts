import { describe, expect, it } from "vitest";
import { requestedTtlMs, admittedLeaseTtlMs, resolveLeaseRequestTiming } from "./environment-lease-timing";

describe("absolute lease request validity", () => {
  const now = new Date("2026-10-16T20:00:00Z");
  it.each([0, -1, -120_000])("refuses an absolute expiry offset of %sms", offset => {
    expect(() => requestedTtlMs(now, new Date(now.getTime() + offset)))
      .toThrow("nonprod_lease_request_expired");
  });
  it("retains the remaining absolute lifetime and two-minute admitted cap", () => {
    const ttl = requestedTtlMs(now, new Date(now.getTime() + 300_000));
    expect(ttl).toBe(300_000);
    expect(admittedLeaseTtlMs("local-integration-ci", ttl)).toBe(120_000);
    expect(admittedLeaseTtlMs("host-heavy-resource", ttl)).toBe(120_000);
  });
  it("starts an explicit duration after approval, retaining the independent queue deadline", () => {
    const deadline = new Date(now.getTime() + 600_000);
    expect(resolveLeaseRequestTiming(now, {
      expiresAt: new Date(now.getTime() - 1), requestedTtlMs: 120_000, waitDeadlineAt: deadline,
    })).toEqual({ ttlMs: 120_000, queueExpiresAt: deadline });
  });
  it.each([0, -1, NaN, Infinity, 1_200_001])("refuses invalid explicit duration %s", duration => {
    expect(() => resolveLeaseRequestTiming(now, {
      expiresAt: new Date(now.getTime() + 60_000), requestedTtlMs: duration,
      waitDeadlineAt: new Date(now.getTime() + 600_000),
    })).toThrow("nonprod_lease_duration_invalid");
  });
  it("requires a future independent deadline for relative requests", () => {
    for (const deadline of [undefined, now, new Date(now.getTime() - 1)]) {
      expect(() => resolveLeaseRequestTiming(now, {
        expiresAt: new Date(now.getTime() + 60_000), requestedTtlMs: 120_000, waitDeadlineAt: deadline,
      })).toThrow("nonprod_lease_wait_deadline_invalid");
    }
  });
  it("preserves a legacy zero-wait probe with a live absolute expiry", () => {
    const expiresAt = new Date(now.getTime() + 30_000);
    expect(resolveLeaseRequestTiming(now, { expiresAt, waitDeadlineAt: now }))
      .toEqual({ ttlMs: 30_000, queueExpiresAt: expiresAt });
  });
});
