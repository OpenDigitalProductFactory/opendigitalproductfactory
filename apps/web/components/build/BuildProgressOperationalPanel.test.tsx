// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuildProgressOperationalPanel } from "./BuildProgressOperationalPanel";
import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";

function makeProjection(): BuildProgressVisibility {
  return {
    buildId: "FB-123",
    generatedAt: "2026-05-18T12:00:00.000Z",
    statusHeading: {
      operatorAction: "Click Resume to re-execute 1 blocked task",
      failureAxis: "usage-limit",
    },
    progress: {
      primary: {
        source: "db-task-results",
        completed: 0,
        total: 16,
        observedAt: "2026-05-18T12:00:00.000Z",
      },
      conflicts: [
        {
          source: "chat-self-report",
          completed: 14,
          total: 16,
          observedAt: "2026-05-17T21:00:00.000Z",
        },
      ],
    },
    tasks: {
      completedTasks: 0,
      totalTasks: 16,
      source: {
        source: "db-task-results",
        completed: 0,
        total: 16,
        observedAt: "2026-05-18T12:00:00.000Z",
      },
      tasks: [
        {
          taskIndex: 0,
          title: "Add operational panel",
          specialist: "frontend-engineer",
          outcome: "BLOCKED",
          durationMs: 120000,
          summary: "ERROR: You've hit your usage limit.",
          files: ["apps/web/components/build/BuildProgressOperationalPanel.tsx"],
        },
      ],
    },
    staleChatSnapshots: [
      {
        completed: 14,
        total: 16,
        observedAt: "2026-05-17T21:00:00.000Z",
        excerpt: "14 of 16 tasks completed",
      },
    ],
    sandbox: {
      source: "sandbox-git",
      branch: "build/FB-123",
      headSha: "abc1234",
      headAgeLabel: "4m ago",
      commitsAhead: 1,
      sourceDiffstat: [{ path: "apps/web/components/build/BuildProgressOperationalPanel.tsx", additions: 20, deletions: 1 }],
      ignoredDiffstat: [],
      expectedPlanFiles: [{ path: "apps/web/components/build/BuildProgressOperationalPanel.tsx", status: "exists" }],
      sourceCurrency: {
        source: "sandbox-git",
        status: "current",
        recommendedAction: "allow",
        workspace: "/workspace",
        branch: "build/FB-123",
        headSha: "abc1234",
        headTreeSha: "tree-head",
        targetRef: "origin/main",
        targetSha: "main1234",
        targetTreeSha: "tree-head",
        mergeBaseSha: "main1234",
        aheadBy: 0,
        behindBy: 0,
        dirty: false,
        localSourceChangeCount: 0,
        checkedAt: "2026-05-18T12:00:00.000Z",
        reason: "Sandbox source tree matches origin/main.",
      },
      observedAt: "2026-05-18T12:00:00.000Z",
      unavailableReason: null,
    },
    dispatchHistory: [
      {
        id: "attempt-1",
        buildId: "FB-123",
        taskTitle: "Add operational panel",
        specialist: "frontend-engineer",
        providerId: "chatgpt",
        model: "gpt-5.3-codex",
        attemptNumber: 1,
        startedAt: "2026-05-18T11:58:00.000Z",
        completedAt: "2026-05-18T11:59:00.000Z",
        durationMs: 60000,
        exitCode: 1,
        success: false,
        failureAxis: "usage-limit",
        stdoutExcerpt: "ERROR: You've hit your usage limit.",
        stderrExcerpt: null,
        rootCauseSummary: "ERROR: You've hit your usage limit.",
        rootCauseHash: "abc123abc123abcd",
      },
    ],
    verification: {
      source: "verification",
      observedAt: "2026-05-18T12:00:00.000Z",
      buildScoped: {
        typecheckPassed: null,
        testsPassed: null,
        testsFailed: null,
        failureAxis: "out-of-scope-noise",
        affectedFiles: ["apps/web/components/build/BuildProgressOperationalPanel.tsx"],
        affectedTests: [],
      },
      globalHealth: {
        testsFailed: 192,
        outputExcerpt: "FAIL apps/web/lib/mcp-tools-save-build-evidence.test.ts",
      },
    },
    quietAgent: {
      quiet: true,
      minutesQuiet: 7,
      lastObservableSignalAt: "2026-05-18T11:53:00.000Z",
    },
    engineSelection: {
      summary: "Build engine selection: codex. Reason: Claude credential expired; Codex is healthy.",
      observedAt: "2026-05-18T11:52:00.000Z",
    },
    phaseRuns: [],
  };
}

describe("BuildProgressOperationalPanel", () => {
  it("renders evidence without duplicating the top command status", () => {
    render(<BuildProgressOperationalPanel projection={makeProjection()} />);

    expect(screen.queryByText("Operational status")).not.toBeInTheDocument();
    expect(screen.queryByText("Click Resume to re-execute 1 blocked task")).not.toBeInTheDocument();
    expect(screen.getByText("Task progress")).toBeInTheDocument();
    expect(screen.getByText("0 / 16 tasks complete")).toBeInTheDocument();
    expect(screen.getAllByText("DB").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chat").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sandbox").length).toBeGreaterThan(0);
    expect(screen.getByText("Dispatch")).toBeInTheDocument();
    expect(screen.getByText("Verification")).toBeInTheDocument();
    expect(screen.getByText("Agent has been quiet for 7m")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Build engine selection" })).toHaveTextContent("codex");
    expect(screen.getByRole("region", { name: "Build engine selection" })).toHaveTextContent("Claude credential expired");
    expect(screen.getByRole("link", { name: "view last action" })).toHaveAttribute("href", "#build-dispatch-history");
  });
});

describe("BuildProgressOperationalPanel — quiet-agent link dispatches open-last event (BI-9A7DA4AC)", () => {
  afterEach(() => {
    // Auto-cleanup is unreliable in this file (sibling describe leaves a
    // rendered tree behind). Clean explicitly so getByRole sees one match.
    cleanup();
    vi.restoreAllMocks();
  });

  it("dispatches dpf:open-last-dispatch-attempt and preserves anchor + scroll behavior", () => {
    cleanup();
    const projection = makeProjection();
    const dispatchSpy = vi.spyOn(document, "dispatchEvent");
    render(<BuildProgressOperationalPanel projection={projection} />);

    const link = screen.getByRole("link", { name: "view last action" });
    // Anchor href must stay so the no-JS fallback still scrolls.
    expect(link).toHaveAttribute("href", "#build-dispatch-history");

    // Click via a real MouseEvent so we can inspect defaultPrevented afterwards.
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    // The click handler must NOT preventDefault — anchor scroll proceeds.
    expect(event.defaultPrevented).toBe(false);

    // The custom event must have been dispatched on document with the right name.
    const customEvents = dispatchSpy.mock.calls
      .map(([dispatched]) => dispatched)
      .filter((dispatched): dispatched is CustomEvent => dispatched instanceof CustomEvent);
    expect(customEvents.some((dispatched) => dispatched.type === "dpf:open-last-dispatch-attempt")).toBe(true);
  });
});
