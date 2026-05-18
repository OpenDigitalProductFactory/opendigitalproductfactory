// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BuildVerificationScopedCard } from "./BuildVerificationScopedCard";
import type { ScopedVerificationView } from "@/lib/build/scoped-verification";

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
  it("separates build-scoped verification from global workspace health", () => {
    render(<BuildVerificationScopedCard verification={makeVerification()} />);

    expect(screen.getByText("Verification")).toBeInTheDocument();
    expect(screen.getByText("out-of-scope-noise")).toBeInTheDocument();
    expect(screen.getByText("1 affected file(s)")).toBeInTheDocument();
    expect(screen.getByText("192 failed test(s)")).toBeInTheDocument();
    expect(screen.getByText("FAIL apps/web/lib/mcp-tools-save-build-evidence.test.ts")).toBeInTheDocument();
  });
});
