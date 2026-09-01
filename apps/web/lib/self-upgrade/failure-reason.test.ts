import { describe, expect, it } from "vitest";
import { describeFailureReason } from "./failure-reason";
import { deriveFailureReason, FAILURE_REASON_MAX } from "./build-failure-classifier";

// The gap these close: `skipRun` always wrote a structured `reason` the panel
// renders in plain language; `failRun` wrote only `failureLog`. Measured on the
// live install, 55 of 55 failed runs carried no reason, which hid two multi-day
// outages (four consecutive daily failures 2026-07-26..29, and the Git-LFS
// breakage of 2026-08-29).

describe("deriveFailureReason", () => {
  it("names a known failure class from the raw build log", () => {
    const log = [
      "#42 [portal build 16/18] RUN pnpm install --frozen-lockfile",
      "#42 12.4 ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with frozen-lockfile",
      "#42 ERROR: process did not complete successfully: exit code: 1",
    ].join("\n");
    expect(deriveFailureReason(log)).toBe("pnpm-install-failure");
  });

  // The pipeline's own wrappers are already the right shape; keep them rather
  // than flattening everything to "unknown".
  it("keeps a structured wrapper line when no class matches", () => {
    const reason = deriveFailureReason(
      "lfs-unmaterialized: Git LFS objects were not materialized in the upgrade workspace",
    );
    expect(reason.startsWith("lfs-unmaterialized:")).toBe(true);
  });

  it("still says something for an unrecognised log", () => {
    const reason = deriveFailureReason("something went sideways\nmore detail");
    expect(reason).toContain("something went sideways");
    expect(reason.startsWith("unknown")).toBe(true);
  });

  it("never returns an empty reason", () => {
    for (const input of ["", "   ", "\n\n"]) {
      expect(deriveFailureReason(input)).toBe("unknown");
    }
  });

  it("bounds the reason so a run row never carries a whole build log", () => {
    const reason = deriveFailureReason("x".repeat(5000));
    expect(reason.length).toBeLessThanOrEqual(FAILURE_REASON_MAX);
  });
});

describe("describeFailureReason", () => {
  it("returns null when there is genuinely no reason recorded", () => {
    expect(describeFailureReason(null)).toBeNull();
    expect(describeFailureReason("")).toBeNull();
    expect(describeFailureReason("   ")).toBeNull();
  });

  it("explains a known class in plain language, with no jargon", () => {
    const why = describeFailureReason("host-out-of-memory");
    expect(why).not.toBeNull();
    expect(why!.title).toBe("The server ran out of memory");
    expect(why!.retryable).toBe(true);
    for (const jargon of ["OOMKilled", "buildkit", "SHA", "exit code"]) {
      expect(`${why!.title} ${why!.detail}`).not.toContain(jargon);
    }
  });

  it("reads the class out of a `class: detail` reason", () => {
    expect(describeFailureReason("promoter-readiness-failed: promoter image missing")!.title).toBe(
      "The updater wasn't ready",
    );
  });

  it("marks the cases a retry cannot fix", () => {
    expect(describeFailureReason("merge-conflict: 3 files")!.retryable).toBe(false);
    expect(describeFailureReason("dirty-tree")!.retryable).toBe(false);
    expect(describeFailureReason("pnpm-install-failure")!.retryable).toBe(true);
  });

  // An unmapped key must still say SOMETHING — showing the raw key to an
  // operator is the failure this whole change exists to remove.
  it("degrades to a generic explanation rather than leaking the raw key", () => {
    const why = describeFailureReason("some-future-class: whatever");
    expect(why).not.toBeNull();
    expect(why!.title).toBe("The update didn't finish");
    expect(`${why!.title} ${why!.detail}`).not.toContain("some-future-class");
  });
});
