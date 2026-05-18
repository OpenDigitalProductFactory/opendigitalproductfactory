// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BuildSandboxCard } from "./BuildSandboxCard";
import type { BuildSandboxState } from "@/lib/build/sandbox-state";

function makeSandbox(): BuildSandboxState {
  return {
    source: "sandbox-git",
    branch: "build/FB-123",
    headSha: "abcdef1234567890",
    headAgeLabel: "4m ago",
    commitsAhead: 2,
    sourceDiffstat: [
      {
        path: "apps/web/components/build/BuildSandboxCard.tsx",
        additions: 42,
        deletions: 3,
      },
    ],
    ignoredDiffstat: [],
    expectedPlanFiles: [
      {
        path: "apps/web/components/build/BuildSandboxCard.tsx",
        status: "exists",
      },
      {
        path: "apps/web/components/build/MissingPlanFile.tsx",
        status: "missing",
      },
    ],
    observedAt: "2026-05-18T12:00:00.000Z",
    unavailableReason: null,
  };
}

describe("BuildSandboxCard", () => {
  it("renders branch, source diffstat, and expected plan-file reality", () => {
    render(<BuildSandboxCard sandbox={makeSandbox()} />);

    expect(screen.getByText("Sandbox")).toBeInTheDocument();
    expect(screen.getByText("build/FB-123")).toBeInTheDocument();
    expect(screen.getByText("abcdef12")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText("apps/web/components/build/BuildSandboxCard.tsx")).toHaveLength(2);
    expect(screen.getByText("+42 -3")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
  });
});
