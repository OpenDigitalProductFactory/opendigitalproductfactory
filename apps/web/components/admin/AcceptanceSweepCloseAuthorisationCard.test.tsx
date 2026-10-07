import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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

describe("AcceptanceSweepCloseAuthorisationCard", () => {
  it("shows Off with the allow form, a reason box and a per-run limit", () => {
    const html = renderToStaticMarkup(<AcceptanceSweepCloseAuthorisationCard view={OFF} />);
    expect(html).toContain('data-testid="acceptance-close-authorisation"');
    expect(html).toContain(">Off<");
    expect(html).toContain("Allow closing");
    expect(html).toContain('name="close-authorisation-reason"');
    expect(html).toContain('name="close-authorisation-limit"');
    expect(html).toContain('value="25"');
    expect(html).toContain('max="100"');
    expect(html).not.toContain("Stop closing");
    expect(html).toContain("No sweep has run since closing was added.");
  });

  it("shows On with who allowed it, why, the limit and the last run's closed count", () => {
    const html = renderToStaticMarkup(<AcceptanceSweepCloseAuthorisationCard view={ON} />);
    expect(html).toContain(">On<");
    expect(html).toContain("op@example.test");
    expect(html).toContain("Merged work already passes its gate.");
    expect(html).toContain("Up to 10 items per run");
    expect(html).toContain("7 closed, 1 refused when checked again, 3 left for the next run");
    expect(html).toContain("Stop closing");
    expect(html).not.toContain('name="close-authorisation-limit"');
  });

  it("explains a last run that closed nothing, in plain words", () => {
    const html = renderToStaticMarkup(
      <AcceptanceSweepCloseAuthorisationCard
        view={{ ...ON, lastRun: { ranAt: "2026-10-05T05:00:00.000Z", closingWasOn: false, closed: 0, refused: 0, deferredByLimit: 0, offReason: "agent-not-granted" } }}
      />,
    );
    expect(html).toContain("closed nothing");
    expect(html).toContain("no longer permitted to complete backlog items");
    expect(html).not.toContain("agent-not-granted");
    expect(html).not.toContain("closeAuthorisation.");
  });

  it("keeps who stopped it, and why, after a revoke", () => {
    const html = renderToStaticMarkup(
      <AcceptanceSweepCloseAuthorisationCard
        view={{ ...ON, state: "off", revocation: { by: "second@example.test", at: "2026-10-03T09:00:00.000Z", reason: "Pausing to review." } }}
      />,
    );
    expect(html).toContain(">Off<");
    expect(html).toContain("second@example.test");
    expect(html).toContain("Pausing to review.");
    expect(html).toContain("Allow closing");
  });

  it("says when the saved setting cannot be used", () => {
    const html = renderToStaticMarkup(<AcceptanceSweepCloseAuthorisationCard view={{ ...OFF, recordProblem: "malformed" }} />);
    expect(html).toContain("saved setting is incomplete");
  });

  it("finds every message in the catalog, in both states", () => {
    for (const view of [OFF, ON]) {
      expect(renderToStaticMarkup(<AcceptanceSweepCloseAuthorisationCard view={view} />)).not.toContain("closeAuthorisation.");
    }
  });

  it("uses only theme tokens for colour", () => {
    const html = renderToStaticMarkup(<AcceptanceSweepCloseAuthorisationCard view={ON} />);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|text-white|text-black|-gray-/);
  });
});
