// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/acceptance-sweep-close-authorisation", () => ({
  grantAcceptanceSweepCloseAuthorisation: vi.fn(),
  revokeAcceptanceSweepCloseAuthorisation: vi.fn(),
}));

import { namespaceMessages } from "@dpf/i18n";
import type { ComponentProps } from "react";

import { AcceptanceSweepCloseAuthorisationCard as Card } from "@/components/admin/AcceptanceSweepCloseAuthorisationCard";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import type { CloseAuthorisationView } from "@/lib/backlog/acceptance-sweep/close-authorisation-view";
import { measureUxBudget } from "@/lib/ux-budget";

afterEach(() => cleanup());

// The page provides the "admin" catalog namespace; the test does the same.
function AcceptanceSweepCloseAuthorisationCard(props: ComponentProps<typeof Card>) {
  return (
    <MessagesProvider locale="en-US" messages={{ admin: namespaceMessages("en-US", "admin") }}>
      <Card {...props} />
    </MessagesProvider>
  );
}

// BI-C2467A2E AC-1: the card shows the authorisation's state and offers the
// one action that applies: allow when off, stop when on.
//
// UX budget (PR #6070 route sweep): on arrival the card shows only its title,
// the On/Off badge and one short status line. The explanation, the who/when/why
// detail, the limit and the reason form sit behind the shared disclosure.

const OFF: CloseAuthorisationView = {
  state: "off",
  grant: null,
  revocation: null,
  recordProblem: null,
  limit: 25,
  maxLimit: 100,
  minReasonLength: 12,
  lastRun: null,
};

const ON: CloseAuthorisationView = {
  ...OFF,
  state: "on",
  grant: { by: "op@example.test", at: "2026-10-01T09:00:00.000Z", reason: "Merged work already passes its gate." },
  limit: 10,
  lastRun: { ranAt: "2026-10-05T05:00:00.000Z", closingWasOn: true, closed: 7, refused: 1, deferredByLimit: 3, offReason: null },
};

/** Renders the card and returns its markup, optionally after opening the disclosure. */
function renderCard(view: CloseAuthorisationView, { open = false } = {}): string {
  const { container } = render(<AcceptanceSweepCloseAuthorisationCard view={view} />);
  if (open) fireEvent.click(screen.getByRole("button", { name: /Let the acceptance sweep close finished work/ }));
  return container.innerHTML;
}

describe("AcceptanceSweepCloseAuthorisationCard", () => {
  it("arrives collapsed: title, Off badge and one status line, no reason box", () => {
    const html = renderCard(OFF);
    expect(html).toContain('data-testid="acceptance-close-authorisation"');
    expect(html).toContain("Let the acceptance sweep close finished work");
    expect(html).toContain(">Off<");
    expect(html).toContain("The sweep closes nothing.");
    expect(screen.getByRole("button", { name: /Let the acceptance sweep/ }).getAttribute("aria-expanded")).toBe("false");
    expect(html).not.toContain('name="close-authorisation-reason"');
    expect(html).not.toContain('name="close-authorisation-limit"');
    expect(html).not.toContain("Allow closing");
    expect(html).not.toContain("Each morning the sweep checks");
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("arrives collapsed when On: who allowed it and the last run's closed count, nothing else", () => {
    const html = renderCard(ON);
    expect(html).toContain(">On<");
    expect(html).toContain("Allowed by op@example.test on");
    expect(html).toContain("Last sweep closed 7.");
    expect(html).not.toContain("Merged work already passes its gate.");
    expect(html).not.toContain("Up to 10 items per run");
    expect(html).not.toContain("Stop closing");
    expect(html).not.toContain('name="close-authorisation-reason"');
  });

  it("opens to the allow form, a reason box and a per-run limit when Off", () => {
    const html = renderCard(OFF, { open: true });
    expect(html).toContain("Each morning the sweep checks");
    expect(html).toContain("Allow closing");
    expect(html).toContain('name="close-authorisation-reason"');
    expect(html).toContain('name="close-authorisation-limit"');
    expect(html).toContain('value="25"');
    expect(html).toContain('max="100"');
    expect(html).not.toContain("Stop closing");
    expect(html).toContain("No sweep has run since closing was added.");
  });

  it("opens to who allowed it, why, the limit, the last run and the stop form when On", () => {
    const html = renderCard(ON, { open: true });
    expect(html).toContain("op@example.test");
    expect(html).toContain("Merged work already passes its gate.");
    expect(html).toContain("Up to 10 items per run");
    expect(html).toContain("7 closed, 1 refused when checked again, 3 left for the next run");
    expect(html).toContain("Stop closing");
    expect(html).toContain('name="close-authorisation-reason"');
    expect(html).not.toContain('name="close-authorisation-limit"');
  });

  it("explains a last run that closed nothing, in plain words", () => {
    const html = renderCard(
      { ...ON, lastRun: { ranAt: "2026-10-05T05:00:00.000Z", closingWasOn: false, closed: 0, refused: 0, deferredByLimit: 0, offReason: "agent-not-granted" } },
      { open: true },
    );
    expect(html).toContain("closed nothing");
    expect(html).toContain("no longer permitted to complete backlog items");
    expect(html).not.toContain("Last sweep closed");
    expect(html).not.toContain("agent-not-granted");
    expect(html).not.toContain("closeAuthorisation.");
  });

  it("keeps who stopped it, and why, after a revoke", () => {
    const revoked: CloseAuthorisationView = {
      ...ON,
      state: "off",
      revocation: { by: "second@example.test", at: "2026-10-03T09:00:00.000Z", reason: "Pausing to review." },
    };
    const collapsed = renderCard(revoked);
    expect(collapsed).toContain(">Off<");
    expect(collapsed).toContain("Stopped by second@example.test on");
    expect(collapsed).not.toContain("Pausing to review.");
    cleanup();
    const html = renderCard(revoked, { open: true });
    expect(html).toContain("second@example.test");
    expect(html).toContain("Pausing to review.");
    expect(html).toContain("Allow closing");
  });

  it("says when the saved setting cannot be used, on arrival and in detail", () => {
    const view: CloseAuthorisationView = { ...OFF, recordProblem: "malformed" };
    expect(renderCard(view)).toContain("The saved setting cannot be used");
    cleanup();
    expect(renderCard(view, { open: true })).toContain("saved setting is incomplete");
  });

  it("finds every message in the catalog, in both states, collapsed and open", () => {
    for (const view of [OFF, ON]) {
      for (const open of [false, true]) {
        expect(renderCard(view, { open })).not.toContain("closeAuthorisation.");
        cleanup();
      }
    }
  });

  it("adds no field and only a short status line to the page on arrival", () => {
    // Off is the state a fresh install shows (the route sweep's case); On adds
    // who allowed it, the date and the last run's closed count.
    for (const [view, maxWords] of [[OFF, 15], [ON, 20]] as const) {
      const metrics = measureUxBudget(renderCard(view));
      expect(metrics.visibleFields).toBe(0);
      expect(metrics.defaultVisibleWords).toBeLessThanOrEqual(maxWords);
      expect(metrics.disclosureRegions).toBeGreaterThanOrEqual(1);
      cleanup();
    }
  });

  it("uses only theme tokens for colour", () => {
    const html = renderCard(ON, { open: true });
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|text-white|text-black|-gray-/);
  });
});
