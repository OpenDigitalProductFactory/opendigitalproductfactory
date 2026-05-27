// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
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
    // ERROR text now appears as the diagnosis line (rootCauseSummary) and is
    // also inside the collapsed <details> raw output. Use getAllByText since
    // it may appear in two places.
    expect(screen.getAllByText("ERROR: You've hit your usage limit.").length).toBeGreaterThanOrEqual(1);
  });
});

function attempt(overrides: Partial<BuildDispatchAttemptView> = {}): BuildDispatchAttemptView {
  return {
    id: "att-1",
    buildId: "FB-X",
    taskTitle: "Task A",
    specialist: null,
    providerId: null,
    model: null,
    attemptNumber: 1,
    startedAt: "2026-05-24T00:00:00Z",
    completedAt: "2026-05-24T00:00:05Z",
    durationMs: 5000,
    exitCode: 1,
    success: false,
    failureAxis: "usage-limit",
    stdoutExcerpt: "Reading prompt from stdin...\nUsage limit reached for the day.",
    stderrExcerpt: null,
    rootCauseSummary: "Usage limit reached for the day.",
    rootCauseHash: "deadbeefcafe1234",
    ...overrides,
  };
}

describe("BuildDispatchHistoryCard — root-cause display (BI-594B76AB)", () => {
  it("renders rootCauseSummary as the visible diagnosis line when present", () => {
    const html = renderToStaticMarkup(<BuildDispatchHistoryCard attempts={[attempt()]} />);
    expect(html).toContain("Usage limit reached for the day.");
  });

  it("falls back to failureAxis text when rootCauseSummary is null", () => {
    const html = renderToStaticMarkup(
      <BuildDispatchHistoryCard
        attempts={[attempt({ rootCauseSummary: null, failureAxis: "timeout", stdoutExcerpt: null })]}
      />,
    );
    expect(html).toMatch(/\btimeout\b/i);
  });

  it("places stdoutExcerpt inside a <details> element, not the default visible body", () => {
    const html = renderToStaticMarkup(<BuildDispatchHistoryCard attempts={[attempt()]} />);
    expect(html).toMatch(/<details[\s>]/);
    const detailsMatch = html.match(/<details[\s\S]*?<\/details>/);
    expect(detailsMatch).not.toBeNull();
    expect(detailsMatch![0]).toContain("Reading prompt from stdin");
  });

  it("does not duplicate the rootCauseSummary outside the expected places", () => {
    const html = renderToStaticMarkup(<BuildDispatchHistoryCard attempts={[attempt()]} />);
    const occurrences = (html.match(/Usage limit reached for the day\./g) ?? []).length;
    // Once in the visible diagnosis line, possibly once inside the raw <details>
    // because stdoutExcerpt contains the same string after the prologue.
    expect(occurrences).toBeGreaterThanOrEqual(1);
    expect(occurrences).toBeLessThanOrEqual(2);
  });

  it("uses a <summary> label that names the raw section", () => {
    const html = renderToStaticMarkup(<BuildDispatchHistoryCard attempts={[attempt()]} />);
    expect(html).toMatch(/<summary[^>]*>[^<]*Raw[^<]*<\/summary>/i);
  });
});

describe("BuildDispatchHistoryCard — open-last-attempt event (BI-9A7DA4AC)", () => {
  it("stamps data-most-recent='true' only on the last attempt", () => {
    const older = attempt({ id: "att-older", taskTitle: "Older task" });
    const newer = attempt({ id: "att-newer", taskTitle: "Newer task" });
    const { container } = render(<BuildDispatchHistoryCard attempts={[older, newer]} />);
    const flagged = container.querySelectorAll("[data-most-recent='true']");
    expect(flagged.length).toBe(1);
    // The flagged row corresponds to the newer (last) attempt.
    expect(flagged[0].textContent).toContain("Newer task");
  });

  it("opens the most-recent attempt's <details> when the open-last event fires", () => {
    const { container } = render(<BuildDispatchHistoryCard attempts={[attempt()]} />);
    const detailsBefore = container.querySelector<HTMLDetailsElement>("[data-most-recent='true'] details");
    expect(detailsBefore).not.toBeNull();
    expect(detailsBefore!.open).toBe(false);

    document.dispatchEvent(new CustomEvent("dpf:open-last-dispatch-attempt"));

    const detailsAfter = container.querySelector<HTMLDetailsElement>("[data-most-recent='true'] details");
    expect(detailsAfter!.open).toBe(true);
  });

  it("sets data-just-opened on the most-recent row when the event fires", () => {
    const { container } = render(<BuildDispatchHistoryCard attempts={[attempt()]} />);
    const row = container.querySelector<HTMLElement>("[data-most-recent='true']");
    expect(row).not.toBeNull();
    expect(row!.getAttribute("data-just-opened")).toBeNull();

    document.dispatchEvent(new CustomEvent("dpf:open-last-dispatch-attempt"));

    expect(row!.getAttribute("data-just-opened")).toBe("true");
  });

  it("is a no-op when there are zero attempts", () => {
    const { container } = render(<BuildDispatchHistoryCard attempts={[]} />);
    expect(() => {
      document.dispatchEvent(new CustomEvent("dpf:open-last-dispatch-attempt"));
    }).not.toThrow();
    expect(container.querySelector("[data-most-recent='true']")).toBeNull();
  });
});
