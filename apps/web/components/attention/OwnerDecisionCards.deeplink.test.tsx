// @vitest-environment jsdom
//
// BI-0012E6CA AC-DEEPLINK — the approval deep link opens the specific card.
//
// envelopeInboxRoute(id) is `/workspace/inbox?approval=<id>#approval-result`.
// `#approval-result` is the ApprovalOutcomeHistory <details> panel, rendered
// ABOVE the queue; the card itself is an ExpandableCard whose only DOM ids are
// `owner-decision-<safeId(item.id)>-trigger` / `-panel`, and it renders closed
// among every other card. So the link lands on a generic panel, not the card.

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
});
