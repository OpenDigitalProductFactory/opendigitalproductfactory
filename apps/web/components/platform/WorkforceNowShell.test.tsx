// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkforceActivity, WorkforceCoworker } from "@/lib/platform-runtime/workforce-activity";
import { WorkforceNowShell } from "./WorkforceNowShell";

const NOW = "2026-11-02T12:00:00.000Z";

function coworker(workroomId: string | null): WorkforceCoworker {
  return {
    agentId: "portfolio-rationalization-agent",
    name: "Backlog Steward",
    role: "portfolio hygiene",
    now: {
      title: "Review the shared backlog",
      status: "working",
      taskRunId: "TR-STEWARDSHIP",
      workroomId,
    },
    didToday: [],
    handlesSensitive: false,
    sensitiveActionCount: 0,
    tokensToday: 12,
    costToday: 0,
    lastActedAt: NOW,
    humanSupervisorId: "HR-100",
    hitlTier: 3,
  };
}

function activity(c: WorkforceCoworker): WorkforceActivity {
  return {
    capturedAt: NOW,
    working: [c],
    quiet: [],
    platformWork: [],
    pulse: {
      workingCount: 1,
      totalCount: 1,
      actionsToday: 0,
      tokensToday: 12,
      costToday: 0,
      tokensUnattributed: 0,
      costUnattributed: 0,
      platformWorkCount: 0,
      quietOverThresholdCount: 0,
      coworkersWithoutOwnerCount: 0,
      doneWeekCount: 0,
      breakFixDoneWeekCount: 0,
      breakFixShareWeek: 0,
    },
  };
}

afterEach(() => cleanup());

describe("WorkforceNowShell current-work inspection", () => {
  it("links a room-backed task to the existing Workroom evidence view", () => {
    render(<WorkforceNowShell initialData={activity(coworker("WC-BACKLOG"))} />);

    expect(screen.getByRole("link", { name: "Review the shared backlog" })).toHaveAttribute(
      "href",
      "/workspace/cases/work-capsule%3AWC-BACKLOG",
    );
  });

  it("keeps unroomed current work as plain text instead of inventing a destination", () => {
    render(<WorkforceNowShell initialData={activity(coworker(null))} />);

    expect(screen.queryByRole("link", { name: "Review the shared backlog" })).toBeNull();
    expect(screen.getByText("Review the shared backlog")).toBeInTheDocument();
  });
});
