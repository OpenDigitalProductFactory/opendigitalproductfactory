// apps/web/lib/build/sandbox-driver.test.ts
//
// Pins the deterministic-driver contract called out by the peer reviewer:
//   R1 deterministic driver, R2 port validation, R3 single shared link.
// These tests live with the helper, not the button, because the helper is
// what makes the contract testable in isolation.

import { describe, expect, it } from "vitest";

import {
  computeDrivingBuild,
  formatSandboxLabel,
  isValidSandboxPort,
  type SandboxDriverCandidate,
} from "./sandbox-driver";

function candidate(
  buildCode: string,
  sandboxPort: number | null,
  lastActivityAt: Date | null,
): SandboxDriverCandidate {
  return { buildCode, sandboxPort, lastActivityAt };
}

describe("isValidSandboxPort", () => {
  it("accepts integers in the TCP range (1-65535)", () => {
    expect(isValidSandboxPort(1)).toBe(true);
    expect(isValidSandboxPort(3000)).toBe(true);
    expect(isValidSandboxPort(65535)).toBe(true);
  });

  it.each([null, undefined, 0, -1, 65536, NaN, Infinity, -Infinity, 3.14])(
    "rejects %s",
    (input) => {
      expect(isValidSandboxPort(input as number | null | undefined)).toBe(false);
    },
  );
});

describe("computeDrivingBuild", () => {
  it("returns null when the candidate list is empty", () => {
    expect(computeDrivingBuild([])).toBeNull();
  });

  it("returns null when no candidate has a live port", () => {
    expect(
      computeDrivingBuild([
        candidate("FB-AAA", null, new Date()),
        candidate("FB-BBB", 0, new Date()),
      ]),
    ).toBeNull();
  });

  it("returns the only live candidate", () => {
    const result = computeDrivingBuild([
      candidate("FB-AAA", null, new Date()),
      candidate("FB-BBB", 3000, new Date()),
      candidate("FB-CCC", 0, new Date()),
    ]);
    expect(result?.buildCode).toBe("FB-BBB");
  });

  it("picks the most recently active when multiple are live", () => {
    const older = new Date("2026-05-20T00:00:00Z");
    const newer = new Date("2026-05-21T05:00:00Z");
    const result = computeDrivingBuild([
      candidate("FB-OLD", 3000, older),
      candidate("FB-NEW", 3001, newer),
      candidate("FB-MID", 3002, new Date("2026-05-20T12:00:00Z")),
    ]);
    expect(result?.buildCode).toBe("FB-NEW");
  });

  it("sorts candidates with null lastActivityAt LAST", () => {
    const result = computeDrivingBuild([
      candidate("FB-NULL", 3000, null),
      candidate("FB-DATED", 3001, new Date("2026-05-20T00:00:00Z")),
    ]);
    expect(result?.buildCode).toBe("FB-DATED");
  });

  it("breaks deeper ties by buildCode ascending — deterministic across renders", () => {
    const sameTime = new Date("2026-05-21T05:00:00Z");
    const result = computeDrivingBuild([
      candidate("FB-ZZZ", 3000, sameTime),
      candidate("FB-AAA", 3001, sameTime),
      candidate("FB-MMM", 3002, sameTime),
    ]);
    expect(result?.buildCode).toBe("FB-AAA");
  });

  it("filters port validation before tie-breaking", () => {
    // FB-BAD has the most recent timestamp but an invalid port — must NOT win.
    const result = computeDrivingBuild([
      candidate("FB-BAD", 0, new Date("2026-05-21T06:00:00Z")),
      candidate("FB-GOOD", 3000, new Date("2026-05-20T00:00:00Z")),
    ]);
    expect(result?.buildCode).toBe("FB-GOOD");
  });
});

describe("formatSandboxLabel", () => {
  it("renders the driving build code when provided", () => {
    expect(formatSandboxLabel("FB-B33E84B5")).toBe("Open live preview · driving: FB-B33E84B5");
  });

  it('renders "idle" when there is no driver', () => {
    expect(formatSandboxLabel(null)).toBe("Open live preview · driving: idle");
  });
});
