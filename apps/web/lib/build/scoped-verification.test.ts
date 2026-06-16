import { describe, expect, it } from "vitest";
import {
  buildScopedVerificationFromParts,
  extractFilePathsFromText,
  extractTypecheckErrorFiles,
  scopeVerificationOutputForGate,
  typecheckPassedForChangedScope,
} from "./scoped-verification";
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

describe("scopeVerificationOutputForGate", () => {
  it("neutralizes an out-of-scope failure so the gate advances", () => {
    const gate = scopeVerificationOutputForGate({
      verification: normalizeVerificationOutput({
        typecheckPassed: false,
        testsPassed: 0,
        testsFailed: 192,
        fullOutput: "FAIL apps/web/app/(shell)/platform/identity/applications/page.tsx Unexpected JSX expression",
      }),
      changedFiles: ["apps/web/lib/utils/semanticIdClassifier.ts"],
    });

    expect(gate.outOfScopeNoise).toBe(true);
    expect(gate.typecheckPassed).toBe(true);
    expect(gate.testsFailed).toBe(0);
    // Full-repo signal preserved for visibility.
    expect(gate.globalTestsFailed).toBe(192);
    expect(gate.failureAxis).toBe("out-of-scope-noise");
  });

  it("keeps an in-scope failure blocking", () => {
    const gate = scopeVerificationOutputForGate({
      verification: normalizeVerificationOutput({
        typecheckPassed: false,
        testsFailed: 1,
        fullOutput: "FAIL apps/web/lib/utils/semanticIdClassifier.test.ts",
      }),
      changedFiles: ["apps/web/lib/utils/semanticIdClassifier.ts"],
    });

    expect(gate.outOfScopeNoise).toBe(false);
    expect(gate.typecheckPassed).toBe(false);
  });

  it("passes the raw verdict through when no changed-file scope is known", () => {
    const gate = scopeVerificationOutputForGate({
      verification: normalizeVerificationOutput({
        typecheckPassed: false,
        testsFailed: 3,
        fullOutput: "FAIL apps/web/lib/foo.test.ts",
      }),
      changedFiles: [],
    });

    expect(gate.outOfScopeNoise).toBe(false);
    expect(gate.typecheckPassed).toBe(false);
  });
});

describe("typecheckPassedForChangedScope", () => {
  it("passes when there are no TS errors", () => {
    expect(typecheckPassedForChangedScope("", ["apps/web/lib/foo.ts"]).passed).toBe(true);
  });

  it("passes when every TS error is outside the changed surface", () => {
    const out = [
      "app/(shell)/platform/identity/applications/page.tsx(12,5): error TS1005: ';' expected.",
      "lib/other/unrelated.ts(3,1): error TS2304: Cannot find name 'foo'.",
    ].join("\n");
    const result = typecheckPassedForChangedScope(out, ["apps/web/lib/utils/semanticIdClassifier.ts"]);
    expect(result.passed).toBe(true);
    expect(result.outOfScopeErrorFiles.length).toBe(2);
    expect(result.inScopeErrorFiles).toEqual([]);
  });

  it("fails when an in-scope file has a TS error (pretty format)", () => {
    const out = "lib/utils/semanticIdClassifier.ts:9:3 - error TS2345: Argument of type ...";
    const result = typecheckPassedForChangedScope(out, ["apps/web/lib/utils/semanticIdClassifier.ts"]);
    expect(result.passed).toBe(false);
    expect(result.inScopeErrorFiles.length).toBe(1);
  });

  it("fails legacy-style when errors exist but no scope is provided", () => {
    expect(typecheckPassedForChangedScope("foo.ts(1,1): error TS1: x", []).passed).toBe(false);
  });

  it("fails conservatively when errors are present but unattributable", () => {
    expect(typecheckPassedForChangedScope("error TS9999: internal", ["apps/web/lib/foo.ts"]).passed).toBe(false);
  });
});

describe("extractTypecheckErrorFiles", () => {
  it("handles both pretty and non-pretty tsc formats", () => {
    const out = [
      "lib/a.tsx(12,5): error TS1005: ';' expected.",
      "lib/b.ts:3:1 - error TS2304: Cannot find name.",
      "./lib/c.mts(1,1): error TS1: x",
    ].join("\n");
    expect(extractTypecheckErrorFiles(out)).toEqual(["lib/a.tsx", "lib/b.ts", "lib/c.mts"]);
  });
});
