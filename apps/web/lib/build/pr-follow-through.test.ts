import { describe, expect, it } from "vitest";

import type { GithubCheckObservation } from "./github-pr-readiness";
import {
  classifyFailingChecks,
  createPrFollowThrough,
  decidePrFollowThrough,
  projectPrFollowThroughStatus,
  readPrFollowThrough,
  resolvePrRepairAuthority,
  INFRA_RERUN_BOUND,
  type PrFollowThroughV1,
} from "./pr-follow-through";

const failing = (name: string, conclusion: string, workflowRunId: number | null = 7): GithubCheckObservation => ({
  name,
  status: "COMPLETED",
  conclusion,
  detailsUrl: `https://github.com/o/r/actions/runs/${workflowRunId}/job/1`,
  workflowRunId,
});
const passing = (name: string): GithubCheckObservation => ({ name, status: "COMPLETED", conclusion: "SUCCESS" });

const red = { kind: "checking", headSha: "sha1", reason: "checks-failing" } as const;

function decide(input: {
  checks: GithubCheckObservation[];
  followThrough?: PrFollowThroughV1;
  authority?: "dispatch" | "propose" | "record";
  readiness?: Parameters<typeof decidePrFollowThrough>[0]["readiness"];
}) {
  return decidePrFollowThrough({
    followThrough: input.followThrough ?? createPrFollowThrough(),
    readiness: input.readiness ?? red,
    checks: input.checks,
    authority: input.authority ?? "dispatch",
  });
}

describe("classifyFailingChecks", () => {
  it("splits failing checks by phase: a gate that could not run is infrastructure, a failed run is a defect", () => {
    const classified = classifyFailingChecks([
      passing("lint"),
      failing("typecheck", "FAILURE"),
      failing("build", "CANCELLED"),
      failing("e2e", "TIMED_OUT"),
      failing("boot", "STARTUP_FAILURE"),
      failing("legacy-status", "ERROR", null),
      failing("deploy-approval", "ACTION_REQUIRED"),
      { name: "pending", status: "IN_PROGRESS", conclusion: null },
    ]);
    expect(classified.map((c) => [c.name, c.class])).toEqual([
      ["typecheck", "defect"],
      ["build", "infrastructure"],
      ["e2e", "infrastructure"],
      ["boot", "infrastructure"],
      ["legacy-status", "infrastructure"],
      ["deploy-approval", "unclassified"],
    ]);
    expect(classified[0]).toEqual(expect.objectContaining({
      conclusion: "FAILURE",
      runUrl: "https://github.com/o/r/actions/runs/7/job/1",
      workflowRunId: 7,
    }));
  });
});

describe("resolvePrRepairAuthority", () => {
  it("maps the room's proactivity to dispatch, propose or record", () => {
    expect(resolvePrRepairAuthority({ level: "assertive", boundary: "preauthorized" })).toBe("dispatch");
    expect(resolvePrRepairAuthority({ level: "balanced", boundary: "propose" })).toBe("propose");
    // Nothing declared: stage the packet for a person, never act unasked.
    expect(resolvePrRepairAuthority({ level: "balanced", boundary: null })).toBe("propose");
    expect(resolvePrRepairAuthority({ level: "balanced", boundary: "advise" })).toBe("record");
    // A quiet room records and does nothing else, whatever its boundary.
    expect(resolvePrRepairAuthority({ level: "quiet", boundary: "preauthorized" })).toBe("record");
  });
});

describe("decidePrFollowThrough", () => {
  it("re-runs an infrastructure failure once per head, then raises the platform operator", () => {
    const first = decide({ checks: [failing("build", "CANCELLED", 11), failing("e2e", "TIMED_OUT", 12)] });
    expect(first).toEqual(expect.objectContaining({ kind: "rerun-infrastructure", headSha: "sha1", workflowRunIds: [11, 12] }));
    expect(first.followThrough.hold).toBe(null);
    expect(first.followThrough.infraReruns).toEqual({ headSha: "sha1", count: 1 });
    expect(INFRA_RERUN_BOUND).toBe(1);

    const second = decide({ checks: [failing("build", "CANCELLED", 11)], followThrough: first.followThrough });
    expect(second).toEqual(expect.objectContaining({
      kind: "attention",
      target: "platform-operator",
      reason: "infrastructure-persists",
    }));
    expect(second.followThrough.hold).toBe("awaiting-person");
    // The infra budget never spends the repair budget.
    expect(second.followThrough.attempts.attempts["post-push-ci-failure"]).toBeUndefined();
  });

  it("raises the operator when an infrastructure failure has no workflow run to re-run", () => {
    const decision = decide({ checks: [failing("legacy-status", "ERROR", null)] });
    expect(decision).toEqual(expect.objectContaining({ kind: "attention", target: "platform-operator", reason: "infrastructure-not-rerunnable" }));
  });

  it("dispatches a bounded repair for a defect at full proactivity, charging the budget once per head", () => {
    const first = decide({ checks: [failing("typecheck", "FAILURE"), failing("build", "CANCELLED")] });
    expect(first.kind).toBe("repair");
    if (first.kind !== "repair") throw new Error("expected repair");
    expect(first.mode).toBe("dispatch");
    expect(first.packet).toEqual(expect.objectContaining({
      headSha: "sha1",
      failureClass: "post-push-ci-failure",
      attempt: 1,
      bound: 2,
    }));
    expect(first.packet.failingChecks.map((c) => c.name)).toEqual(["typecheck", "build"]);
    expect(first.followThrough.hold).toBe("repairing");
    expect(first.followThrough.judgedHeadSha).toBe("sha1");
    expect(first.followThrough.attempts.attempts["post-push-ci-failure"]).toBe(1);

    // The same head is never judged twice.
    const again = decide({ checks: [failing("typecheck", "FAILURE")], followThrough: first.followThrough });
    expect(again).toEqual(expect.objectContaining({ kind: "hold", headSha: "sha1" }));
    expect(again.followThrough.attempts.attempts["post-push-ci-failure"]).toBe(1);

    // The repair's new head is what the next observation judges.
    const second = decide({
      checks: [failing("typecheck", "FAILURE")],
      followThrough: again.followThrough,
      readiness: { kind: "checking", headSha: "sha2", reason: "checks-failing" },
    });
    expect(second.kind).toBe("repair");
    expect(second.followThrough.attempts.attempts["post-push-ci-failure"]).toBe(2);

    const exhausted = decide({
      checks: [failing("typecheck", "FAILURE")],
      followThrough: second.followThrough,
      readiness: { kind: "checking", headSha: "sha3", reason: "checks-failing" },
    });
    expect(exhausted).toEqual(expect.objectContaining({
      kind: "attention",
      target: "process-overseer",
      reason: "repair-budget-exhausted",
      headSha: "sha3",
    }));
    expect(exhausted.followThrough.hold).toBe("awaiting-person");
  });

  it("stages the repair packet for a person below full proactivity, spending no budget", () => {
    const proposed = decide({ checks: [failing("typecheck", "FAILURE")], authority: "propose" });
    expect(proposed).toEqual(expect.objectContaining({ kind: "repair", mode: "propose" }));
    expect(proposed.followThrough.hold).toBe("awaiting-person");
    expect(proposed.followThrough.attempts.attempts["post-push-ci-failure"]).toBeUndefined();

    const recorded = decide({ checks: [failing("typecheck", "FAILURE")], authority: "record" });
    expect(recorded).toEqual(expect.objectContaining({ kind: "repair", mode: "record" }));
    expect(recorded.followThrough.attempts.attempts["post-push-ci-failure"]).toBeUndefined();
  });

  it("sends a failure it cannot classify to a person instead of guessing", () => {
    const decision = decide({ checks: [failing("deploy-approval", "ACTION_REQUIRED")] });
    expect(decision).toEqual(expect.objectContaining({ kind: "attention", target: "process-overseer", reason: "unclassified-check-failure" }));
  });

  it("clears a hold when the head moves and CI is no longer red", () => {
    const held = decide({ checks: [failing("typecheck", "FAILURE")] }).followThrough;
    const cleared = decide({
      checks: [],
      followThrough: held,
      readiness: { kind: "checking", headSha: "sha2", reason: "checks-pending" },
    });
    expect(cleared.kind).toBe("none");
    expect(cleared.followThrough.hold).toBe(null);
    expect(cleared.followThrough.failing).toEqual([]);
    // The budget belongs to the PR's head lineage, not one head.
    expect(cleared.followThrough.attempts.attempts["post-push-ci-failure"]).toBe(1);

    // Same head, still pending: the hold is kept (a re-run is in flight).
    const sameHead = decide({
      checks: [],
      followThrough: held,
      readiness: { kind: "checking", headSha: "sha1", reason: "checks-pending" },
    });
    expect(sameHead.followThrough.hold).toBe("repairing");
  });
});

describe("projectPrFollowThroughStatus", () => {
  const base = { status: "checking" as const, followThrough: createPrFollowThrough() };
  it("projects one follow-through status for every room", () => {
    expect(projectPrFollowThroughStatus(null)).toBe(null);
    expect(projectPrFollowThroughStatus(base)).toBe("watching");
    expect(projectPrFollowThroughStatus({ ...base, status: "created" })).toBe("watching");
    expect(projectPrFollowThroughStatus({ ...base, status: "updating" })).toBe("watching");
    expect(projectPrFollowThroughStatus({ ...base, status: "queued" })).toBe("queued");
    expect(projectPrFollowThroughStatus({ ...base, status: "awaiting-release" })).toBe("merged");
    expect(projectPrFollowThroughStatus({ ...base, status: "deployed" })).toBe("merged");
    expect(projectPrFollowThroughStatus({ ...base, status: "closed" })).toBe("closed");
    expect(projectPrFollowThroughStatus({ ...base, status: "escalated" })).toBe("awaiting-person");
    expect(projectPrFollowThroughStatus({ ...base, followThrough: { ...base.followThrough, hold: "repairing" } })).toBe("repairing");
    expect(projectPrFollowThroughStatus({ ...base, followThrough: { ...base.followThrough, hold: "awaiting-person" } })).toBe("awaiting-person");
  });
});

describe("readPrFollowThrough", () => {
  it("round-trips and fails soft to an empty record", () => {
    const decided = decide({ checks: [failing("typecheck", "FAILURE")] }).followThrough;
    expect(readPrFollowThrough(JSON.parse(JSON.stringify(decided)))).toEqual(decided);
    expect(readPrFollowThrough(undefined)).toEqual(createPrFollowThrough());
    expect(readPrFollowThrough({ hold: "bogus", failing: "x", attempts: 3 })).toEqual(createPrFollowThrough());
  });
});
