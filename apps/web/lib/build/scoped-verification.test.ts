import { describe, expect, it } from "vitest";
import { buildScopedVerificationFromParts, extractFilePathsFromText } from "./scoped-verification";
import { normalizeVerificationOutput } from "./verification-output";

describe("extractFilePathsFromText", () => {
  it("extracts app and package file paths", () => {
    expect(extractFilePathsFromText("failed apps/web/lib/foo.test.ts and packages/db/prisma/schema.prisma")).toEqual([
      "apps/web/lib/foo.test.ts",
      "packages/db/prisma/schema.prisma",
    ]);
  });
});

describe("buildScopedVerificationFromParts", () => {
  it("classifies failures outside the changed surface as out-of-scope noise", () => {
    const verification = buildScopedVerificationFromParts({
      verification: normalizeVerificationOutput({
        typecheckPassed: false,
        testsPassed: 0,
        testsFailed: 192,
        fullOutput: "FAIL apps/web/lib/mcp-tools-save-build-evidence.test.ts",
        timestamp: "2026-05-18T12:00:00.000Z",
      }),
      changedFiles: ["apps/web/components/build/BuildSandboxCard.tsx"],
      dispatchHistory: [],
    });

    expect(verification.buildScoped.failureAxis).toBe("out-of-scope-noise");
    expect(verification.globalHealth.testsFailed).toBe(192);
  });

  it("keeps unknown axis when no changed-file set is available", () => {
    const verification = buildScopedVerificationFromParts({
      verification: normalizeVerificationOutput({
        typecheckPassed: false,
        testsFailed: 1,
        fullOutput: "FAIL apps/web/lib/foo.test.ts",
      }),
      changedFiles: [],
      dispatchHistory: [],
    });

    expect(verification.buildScoped.affectedFiles).toEqual([]);
    expect(verification.buildScoped.failureAxis).toBe("unknown");
  });
});
