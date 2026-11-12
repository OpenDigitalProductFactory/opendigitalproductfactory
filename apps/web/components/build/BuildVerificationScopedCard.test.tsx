// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BuildVerificationScopedCard } from "./BuildVerificationScopedCard";
import type { ScopedVerificationView } from "@/lib/build/scoped-verification";

afterEach(cleanup);

function makeVerification(): ScopedVerificationView {
  return {
    source: "verification",
    observedAt: "2026-05-18T12:00:00.000Z",
    buildScoped: {
      typecheckPassed: null,
      testsPassed: null,
      testsFailed: null,
      failureAxis: "out-of-scope-noise",
      affectedFiles: ["apps/web/components/build/BuildVerificationScopedCard.tsx"],
      affectedTests: [],
    },
    globalHealth: {
      testsFailed: 192,
      outputExcerpt: "FAIL apps/web/lib/mcp-tools-save-build-evidence.test.ts",
    },
  };
}

describe("BuildVerificationScopedCard", () => {
  it("keeps missing workspace results distinct from zero failures", () => {
    const value = makeVerification();
    value.buildScoped.failureAxis = null;
    value.globalHealth.testsFailed = null;
    render(<BuildVerificationScopedCard verification={value} />);
    expect(screen.getByText("Unverified", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Not verified", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("0 failed test(s)")).not.toBeInTheDocument();
  });
  it("separates build-scoped verification from global workspace health", () => {
    render(<BuildVerificationScopedCard verification={makeVerification()} />);

    expect(screen.getByText("Verification")).toBeInTheDocument();
    expect(screen.getByText("out-of-scope-noise")).toBeInTheDocument();
    expect(screen.getByText("1 affected file(s)")).toBeInTheDocument();
    expect(screen.getByText("192 failed test(s)")).toBeInTheDocument();
    expect(screen.getByText("FAIL apps/web/lib/mcp-tools-save-build-evidence.test.ts")).toBeInTheDocument();
  });
});
