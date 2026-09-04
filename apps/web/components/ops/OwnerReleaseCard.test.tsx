import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerReleaseCard } from "./OwnerReleaseCard";
import type { OwnerReleaseSummary } from "@/lib/self-upgrade/owner-summary";

// BI-D77BF495: OwnerReleaseCard grew a `primaryAction` slot so the "Upgrade
// now" trigger can be co-located with the release status it acts on, instead
// of buried behind the Advanced disclosure. These tests cover the slot itself
// (rendered / positioned / optional) — the trigger's own behavior is covered
// in SelfUpgradeTriggerControl.test.tsx.

const baseSummary: OwnerReleaseSummary = {
  state: "update-available",
  tone: "info",
  headline: "An update is ready.",
  currentVersion: "1.0.0",
  availableVersion: "1.1.0",
  updatePending: true,
  availableVersionLabel: "Update ready",
  recommendedAction: { label: "Install when ready.", detail: "Takes a few minutes." },
  canKeepWorking: { ok: true, detail: "Yes, work continues during the update." },
  keptLocally: { count: 0, detail: "Nothing customised locally." },
  whatCouldGoWrong: [],
  rollback: { available: true, detail: "Can be undone from a recovery point." },
  ifYouDoNothing: "It installs automatically overnight.",
  riskNotice: {
    consequence: "The portal restarts briefly.",
    reversibility: "Yes, via the recovery point.",
    duration: "Under five minutes.",
    recovery: "Restore the recovery point.",
  },
};

describe("OwnerReleaseCard – primary action slot", () => {
  it("wraps the primaryAction in an owner-release-primary-action marker", () => {
    const html = renderToStaticMarkup(
      <OwnerReleaseCard
        summary={baseSummary}
        primaryAction={<button data-testid="the-trigger">Upgrade now</button>}
      />,
    );
    expect(html).toContain('data-component="owner-release-primary-action"');
    expect(html).toContain('data-testid="the-trigger"');
  });

  it("positions the primary action after the risk notice (consequence/reversibility shown first)", () => {
    const html = renderToStaticMarkup(
      <OwnerReleaseCard
        summary={baseSummary}
        primaryAction={<button data-testid="the-trigger">Upgrade now</button>}
      />,
    );
    expect(html.indexOf("Before you install")).toBeLessThan(
      html.indexOf('data-testid="the-trigger"'),
    );
  });

  it("renders nothing extra when primaryAction is omitted (card stays usable without it)", () => {
    const html = renderToStaticMarkup(<OwnerReleaseCard summary={baseSummary} />);
    expect(html).not.toContain('data-component="owner-release-primary-action"');
  });

  it("still renders the release-state marker other pages/tests key off", () => {
    const html = renderToStaticMarkup(<OwnerReleaseCard summary={baseSummary} />);
    expect(html).toContain('data-release-state="update-available"');
  });
});

// Regression cover for the contradiction on /ops/self-upgrade: the tile read
// "You're current" in success green while an update was pending and the
// "Upgrade now" button beside it was enabled. "You're current" is a positive
// claim and must never be the fallback for a missing label.
describe("OwnerReleaseCard – never claims currency while an update is pending", () => {
  function render(summary: OwnerReleaseSummary) {
    return renderToStaticMarkup(<OwnerReleaseCard summary={summary} />);
  }

  it("shows the pending build, not \"You're current\", while a run is in flight", () => {
    const html = render({
      ...baseSummary,
      state: "in-progress",
      tone: "info",
      availableVersion: "Latest build (PR #4854)",
      availableVersionLabel: "Installing now",
      updatePending: true,
      riskNotice: null,
    });
    expect(html).toContain("PR #4854");
    expect(html).toContain("Installing now");
    expect(html).not.toContain("You&#x27;re current");
  });

  it("shows the pending build, not \"You're current\", after a run fails", () => {
    const html = render({
      ...baseSummary,
      state: "failed",
      tone: "danger",
      availableVersion: "Latest build (PR #4854)",
      availableVersionLabel: "Update still pending",
      updatePending: true,
      riskNotice: null,
    });
    expect(html).toContain("PR #4854");
    expect(html).toContain("Update still pending");
    expect(html).not.toContain("You&#x27;re current");
  });

  it("says \"You're current\" only when nothing is pending", () => {
    const html = render({
      ...baseSummary,
      state: "up-to-date",
      tone: "success",
      availableVersion: null,
      availableVersionLabel: "Update ready",
      updatePending: false,
      riskNotice: null,
    });
    expect(html).toContain("You&#x27;re current");
  });

  it("still reports an unsupported install distinctly", () => {
    const html = render({
      ...baseSummary,
      state: "unavailable",
      tone: "warning",
      availableVersion: null,
      availableVersionLabel: "Update ready",
      updatePending: false,
      riskNotice: null,
    });
    expect(html).toContain("Not available on this install");
    expect(html).not.toContain("You&#x27;re current");
  });
});
