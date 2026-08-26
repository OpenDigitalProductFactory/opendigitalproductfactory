// @vitest-environment jsdom
//
// UX-budget measurement for the installation-identity panel.
//
// `/workspace` carries `sweepEligible: false` (`wall-clock-collection`) in
// route-purpose.generated.json, so the rendered route sweep never measures it and
// it has no row in route-budget-baseline.json. That is a measurement gap, not a
// licence: this file measures the panel's own arrival state with the same
// `lib/ux-budget` code the sweep runs, so the surface still has to hold a budget.
//
// Scope is the panel, not the page. It is the honest thing this harness can
// measure without a served install, and it is what the ux-fit manifest at
// docs/ux-fit/2026-08-22-installation-identity-declaration.ux-fit.json records.

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import axe from "axe-core";

import { auditUxBudget, measureUxBudget } from "@/lib/ux-budget";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/installation-operating-intent", () => ({
  previewInstallationIdentityChange: vi.fn(),
  declareInstallationIdentity: vi.fn(),
}));
vi.mock("@/lib/actions/installation-estate-name", () => ({
  declareEstateName: vi.fn(),
}));

import type { InstallationIdentityView } from "@/lib/installation-journey/identity-presentation";

import { EstateNameField } from "./EstateNameField";
import { InstallationIdentityPanel } from "./InstallationIdentityPanel";

/**
 * The heaviest honest arrival state: every stance carries a full rationale, the
 * pairing and environment detail are both present, and the shadowed-declaration
 * notice is showing. A lighter fixture would understate the measurement.
 */
const VIEW: InstallationIdentityView = {
  stance: {
    schemaVersion: 1,
    environmentClass: "development",
    primaryPurpose: "evolve-dpf",
    holdsIrreplaceableWork: true,
    credentials: "local-permitted",
    teardown: "capture-required",
    sourceAuthority: "governed-worktree",
    peerWrite: "read-only",
    workSync: "same-organization",
    pairedProductionInstallationRef: "dpf-prod-acme",
    rationale: {
      credentials:
        "This is a development installation, so local test credentials may be generated and rotated without an operator hand-off.",
      teardown:
        "This development installation holds work that exists nowhere else, so capture a durable backlog bundle before any teardown.",
      sourceAuthority:
        "A Git checkout is present, so source changes belong in a governed worktree behind the usual review gates.",
      peerWrite:
        "This development installation is paired with dpf-prod-acme, so read from that peer for realistic context but never write to it.",
      workSync:
        "Mirror the backlog this installation owns to dpf-prod-acme so the work survives a teardown; only this side may change those records.",
    },
  },
  environment: {
    environmentClass: "development",
    tier: "installer-state",
    declared: true,
    installerStateValue: "development",
    shadowedPortalDeclaration: {
      declaredClass: "test",
      winningTier: "installer-state",
      winningClass: "development",
    },
  },
  intentStatus: "valid",
  confirmationStatus: "needs-review",
  declaration: {
    primaryPurpose: "evolve-dpf",
    environmentClass: "development",
    pairedProductionInstallationRef: "dpf-prod-acme",
  },
  headline: "A development installation. Its job: safely improve another dpf.",
  detail:
    "Paired with dpf-prod-acme. You saved test here. The installer set development, and that wins.",
  stances: [
    {
      stance: "credentials",
      label: "Credentials",
      value: "local-permitted",
      valueLabel: "Local test keys allowed",
      intent: "neutral",
      rationale:
        "This is a development installation, so local test credentials may be generated and rotated without an operator hand-off.",
    },
    {
      stance: "teardown",
      label: "Teardown",
      value: "capture-required",
      valueLabel: "Capture work first",
      intent: "warning",
      rationale:
        "This development installation holds work that exists nowhere else, so capture a durable backlog bundle before any teardown.",
    },
    {
      stance: "sourceAuthority",
      label: "Source changes",
      value: "governed-worktree",
      valueLabel: "Governed worktree",
      intent: "neutral",
      rationale:
        "A Git checkout is present, so source changes belong in a governed worktree behind the usual review gates.",
    },
    {
      stance: "peerWrite",
      label: "Paired installation",
      value: "read-only",
      valueLabel: "Read only",
      intent: "warning",
      rationale:
        "This development installation is paired with dpf-prod-acme, so read from that peer for realistic context but never write to it.",
    },
  ],
};

afterEach(() => cleanup());

function panelHtml(): string {
  const { container } = render(<InstallationIdentityPanel view={VIEW} />);
  return container.innerHTML;
}

describe("InstallationIdentityPanel UX budget", () => {
  it("holds the cockpit shell budget at the net-new bar", () => {
    // "net-new" deliberately, not the default "pre-existing": this panel is born
    // today, so the absolute text budgets are blocking rather than advisory. The
    // softer default is what let an over-long lead band read as green.
    const report = auditUxBudget(panelHtml(), "cockpit", { routeStatus: "net-new" });
    const failed = report.findings.filter((finding) => !finding.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  });

  it("keeps the form and the impact tables out of the arrival state", () => {
    const metrics = measureUxBudget(panelHtml());

    // The three change fields live behind the disclosure, so an arriving
    // operator is not asked to read a form they did not open.
    expect(metrics.visibleFields).toBe(0);
    // One next action: open the change disclosure.
    expect(metrics.primaryActions).toBeLessThanOrEqual(1);
    expect(metrics.buriedPrimaryAction).toBe(0);
    expect(metrics.subLegibleControls).toBe(0);
    // The lead band is the identity statement, not the whole panel.
    expect(metrics.hasLeadBand).toBe(true);
    expect(metrics.leadBandWords).toBeLessThan(metrics.defaultVisibleWords);
    // The operator arrives with somewhere to go.
    expect(metrics.hasNextActionMarker).toBe(true);
  });

  it("has no axe violations the harness can detect", async () => {
    const { container } = render(<InstallationIdentityPanel view={VIEW} />);
    // color-contrast needs real layout, which jsdom does not do; leaving it on
    // would report "incomplete", not a pass, and a fabricated pass is worse than
    // a stated gap. Theme contrast is covered by the style/token guards.
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    const violations = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(violations, violations.join("; ")).toEqual([]);

    // Deliberately visible in test output: this is where the ux-fit manifest's
    // numbers come from, so re-measuring is one command, not a reconstruction.
    console.log(
      `[ux-budget] ${JSON.stringify({
        ...measureUxBudget(container.innerHTML),
        axeViolations: results.violations.length,
      })}`,
    );
  });
});

// BI-7626A660 — /ops/installation renders the panel AND the estate-name field.
// The panel-only measurement above is what the 2026-08-22 manifest recorded while
// the panel lived on /workspace; it would understate the new route. This block
// measures what the route actually composes, and its console line is where the
// 2026-08-25 ux-fit manifest's numbers come from.
describe("/ops/installation composition UX budget", () => {
  function routeHtml(): string {
    const { container } = render(
      <div>
        <InstallationIdentityPanel view={VIEW} />
        <EstateNameField estateName="Northwind" badgePreview="DEV" />
      </div>,
    );
    return container.innerHTML;
  }

  it("holds the cockpit shell budget at the net-new bar", () => {
    const report = auditUxBudget(routeHtml(), "cockpit", { routeStatus: "net-new" });
    const failed = report.findings.filter((finding) => !finding.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  });

  it("adds exactly one field and one action over the panel alone", () => {
    const metrics = measureUxBudget(routeHtml());
    // The estate name is a label, not a stance change, so it is answerable on
    // arrival rather than hidden behind the impact-preview disclosure.
    expect(metrics.visibleFields).toBe(1);
    expect(metrics.buriedPrimaryAction).toBe(0);
    expect(metrics.subLegibleControls).toBe(0);
    expect(metrics.hasNextActionMarker).toBe(true);
  });

  it("publishes the measured numbers the ux-fit manifest cites", async () => {
    const { container } = render(
      <div>
        <InstallationIdentityPanel view={VIEW} />
        <EstateNameField estateName="Northwind" badgePreview="DEV" />
      </div>,
    );
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    const violations = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(violations, violations.join("; ")).toEqual([]);
    console.log(
      `[ux-budget /ops/installation] ${JSON.stringify({
        ...measureUxBudget(container.innerHTML),
        axeViolations: results.violations.length,
      })}`,
    );
  });
});
