// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Deciding a card has to move the header count, not only the card
// (BI-79E207B9), so the actions re-render the server tree.
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { OwnerDecisionCards } from "./OwnerDecisionCards";
import type { OwnerAttentionEntry } from "@/lib/attention/owner-projection";

afterEach(() => cleanup());

const entry: OwnerAttentionEntry = {
  item: {
    id: "approval-bill:BILL-1",
    source: "approval-bill",
    title: "Approve bill BILL-1",
    context: "GBP 240 due",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "due-soon",
      deadlineIso: "2026-07-20T12:00:00.000Z",
      residueReason: "policy-approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: "2026-07-17T12:00:00.000Z",
    actions: [{ kind: "open-in-context", label: "Review bill", href: "/finance/bills" }],
    deepLink: "/finance/bills",
    audience: { operator: true },
  },
  card: {
    id: "approval-bill:BILL-1",
    source: "approval-bill",
    headline: "Approve this bill?",
    whyItMatters: "Paying the right bills on time keeps your business supplied.",
    ifYouDoNothing: "If you do nothing, the bill may become late.",
    recommendation: {
      lead: "AI recommendation",
      text: "review the amount and recipient, then approve it if both are right.",
      specialistByline: "Finance",
    },
    choices: [{ kind: "open-in-context", label: "Review bill", href: "/finance/bills" }],
    tags: [
      { label: "Costs money", kind: "money" },
      { label: "Reversible", kind: "reversible" },
      { label: "Due in 3 days", kind: "deadline" },
    ],
    technical: {
      fields: [
        { label: "Original title", value: "Approve bill BILL-1" },
        { label: "Source", value: "approval-bill" },
      ],
      builderActions: [
        { kind: "open-in-context", label: "Open in Operations", href: "/ops" },
      ],
    },
  },
  routing: {
    lane: "needs-you-now",
    reason: "Money would leave the business.",
    hardFloor: true,
    appliedLevel: "balanced",
  },
};

describe("OwnerDecisionCards", () => {
  it("shows the owner decision hierarchy and plain choices before technical detail", () => {
    const { container } = render(<OwnerDecisionCards entries={[entry]} />);

    expect(screen.getByText("Approve this bill?")).toBeTruthy();
    expect(screen.getByText(/Paying the right bills/)).toBeTruthy();
    expect(screen.getByText(/If you do nothing/)).toBeTruthy();
    expect(screen.getByText(/the bill may become late/)).toBeTruthy();
    expect(screen.getByText("AI recommendation")).toBeTruthy();
    expect(screen.getByText("Finance")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review bill" }).getAttribute("href")).toBe(
      "/finance/bills",
    );
    expect(screen.getByText("Costs money")).toBeTruthy();
    expect(screen.queryByText("Approve bill BILL-1")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open in Operations" })).toBeNull();
    expect(container.innerHTML).toContain("var(--dpf-");
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("reveals every raw field and builder verb one click down", () => {
    render(<OwnerDecisionCards entries={[entry]} />);

    fireEvent.click(screen.getByRole("button", { name: /Technical detail/ }));

    expect(screen.getByText("Approve bill BILL-1")).toBeTruthy();
    expect(screen.getByText("approval-bill")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open in Operations/ }).getAttribute("href")).toBe(
      "/ops",
    );
  });

  it("offers accept, decline, and narrow choices for a proactivity self-tune", () => {
    const selfTune = {
      ...entry,
      item: {
        ...entry.item,
        id: "agent-proposal:AP-PROACTIVE",
        source: "agent-proposal" as const,
        title: "Review proactivity: Balanced -> Assertive",
      },
      card: {
        ...entry.card,
        id: "agent-proposal:AP-PROACTIVE",
        source: "agent-proposal" as const,
        headline: "Let this coworker do more?",
      },
    };
    render(<OwnerDecisionCards entries={[selfTune]} />);

    expect(screen.getByRole("button", { name: "Accept boundary" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep current level" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Narrow boundary" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Narrow boundary" })).toBeNull();
  });

  it("lets an owner decide a general coworker proposal without entering platform tools", () => {
    const proposal = {
      ...entry,
      item: {
        ...entry.item,
        id: "agent-proposal:AP-1",
        source: "agent-proposal" as const,
        title: "Approve: update the customer follow-up rule",
      },
      card: {
        ...entry.card,
        id: "agent-proposal:AP-1",
        source: "agent-proposal" as const,
        headline: "Approve this coworker action?",
      },
    };
    render(<OwnerDecisionCards entries={[proposal]} />);

    expect(screen.getByRole("button", { name: "Approve action" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /platform|workforce/i })).toBeNull();
  });

  it("routes leave proposals to the governed human controls instead of generic tool execution", () => {
    const leaveProposal = {
      ...entry,
      item: {
        ...entry.item,
        id: "agent-proposal:AP-LEAVE",
        source: "agent-proposal" as const,
        title: "Review time-off recommendation",
        deepLink: "/employee?view=timeoff",
        actions: [{ kind: "open-in-context" as const, label: "Review time off", href: "/employee?view=timeoff" }],
      },
      card: {
        ...entry.card,
        id: "agent-proposal:AP-LEAVE",
        source: "agent-proposal" as const,
        headline: "Review this time-off request?",
        choices: [{ kind: "open-in-context" as const, label: "Review time off", href: "/employee?view=timeoff" }],
      },
    };
    render(<OwnerDecisionCards entries={[leaveProposal]} />);

    expect(screen.getByRole("link", { name: "Review time off" }).getAttribute("href")).toBe(
      "/employee?view=timeoff",
    );
    expect(screen.queryByRole("button", { name: "Approve action" })).toBeNull();
  });

  it("keeps a weekly research decision in the owner card instead of routing to admin", () => {
    const research = {
      ...entry,
      item: {
        ...entry.item,
        id: "research-proposal:RP-1",
        source: "research-proposal" as const,
        title: "Approve research: follow-up calls",
      },
      card: {
        ...entry.card,
        id: "research-proposal:RP-1",
        source: "research-proposal" as const,
        headline: "Approve this research?",
      },
    };
    render(<OwnerDecisionCards entries={[research]} />);

    expect(screen.getByRole("button", { name: "Approve research" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip this" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /research/i })).toBeNull();
  });
});
