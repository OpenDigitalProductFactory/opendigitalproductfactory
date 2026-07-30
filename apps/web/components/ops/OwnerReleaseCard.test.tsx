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
    authority: "A platform administrator can start it.",
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

  it("defers version, impact, recovery, and risk detail behind one disclosure", () => {
    const html = renderToStaticMarkup(
      <OwnerReleaseCard
        summary={baseSummary}
        primaryAction={<button data-testid="the-trigger">Upgrade now</button>}
      />,
    );
    expect(html).toContain('data-dpf-purpose-disclosure-key="release-details"');
    expect(html).toContain("Version, impact &amp; recovery");
    expect(html.indexOf('data-testid="the-trigger"')).toBeLessThan(
      html.indexOf("Version, impact &amp; recovery"),
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
