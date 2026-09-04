import { describe, expect, it } from "vitest";

import { classifyWorkCapsuleLiveness, type CapsuleLivenessInput } from "./liveness";

const NOW = new Date("2026-08-05T15:00:00.000Z");

function row(overrides: Partial<CapsuleLivenessInput> = {}): CapsuleLivenessInput {
  return {
    status: "working",
    executorKind: "build-studio",
    leaseExpiresAt: null,
    lastSyncedAt: null,
    updatedAt: NOW,
    pullRequestUrl: null,
    pullRequestNumber: null,
    featureBuild: null,
    ...overrides,
  };
}

describe("classifyWorkCapsuleLiveness", () => {
  it("REGRESSION (BI-CBAAEA94): a null-lease build-studio capsule frozen at 14:00 is NOT live", () => {
    // The exact sprawl shape: born at the daily tee-up, build stalled, never
    // written again. updatedAt == createdAt == 14:00 on a prior day.
    const v = classifyWorkCapsuleLiveness(
      row({ status: "working", updatedAt: new Date("2026-08-02T14:00:01.000Z") }),
      NOW,
    );
    expect(v.isLive).toBe(false);
    expect(v.isReapable).toBe(true);
    expect(v.liveness).toBe("idle-stale");
    // Crucially, updatedAt is NOT treated as the liveness timestamp.
    expect(v.trueLivenessAt).toBeNull();
  });

  it("treats a RECENTLY expired lease as PAUSED (token-limited session may resume), not reapable", () => {
    // A lease that lapsed only 1h ago is within the resume grace: a token-limited
    // Claude/Codex/Grok session commonly returns when its usage window resets, so
    // the room must NOT be reaped yet — but it is also not confidently live.
    const v = classifyWorkCapsuleLiveness(
      row({
        executorKind: "codex-desktop",
        leaseExpiresAt: new Date("2026-08-05T14:00:00.000Z"), // 1h ago
        lastSyncedAt: new Date("2026-08-05T13:00:00.000Z"),
        updatedAt: NOW, // freshly bumped, but must not read as live
      }),
      NOW,
    );
    expect(v.liveness).toBe("paused");
    expect(v.isLive).toBe(true); // never shown as dead while it may resume
    expect(v.isReapable).toBe(false); // never reaped inside the grace
    expect(v.disposition).toBeNull();
    expect(v.trueLivenessAt).toEqual(new Date("2026-08-05T14:00:00.000Z"));
  });

  it("treats a lease expired PAST the resume grace as dead (lease-expired → abandon)", () => {
    const v = classifyWorkCapsuleLiveness(
      row({
        executorKind: "codex-desktop",
        leaseExpiresAt: new Date("2026-08-04T00:00:00.000Z"), // ~39h ago, past 24h grace
        updatedAt: NOW,
      }),
      NOW,
    );
    expect(v.liveness).toBe("lease-expired");
    expect(v.isLive).toBe(false);
    expect(v.isReapable).toBe(true);
    expect(v.disposition).toBe("abandoned"); // dead + UNMERGED → protect the branch
  });

  it("honours a caller-supplied pause grace (0 grace ⇒ expired lease is immediately dead)", () => {
    const v = classifyWorkCapsuleLiveness(
      row({ executorKind: "codex-desktop", leaseExpiresAt: new Date("2026-08-05T14:00:00.000Z") }),
      NOW,
      undefined,
      0, // no grace
    );
    expect(v.liveness).toBe("lease-expired");
    expect(v.isReapable).toBe(true);
  });

  it("classifies a MERGED room as DELIVERED (archive), overriding lease state — procedural, no LLM", () => {
    // deliveredSignal is computed by the caller from LOCAL git reachability.
    const v = classifyWorkCapsuleLiveness(
      row({
        executorKind: "grok-cli",
        leaseExpiresAt: new Date("2026-08-05T14:00:00.000Z"), // within grace: would be `paused`…
        deliveredSignal: { merged: true }, // …but merged wins.
      }),
      NOW,
    );
    expect(v.liveness).toBe("delivered");
    expect(v.isLive).toBe(false); // delivered work is closed out, not "active"
    expect(v.isReapable).toBe(true);
    expect(v.disposition).toBe("delivered"); // archive, and its branch is safe to reap
    expect(v.reason).toContain("merged");
  });

  it("delivered wins over a still-valid lease", () => {
    const v = classifyWorkCapsuleLiveness(
      row({
        executorKind: "grok-cli",
        leaseExpiresAt: new Date("2026-08-05T16:00:00.000Z"), // valid lease
        deliveredSignal: { merged: true },
      }),
      NOW,
    );
    expect(v.liveness).toBe("delivered");
    expect(v.disposition).toBe("delivered");
  });

  it("an UNMERGED delivered signal is inert (deliveredSignal.merged=false ⇒ normal liveness)", () => {
    const v = classifyWorkCapsuleLiveness(
      row({ executorKind: "grok-cli", leaseExpiresAt: new Date("2026-08-05T16:00:00.000Z"), deliveredSignal: { merged: false } }),
      NOW,
    );
    expect(v.liveness).toBe("live"); // valid lease, not merged
    expect(v.disposition).toBeNull();
  });

  it("treats a valid lease as live", () => {
    const v = classifyWorkCapsuleLiveness(
      row({ executorKind: "codex-desktop", leaseExpiresAt: new Date("2026-08-05T15:20:00.000Z") }),
      NOW,
    );
    expect(v.liveness).toBe("live");
    expect(v.isLive).toBe(true);
    expect(v.isReapable).toBe(false);
  });

  it("keeps an expired Workroom lease live while its exact worktree has a durable capacity wait", () => {
    const v = classifyWorkCapsuleLiveness(
      row({
        executorKind: "codex-desktop",
        leaseExpiresAt: new Date("2026-08-05T14:00:00.000Z"),
        durableWait: { state: "queued", signaledAt: new Date("2026-08-05T14:55:00.000Z") },
      }),
      NOW,
    );
    expect(v.liveness).toBe("durable-wait");
    expect(v.isLive).toBe(true);
    expect(v.isReapable).toBe(false);
  });

  it("treats an open PR as live even after the authoring lease lapsed", () => {
    const v = classifyWorkCapsuleLiveness(
      row({
        executorKind: "codex-desktop",
        leaseExpiresAt: new Date("2026-08-04T00:00:00.000Z"), // long expired
        pullRequestNumber: 4055,
      }),
      NOW,
    );
    expect(v.liveness).toBe("live");
    expect(v.isReapable).toBe(false);
    expect(v.reason).toContain("#4055");
  });

  it("marks a capsule dead when its linked build is terminal (zombie BS capsule)", () => {
    const v = classifyWorkCapsuleLiveness(
      row({
        status: "working",
        featureBuild: { phase: "abandoned", lastActivityAt: new Date("2026-08-02T09:00:00.000Z") },
      }),
      NOW,
    );
    expect(v.liveness).toBe("build-terminal");
    expect(v.isLive).toBe(false);
    expect(v.isReapable).toBe(true);
  });

  it("keeps a null-lease capsule live while its build is recently active", () => {
    const v = classifyWorkCapsuleLiveness(
      row({
        featureBuild: { phase: "build", lastActivityAt: new Date("2026-08-05T14:50:00.000Z") }, // 10m ago
      }),
      NOW,
    );
    expect(v.liveness).toBe("live");
    expect(v.isReapable).toBe(false);
    expect(v.trueLivenessAt).toEqual(new Date("2026-08-05T14:50:00.000Z"));
  });

  it("flags a null-lease capsule idle-stale when its build went silent past the floor", () => {
    const v = classifyWorkCapsuleLiveness(
      row({
        featureBuild: { phase: "build", lastActivityAt: new Date("2026-08-05T05:00:00.000Z") }, // 10h ago
      }),
      NOW,
    );
    expect(v.liveness).toBe("idle-stale");
    expect(v.isReapable).toBe(true);
  });

  it("withholds judgment on a brand-new null-lease capsule (no-signal, still live-ish)", () => {
    const v = classifyWorkCapsuleLiveness(
      row({ updatedAt: new Date("2026-08-05T14:40:00.000Z") }), // born 20m ago
      NOW,
    );
    expect(v.liveness).toBe("no-signal");
    expect(v.isLive).toBe(true); // recent — never shown as dead
    expect(v.isReapable).toBe(false); // but never reaped either
  });

  it("never reaps a capsule that is already terminal", () => {
    const v = classifyWorkCapsuleLiveness(
      row({ status: "abandoned", updatedAt: new Date("2026-06-01T14:00:00.000Z") }),
      NOW,
    );
    expect(v.liveness).toBe("terminal");
    expect(v.isReapable).toBe(false);
    expect(v.isLive).toBe(false);
  });

  it("prefers a still-fresh sync over the idle floor for adopted worktrees", () => {
    const v = classifyWorkCapsuleLiveness(
      row({
        executorKind: null,
        lastSyncedAt: new Date("2026-08-05T14:30:00.000Z"), // 30m ago
      }),
      NOW,
    );
    expect(v.liveness).toBe("live");
    expect(v.trueLivenessAt).toEqual(new Date("2026-08-05T14:30:00.000Z"));
  });
});
