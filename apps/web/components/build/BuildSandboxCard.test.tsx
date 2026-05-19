// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
    sourceCurrency: {
      source: "sandbox-git",
      status: "current",
      recommendedAction: "allow",
      workspace: "/workspace",
      branch: "build/FB-123",
      headSha: "abcdef1234567890",
      headTreeSha: "tree-head",
      targetRef: "origin/main",
      targetSha: "main1234567890",
      targetTreeSha: "tree-head",
      mergeBaseSha: "main1234567890",
      aheadBy: 0,
      behindBy: 0,
      dirty: false,
      localSourceChangeCount: 0,
      checkedAt: new Date().toISOString(),
      reason: "Sandbox source tree matches origin/main.",
    },
    observedAt: "2026-05-18T12:00:00.000Z",
    unavailableReason: null,
  };
}

describe("BuildSandboxCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders branch, source diffstat, and expected plan-file reality", () => {
    render(<BuildSandboxCard sandbox={makeSandbox()} />);

    expect(screen.getAllByText("Sandbox").length).toBeGreaterThan(0);
    expect(screen.getByText("build/FB-123")).toBeInTheDocument();
    expect(screen.getByText("abcdef12")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Source currency")).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getAllByText("apps/web/components/build/BuildSandboxCard.tsx")).toHaveLength(2);
    expect(screen.getByText("+42 -3")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
  });

  it("marks stale persisted source-currency snapshots", () => {
    render(
      <BuildSandboxCard
        sandbox={{
          ...makeSandbox(),
          sourceCurrency: {
            ...makeSandbox().sourceCurrency!,
            checkedAt: "2000-01-01T00:00:00.000Z",
          },
        }}
      />,
    );

    expect(screen.getByText("Source currency snapshot is stale.")).toBeInTheDocument();
  });
});
