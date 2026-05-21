// apps/web/components/build/ActionBanner.test.tsx
//
// Pins the ActionBanner contract:
//   - 40px fixed height (ACTION_BANNER_HEIGHT_CLASS = h-10 via build-studio-layout).
//   - One sentence is the heading — no separate "Build Status" / "Operational status" label.
//   - detail only rendered for "blocked" / "review_failed".
//   - Primary action right-aligned with min-width 120px.
//   - role="region" with aria-label.
//   - Distinct fg/bg tokens per state (no yellow-on-yellow class of bug).

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActionBanner } from "./ActionBanner";
import { ACTION_BANNER_HEIGHT_CLASS, BUILD_STUDIO_TEST_IDS } from "./build-studio-layout";

describe("ActionBanner", () => {
  it("uses the 40px height class from the layout helper", () => {
    const html = renderToStaticMarkup(
      <ActionBanner state="ready" sentence="Ready to advance." />,
    );
    expect(html).toContain(ACTION_BANNER_HEIGHT_CLASS);
    expect(ACTION_BANNER_HEIGHT_CLASS).toBe("h-10");
  });

  it("renders role=region with an aria-label", () => {
    const html = renderToStaticMarkup(
      <ActionBanner state="ready" sentence="Ready to advance." />,
    );
    expect(html).toMatch(/role="region"/);
    expect(html).toContain('aria-label="Current build action"');
  });

  it("renders the sentence exactly once — no duplicate heading", () => {
    const html = renderToStaticMarkup(
      <ActionBanner state="ready" sentence="Plan review passed." />,
    );
    // The sentence appears once
    const matches = html.match(/Plan review passed\./g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("does NOT render a 'Build Status' or 'Operational status' label", () => {
    const html = renderToStaticMarkup(
      <ActionBanner state="ready" sentence="Plan review passed." />,
    );
    expect(html).not.toContain("Build Status");
    expect(html).not.toContain("Operational status");
  });

  it("does NOT render detail when state is 'ready'", () => {
    const html = renderToStaticMarkup(
      <ActionBanner
        state="ready"
        sentence="Ready to advance."
        detail="This should not appear."
      />,
    );
    expect(html).not.toContain("This should not appear.");
    expect(html).not.toContain('data-testid="action-banner-detail"');
  });

  it("does NOT render detail when state is 'running'", () => {
    const html = renderToStaticMarkup(
      <ActionBanner
        state="running"
        sentence="Build running."
        detail="Should not appear."
      />,
    );
    expect(html).not.toContain("Should not appear.");
  });

  it("does NOT render detail when state is 'complete'", () => {
    const html = renderToStaticMarkup(
      <ActionBanner
        state="complete"
        sentence="Build complete."
        detail="Should not appear."
      />,
    );
    expect(html).not.toContain("Should not appear.");
  });

  it("renders detail when state is 'blocked'", () => {
    const html = renderToStaticMarkup(
      <ActionBanner
        state="blocked"
        sentence="Blocked on dependency."
        detail="Waiting for cache module."
      />,
    );
    expect(html).toContain("Waiting for cache module.");
    expect(html).toContain('data-testid="action-banner-detail"');
  });

  it("renders detail when state is 'review_failed'", () => {
    const html = renderToStaticMarkup(
      <ActionBanner
        state="review_failed"
        sentence="Plan review failed."
        detail="Fix the dependency ordering."
      />,
    );
    expect(html).toContain("Fix the dependency ordering.");
  });

  it("renders primary action right-aligned with min-width", () => {
    const html = renderToStaticMarkup(
      <ActionBanner
        state="ready"
        sentence="Advance available."
        primaryAction={{ label: "Advance to Plan", onClick: () => {} }}
      />,
    );
    expect(html).toContain("Advance to Plan");
    expect(html).toContain("min-w-[120px]");
    expect(html).toContain('data-testid="action-banner-primary"');
    expect(html).toContain("action-banner__primary");
  });

  it("respects disabled prop on the primary action", () => {
    const html = renderToStaticMarkup(
      <ActionBanner
        state="blocked"
        sentence="Blocked."
        primaryAction={{ label: "Retry", onClick: () => {}, disabled: true }}
      />,
    );
    expect(html).toMatch(/aria-disabled="true"/);
    expect(html).toContain("disabled");
  });

  it("omits the primary action button when no primaryAction prop is provided", () => {
    const html = renderToStaticMarkup(
      <ActionBanner state="running" sentence="Build running." />,
    );
    expect(html).not.toContain('data-testid="action-banner-primary"');
  });

  it("uses distinct fg/bg tokens for 'blocked' state — no chip-collapse bug", () => {
    const html = renderToStaticMarkup(
      <ActionBanner state="blocked" sentence="Blocked." detail="Reason." />,
    );
    expect(html).toContain("bg-[var(--dpf-state-warning)]");
    expect(html).toContain("border-[var(--dpf-warning)]");
    // Foreground is var(--dpf-text), not the same warning token.
    expect(html).toContain("text-[var(--dpf-text)]");
    // The bg/border var name and the fg var name must not be identical sources.
    expect(html).not.toMatch(/bg-\[var\(--dpf-warning\)\][^"]*text-\[var\(--dpf-warning\)\]/);
  });

  it("uses distinct tokens for each non-default state", () => {
    const states = ["running", "blocked", "review_failed", "complete"] as const;
    for (const state of states) {
      const html = renderToStaticMarkup(
        <ActionBanner state={state} sentence={`State: ${state}`} />,
      );
      // None of the states should use the same bg+text var pair (the chip bug).
      const bgMatch = html.match(/bg-\[var\(--dpf-state-[a-z]+\)\]/);
      const txtMatch = html.match(/text-\[var\(--dpf-[a-z]+\)\]/);
      expect(bgMatch).toBeTruthy();
      expect(txtMatch).toBeTruthy();
      // The fg should be --dpf-text (neutral) for readability against the tinted bg.
      expect(txtMatch?.[0]).toContain("--dpf-text");
    }
  });

  it("emits data-state for snapshot diffing", () => {
    const html = renderToStaticMarkup(
      <ActionBanner state="review_failed" sentence="x" />,
    );
    expect(html).toContain('data-state="review_failed"');
  });

  it("emits the canonical test ID on the wrapper", () => {
    const html = renderToStaticMarkup(
      <ActionBanner state="ready" sentence="x" />,
    );
    expect(html).toContain(`data-testid="${BUILD_STUDIO_TEST_IDS.actionBanner}"`);
  });

  it("uses no hex literals (DPF variable invariant)", () => {
    const allStates = ["ready", "running", "blocked", "review_failed", "complete"] as const;
    for (const state of allStates) {
      const html = renderToStaticMarkup(
        <ActionBanner
          state={state}
          sentence="x"
          detail="y"
          primaryAction={{ label: "z", onClick: () => {} }}
        />,
      );
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    }
  });
});
