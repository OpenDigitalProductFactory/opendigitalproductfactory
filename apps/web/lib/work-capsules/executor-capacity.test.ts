import { describe, expect, it } from "vitest";
import { capacityWaitFor, describeCapacityWait, formatCentral, parseCheckpointCapacity, runtimePlanLimit, type ProviderCapacityRow } from "./executor-capacity";
import { classifyWorkCapsuleLiveness } from "./liveness";
import { parseExecutorCheckpoint } from "./executor-checkpoint";

// BI-53BED66C: production, 2026-11-13. ProviderCapacityStatus for codex read
// quota_resets_at with retry 2026-11-17T03:54:00.1Z, Mon 16 Nov 9:54 PM Central.
// WC-1920C35F's lease lapsed; the room said only "a token-limited session may
// return", and after 24 h would have read as dead and reapable.
const NOW = new Date("2026-11-13T19:30:00Z");
const RESET = new Date("2026-11-17T03:54:00.100Z");
const codexLimited: ProviderCapacityRow = { providerId: "codex", state: "quota_resets_at", retryAt: RESET,
  lastObservedAt: new Date("2026-11-13T07:15:03Z"), lastSuccessAt: new Date("2026-11-04T03:58:35Z") };
const lapsed = new Date("2026-11-13T06:10:35Z");
const room = { executorKind: "codex-desktop", leaseExpiresAt: lapsed, now: NOW, providerRows: [codexLimited] };

describe("a plan-limited executor's room waits visibly (BI-53BED66C)", () => {
  it("reads the provider's stated reset and offers the unblocked executors", () => {
    const wait = capacityWaitFor(room);
    expect(wait).toMatchObject({ provider: "codex", label: "Codex", source: "provider-capacity", resetAt: RESET });
    expect(wait?.alternatives.map((entry) => entry.executorKind)).toEqual(["claude-desktop", "grok-desktop"]);
    expect(wait?.alternatives[0].step).toContain('reassign_workroom_executor phase "request"');
  });

  it("says when, in Central, and that it may return sooner", () => {
    expect(formatCentral(RESET)).toBe("Mon 16 Nov, 9:54 PM Central");
    expect(describeCapacityWait(capacityWaitFor(room)!)).toBe(
      "Codex plan limit reached; expected back by Mon 16 Nov, 9:54 PM Central (may return sooner; rechecked hourly). Claude or Grok can take it over now.");
  });

  it("keeps out alternatives whose own plans are limited or need sign-in", () => {
    const rows: ProviderCapacityRow[] = [codexLimited,
      { providerId: "anthropic-sub", state: "quota_resets_at", retryAt: new Date("2026-11-14T00:00:00Z"), lastObservedAt: NOW, lastSuccessAt: null },
      { providerId: "xai", state: "reauth_required", retryAt: null, lastObservedAt: NOW, lastSuccessAt: null }];
    expect(capacityWaitFor({ ...room, providerRows: rows })?.alternatives).toEqual([]);
    expect(describeCapacityWait(capacityWaitFor({ ...room, providerRows: rows })!)).toContain("No other executor is available now.");
  });

  it("orders alternatives by estimated cost when the estimator has one", () => {
    expect(capacityWaitFor({ ...room, costRank: { "grok-desktop": 1, "claude-desktop": 2 } })?.alternatives.map((entry) => entry.executorKind))
      .toEqual(["grok-desktop", "claude-desktop"]);
  });

  // Owner, 2026-11-13: providers also reset early, periodically and at random.
  it("treats an early reset as over: a success after the limit, or a live lease, clears the wait", () => {
    expect(capacityWaitFor({ ...room, providerRows: [{ ...codexLimited, lastSuccessAt: new Date("2026-11-13T18:00:00Z") }] })).toBeNull();
    expect(capacityWaitFor({ ...room, leaseExpiresAt: new Date("2026-11-13T19:50:00Z") })).toBeNull();
    expect(capacityWaitFor({ ...room, providerRows: [{ ...codexLimited, retryAt: new Date("2026-11-13T19:00:00Z") }] })).toBeNull();
  });

  it("uses the executor's own note, superseded by any later lease renewal", () => {
    const checkpoint = { capacity: { provider: "codex", resetAt: RESET.toISOString() }, recordedAt: "2026-11-13T05:40:35Z" };
    expect(capacityWaitFor({ ...room, providerRows: [], checkpoint })).toMatchObject({ source: "executor-checkpoint", resetAt: RESET });
    // The lease (30 min) was renewed at 05:40:35 with the note; a renewal at 07:00 supersedes it.
    expect(capacityWaitFor({ ...room, providerRows: [], checkpoint, leaseExpiresAt: new Date("2026-11-13T07:30:00Z") })).toBeNull();
  });

  it("ignores rooms whose executor has no plan the platform tracks", () => {
    expect(capacityWaitFor({ ...room, executorKind: "build-studio" })).toBeNull();
    expect(capacityWaitFor({ ...room, executorKind: null })).toBeNull();
  });
});

describe("liveness of a plan-limited room", () => {
  const base = { status: "ready", executorKind: "codex-desktop", leaseExpiresAt: lapsed, lastSyncedAt: null, updatedAt: lapsed, pullRequestUrl: null };
  it("reads paused with the reason, and is not reapable after the generic grace while the reset is ahead", () => {
    const later = new Date("2026-11-15T12:00:00Z");
    const capacityWait = capacityWaitFor({ ...room, now: later })!;
    const verdict = classifyWorkCapsuleLiveness({ ...base, capacityWait }, later);
    expect(verdict).toMatchObject({ liveness: "paused", isReapable: false, isLive: true });
    expect(verdict.reason).toContain("Codex plan limit reached; expected back by Mon 16 Nov, 9:54 PM Central");
    expect(classifyWorkCapsuleLiveness(base, later)).toMatchObject({ liveness: "lease-expired", isReapable: true });
  });
});

describe("the heartbeat checkpoint carries a capacity note", () => {
  it("accepts a provider and reset time, and refuses a malformed one", () => {
    expect(parseExecutorCheckpoint({ capacity: { provider: "codex", resetAt: "2026-11-17T03:54:00Z" } }))
      .toMatchObject({ ok: true, data: { capacity: { provider: "codex", resetAt: "2026-11-17T03:54:00.000Z" } } });
    expect(parseExecutorCheckpoint({ capacity: { provider: "codex", resetAt: "Monday" } })).toMatchObject({ ok: false });
    expect(parseCheckpointCapacity({ resetAt: "2026-11-17T03:54:00Z" })).toMatchObject({ ok: false });
  });
});

describe("a supervised runtime turn that failed on its plan limit", () => {
  const parse = (text: string) => /try again at (\S+)/i.exec(text) ? new Date(/try again at (\S+)/i.exec(text)![1]) : null;
  it("names the plan provider and the stated reset", () => {
    expect(runtimePlanLimit("codex", "You've hit your usage limit. Try again at 2026-11-17T03:54:00Z", NOW, parse))
      .toEqual({ provider: "codex", resetAt: new Date("2026-11-17T03:54:00Z") });
  });
  it("still reports a limit with no reset, and ignores other failures", () => {
    expect(runtimePlanLimit("claude", "Claude usage limit reached", NOW, parse)).toEqual({ provider: "anthropic-sub", resetAt: null });
    expect(runtimePlanLimit("codex", "tests failed: 3", NOW, parse)).toBeNull();
    expect(runtimePlanLimit("codex", null, NOW, parse)).toBeNull();
  });
});
