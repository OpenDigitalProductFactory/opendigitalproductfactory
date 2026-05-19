// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BuildDispatchHistoryCard } from "./BuildDispatchHistoryCard";
import type { BuildDispatchAttemptView } from "@/lib/build/dispatch-attempts";

function makeAttempt(): BuildDispatchAttemptView {
  return {
    id: "attempt-1",
    buildId: "FB-123",
    taskTitle: "Add dispatch telemetry",
    specialist: "backend-engineer",
    providerId: "openai",
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
  };
}

describe("BuildDispatchHistoryCard", () => {
  it("renders attempt metadata and bounded failure output", () => {
    render(<BuildDispatchHistoryCard attempts={[makeAttempt()]} />);

    expect(screen.getByText("Dispatch")).toBeInTheDocument();
    expect(screen.getByText("Add dispatch telemetry")).toBeInTheDocument();
    expect(screen.getByText(/exit 1.*usage-limit/)).toBeInTheDocument();
    expect(screen.getByText("gpt-5.3-codex")).toBeInTheDocument();
    expect(screen.getByText("ERROR: You've hit your usage limit.")).toBeInTheDocument();
  });
});
