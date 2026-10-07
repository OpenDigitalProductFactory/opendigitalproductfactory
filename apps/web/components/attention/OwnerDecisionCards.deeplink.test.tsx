// @vitest-environment jsdom
//
// BI-0012E6CA AC-DEEPLINK — the approval deep link opens the specific card.
//
// envelopeInboxRoute(id) used to end in `#approval-result`: the
// ApprovalOutcomeHistory <details> panel rendered ABOVE the queue. The card was
// an ExpandableCard whose only DOM ids were `<id>-trigger` / `-panel`, and it
// rendered closed among every other card, so the link landed on a generic panel.
// The fragment now names the card's own id (owner-decision-dom-id.ts), which
// is on its <article>, and the card opens on arrival.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

import { OwnerDecisionCards } from "./OwnerDecisionCards";
import { envelopeInboxRoute } from "@/lib/coworker/envelope-routes";
import type { OwnerAttentionEntry } from "@/lib/attention/owner-projection";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

function entry(id: string, headline: string): OwnerAttentionEntry {
  return {
    item: {
      id,
      // No `envelope` payload: DecisionActions renders nothing, which keeps
      // this test about addressing the card, not about its controls.
      source: "coworker-envelope",
      title: headline,
      context: "Merge the duplicate into the canonical item.",
      decisionClass: { scorability: "unscorable" },
      riskClass: "bounded-write",
      triage: {
        timeToAct: "none",
        residueReason: "policy-approval",
        decideEffort: "review",
        irreversible: true,
      },
      createdAtIso: "2026-10-01T04:00:00.000Z",
      actions: [],
      deepLink: "/workspace/inbox",
      audience: { operator: true },
    },
    card: {
      id,
      source: "coworker-envelope",
      headline,
      whyItMatters: "A coworker is waiting on your decision.",
      ifYouDoNothing: "If you do nothing, the coworker cannot proceed.",
      recommendation: { lead: "AI recommendation", text: "review it.", specialistByline: "Backlog" },
      choices: [],
      tags: [],
      technical: { fields: [], builderActions: [] },
    },
  } as unknown as OwnerAttentionEntry;
}

describe("AC-DEEPLINK: the approval link targets the specific card", () => {
  it("resolves the link's fragment to the requested card, open, among other cards", () => {
    const target = "cmupffie10cdu01t491xmoiby";
    const href = envelopeInboxRoute(target);
    const fragment = new URL(href, "https://install.example").hash.slice(1);
    window.location.hash = fragment;

    render(
      <OwnerDecisionCards
        entries={[
          entry("coworker-envelope:other-1", "Some unrelated decision"),
          entry(`coworker-envelope:${target}`, "Merge BI-B into BI-A?"),
          entry("coworker-envelope:other-2", "Another unrelated decision"),
        ]}
      />,
    );

    const anchor = document.getElementById(fragment);
    expect(anchor, `fragment #${fragment} must exist inside the requested card`).not.toBeNull();
    const card = anchor!.closest("article");
    expect(card?.textContent).toContain("Merge BI-B into BI-A?");
    expect(card?.getAttribute("data-open")).toBe("true");
  });

  it("opens the card named by focusItemId even without a fragment", () => {
    render(
      <OwnerDecisionCards
        focusItemId="coworker-envelope:env-2"
        entries={[
          entry("coworker-envelope:env-1", "First"),
          entry("coworker-envelope:env-2", "Second"),
        ]}
      />,
    );
    expect(document.getElementById("owner-decision-coworker-envelope-env-2")?.getAttribute("data-open")).toBe("true");
    expect(document.getElementById("owner-decision-coworker-envelope-env-1")?.getAttribute("data-open")).toBe("false");
  });
});
