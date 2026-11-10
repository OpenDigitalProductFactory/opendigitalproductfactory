import { describe, expect, it } from "vitest";

import {
  classifyInterruption,
  parseInterruptionTrail,
} from "@/lib/self-upgrade/interruption-trail";

const SHA = "d2f76addcafe0000000000000000000000000000";
const OTHER = "0badc0de00000000000000000000000000000000";

function line(step: string, targetSha = SHA, mode = "real", at = "2026-09-06T23:00:00Z") {
  return `${at}\t${mode}\t${step}\t${targetSha}`;
}

describe("parseInterruptionTrail", () => {
  it("skips a torn final line rather than throwing", () => {
    // promote.sh is killed mid-write by exactly the events this feature exists
    // for, so a partial last line is an expected input, not a fault.
    const entries = parseInterruptionTrail(`${line("prepare")}\n2026-09-06T23:01:00Z\treal\tdock`);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.step).toBe("prepare");
  });

  it("skips blank and malformed lines", () => {
    expect(parseInterruptionTrail("\n\n\t\t\t\nnot-a-trail-line\n")).toEqual([]);
  });
});

describe("classifyInterruption", () => {
  it("proves the swap had not started when the newest step precedes docker-up", () => {
    const trail = [line("prepare"), line("backup"), line("docker-build")].join("\n");
    const result = classifyInterruption(trail, SHA);
    expect(result.swapApplied).toBe(false);
    expect(result.lastStep).toBe("docker-build");
    expect(result.basis).toBe("pre-swap-step");
  });

  it("treats migrate as pre-swap — migrations run before the container is replaced", () => {
    // Forward-only migrations are re-applied by nothing on a retry; it is the
    // CONTAINER swap that makes a re-run unsafe.
    expect(classifyInterruption(line("migrate"), SHA).swapApplied).toBe(false);
  });

  it("refuses to conclude once the swap step itself is reached", () => {
    const trail = [line("docker-build"), line("docker-up")].join("\n");
    const result = classifyInterruption(trail, SHA);
    expect(result.swapApplied).toBeNull();
    expect(result.basis).toBe("step-at-or-past-swap");
  });

  it("refuses to conclude for a step this portal does not recognise", () => {
    // A promote.sh newer than the portal is ordinary mid-rollout. An unknown
    // step must never be guessed onto the safe side of the boundary.
    const result = classifyInterruption(line("some-future-step"), SHA);
    expect(result.swapApplied).toBeNull();
    expect(result.basis).toBe("unrecognized-step");
    expect(result.lastStep).toBe("some-future-step");
  });

  it("uses only the newest entry, so an earlier pre-swap step cannot mask a later swap", () => {
    const trail = [line("docker-up"), line("prepare")].join("\n");
    expect(classifyInterruption(trail, SHA).swapApplied).toBe(false);
    const reversed = [line("prepare"), line("docker-up")].join("\n");
    expect(classifyInterruption(reversed, SHA).swapApplied).toBeNull();
  });

  it("ignores dry-run entries, which never touch the install", () => {
    const trail = [line("docker-up"), line("prepare", SHA, "dry-run")].join("\n");
    expect(classifyInterruption(trail, SHA).swapApplied).toBeNull();
  });

  it("ignores entries for a different target", () => {
    const trail = [line("prepare"), line("docker-up", OTHER)].join("\n");
    const result = classifyInterruption(trail, SHA);
    expect(result.swapApplied).toBe(false);
    expect(result.lastStep).toBe("prepare");
  });

  it("matches the target case-insensitively", () => {
    expect(classifyInterruption(line("prepare", SHA.toUpperCase()), SHA).swapApplied).toBe(false);
  });

  it("is unknown when no trail exists — an install whose promoter predates it", () => {
    expect(classifyInterruption(null, SHA).swapApplied).toBeNull();
    expect(classifyInterruption(null, SHA).basis).toBe("no-trail");
  });

  it("is unknown when the trail holds nothing for this target", () => {
    const result = classifyInterruption(line("docker-build", OTHER), SHA);
    expect(result.swapApplied).toBeNull();
    expect(result.basis).toBe("no-entry-for-target");
  });

  it("is unknown when the run has no target SHA", () => {
    expect(classifyInterruption(line("prepare"), null).swapApplied).toBeNull();
  });
});
