// @vitest-environment jsdom
//
// UX-budget measurement for the Right Now shell (BI-B3AB7FC9).
//
// /platform/ai/right-now has no row in route-budget-baseline.json, so the
// rendered route sweep has never adjudicated it. This file measures the shell's
// own arrival state with the same lib/ux-budget code the sweep runs, in the
// heaviest honest state the change introduces: no coworker working, several
// platform runs in flight, unattributed spend flagged, and a quiet roster. Its
// console line is where docs/ux-fit/2026-09-02-right-now-platform-work.ux-fit.json
// gets its numbers.

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import axe from "axe-core";

import { auditUxBudget, measureUxBudget } from "@/lib/ux-budget";
import type { WorkforceActivity, WorkforceCoworker } from "@/lib/platform-runtime/workforce-activity";

import { WorkforceNowShell } from "./WorkforceNowShell";

const NOW = "2026-09-02T18:00:00.000Z";

function coworker(over: Partial<WorkforceCoworker>): WorkforceCoworker {
  return {
    agentId: "a",
    name: "Digital Product Estate Specialist",
    role: "operate",
    now: null,
    didToday: [{ label: "other actions", count: 5, sensitive: false }],
    handlesSensitive: false,
    sensitiveActionCount: 0,
    tokensToday: 1200,
    costToday: 0.01,
    lastActedAt: NOW,
    humanSupervisorId: null,
    hitlTier: 3,
    ...over,
  };
}

/** Today's live shape: nothing owned, the model runner busy with platform work. */
const DATA: WorkforceActivity = {
  capturedAt: NOW,
  working: [],
  quiet: [
    coworker({ agentId: "a1" }),
    coworker({ agentId: "a2", name: "Compliance Officer", role: "govern", humanSupervisorId: "HR-000", lastActedAt: null, didToday: [] }),
    coworker({ agentId: "a3", name: "Bookkeeper", role: "finance", lastActedAt: "2026-08-20T00:00:00.000Z", didToday: [] }),
  ],
  platformWork: [
    {
      taskRunId: "deliberation-1",
      title: "Deliberation: review",
      status: "working",
      source: "proactive",
      buildId: "FB-FCAC756D",
      routeContext: "/build",
      startedAt: "2026-09-02T17:58:00.000Z",
      lastHeartbeatAt: NOW,
    },
    {
      taskRunId: "deliberation-2",
      title: "Deliberation: debate",
      status: "working",
      source: "proactive",
      buildId: "FB-8F5905FA",
      routeContext: "/build",
      startedAt: "2026-09-02T16:58:00.000Z",
      lastHeartbeatAt: null,
    },
  ],
  pulse: {
    workingCount: 0,
    totalCount: 37,
    actionsToday: 19,
    tokensToday: 2_508_854,
    costToday: 1.92,
    tokensUnattributed: 772_477,
    costUnattributed: 0.4,
    platformWorkCount: 2,
    quietOverThresholdCount: 2,
    coworkersWithoutOwnerCount: 37,
    doneWeekCount: 9,
    breakFixDoneWeekCount: 3,
    breakFixShareWeek: 3 / 9,
  },
};

afterEach(() => cleanup());

function shellHtml(): string {
  const { container } = render(<WorkforceNowShell initialData={DATA} />);
  return container.innerHTML;
}

describe("WorkforceNowShell UX budget", () => {
  it("holds the cockpit shell budget for a pre-existing route", () => {
    const report = auditUxBudget(shellHtml(), "cockpit", { routeStatus: "pre-existing" });
    const failed = report.findings.filter((finding) => !finding.ok && finding.severity === "blocking");
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  });

  it("names the platform work instead of an empty board", () => {
    const { container } = render(<WorkforceNowShell initialData={DATA} />);
    expect(container.textContent).toContain("Platform work in flight");
    expect(container.textContent).toContain("Deliberation: review");
    expect(container.textContent).toContain("FB-FCAC756D");
    expect(container.textContent).toContain("unattributed");
    expect(container.textContent).toContain("33% break-fix this week");
    // No coworker row claims a task it does not own.
    expect(container.textContent).not.toContain("Now →");
  });

  it("has no axe violations the harness can detect", async () => {
    const { container } = render(<WorkforceNowShell initialData={DATA} />);
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    const violations = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(violations, violations.join("; ")).toEqual([]);

    // Where the ux-fit manifest's numbers come from.
    console.log(
      `[ux-budget] ${JSON.stringify({
        ...measureUxBudget(container.innerHTML),
        axeViolations: results.violations.length,
      })}`,
    );
  });
});
