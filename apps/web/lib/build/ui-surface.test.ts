import { describe, expect, it } from "vitest";
import {
  buildHasUiSurface,
  isUiSurfaceFile,
  shouldRunBrowserUxVerification,
} from "./ui-surface";

describe("isUiSurfaceFile", () => {
  it("treats React components and Next pages/layouts as UI surfaces", () => {
    expect(isUiSurfaceFile("apps/web/app/(shell)/build/page.tsx")).toBe(true);
    expect(isUiSurfaceFile("apps/web/app/(shell)/layout.tsx")).toBe(true);
    expect(isUiSurfaceFile("apps/web/components/build/ReviewPanel.tsx")).toBe(true);
    expect(isUiSurfaceFile("apps/web/components/Thing.jsx")).toBe(true);
  });

  it("does not treat libraries, server code, route handlers, docs, or schema as UI", () => {
    expect(isUiSurfaceFile("apps/web/lib/utils/string-helpers.ts")).toBe(false);
    expect(isUiSurfaceFile("apps/web/lib/utils/string-helpers.test.ts")).toBe(false);
    expect(isUiSurfaceFile("apps/web/app/api/decisions/ledger/route.ts")).toBe(false);
    expect(isUiSurfaceFile("packages/db/prisma/schema.prisma")).toBe(false);
    expect(isUiSurfaceFile("UTILITY_ANALYSIS.md")).toBe(false);
    expect(isUiSurfaceFile("scripts/seed.ts")).toBe(false);
  });

  it("ignores empty/whitespace paths", () => {
    expect(isUiSurfaceFile("")).toBe(false);
    expect(isUiSurfaceFile("   ")).toBe(false);
  });
});

describe("buildHasUiSurface", () => {
  it("is true when any changed file is a UI surface", () => {
    expect(
      buildHasUiSurface([
        "apps/web/lib/data.ts",
        "apps/web/components/build/ReviewPanel.tsx",
      ]),
    ).toBe(true);
  });

  it("is false for a pure library/backend change set (the truncateMiddle strand)", () => {
    expect(
      buildHasUiSurface([
        "UTILITY_ANALYSIS.md",
        "apps/web/lib/utils/string-helpers.test.ts",
        "apps/web/lib/utils/string-helpers.ts",
      ]),
    ).toBe(false);
  });

  it("is false for an empty change set", () => {
    expect(buildHasUiSurface([])).toBe(false);
  });
});

describe("shouldRunBrowserUxVerification", () => {
  it("skips when there are no acceptance criteria", () => {
    expect(
      shouldRunBrowserUxVerification({
        testCaseCount: 0,
        changedFiles: ["apps/web/app/(shell)/build/page.tsx"],
      }),
    ).toBe(false);
  });

  it("skips a pure non-UI build even when it has acceptance criteria", () => {
    // This is the FB-FD850A2C strand: a string helper with 5 code-level ACs and
    // no page to drive must NOT run browser-use (which returns a vacuous 0/1).
    expect(
      shouldRunBrowserUxVerification({
        testCaseCount: 5,
        changedFiles: [
          "apps/web/lib/utils/string-helpers.ts",
          "apps/web/lib/utils/string-helpers.test.ts",
        ],
      }),
    ).toBe(false);
  });

  it("runs when a UI surface changed and there are acceptance criteria", () => {
    expect(
      shouldRunBrowserUxVerification({
        testCaseCount: 3,
        changedFiles: ["apps/web/app/(shell)/build/page.tsx"],
      }),
    ).toBe(true);
  });

  it("preserves legacy behavior (runs) when changed files are unknown", () => {
    // A briefly-unavailable diff projection must not silently disable UX
    // verification fleet-wide — with no changed-file signal we still run it.
    expect(
      shouldRunBrowserUxVerification({ testCaseCount: 2, changedFiles: [] }),
    ).toBe(true);
  });
});
