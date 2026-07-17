// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, saveDisposition } = vi.hoisted(() => ({
  refresh: vi.fn(),
  saveDisposition: vi.fn(),
}));
vi.mock("@/lib/actions/attention-digest", () => ({
  setWeeklyDigestDisposition: saveDisposition,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { WeeklyDigestPanel } from "./WeeklyDigestPanel";
import type { OwnerAttentionEntry } from "@/lib/attention/owner-projection";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => saveDisposition.mockResolvedValue({ ok: true }));

const entry = {
  item: {
    id: "research-proposal:1",
    source: "research-proposal",
    title: "Approve research: customer follow-up",
    context: "Study whether a next-day call improves repeat bookings.",
    decisionClass: { scorability: "unscorable" },
    riskClass: "read",
    triage: {
      timeToAct: "none",
      residueReason: "policy-approval",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: "2026-07-17T12:00:00.000Z",
    actions: [{ kind: "open-in-context", label: "Review proposal", href: "/admin/research" }],
    deepLink: "/admin/research",
    audience: { operator: true },
  },
  card: {
    id: "research-proposal:1",
    source: "research-proposal",
    headline: "Approve this research?",
    whyItMatters: "This may improve customer work.",
    ifYouDoNothing: "If you do nothing, it waits.",
    recommendation: {
      lead: "Your COO recommends",
      text: "review this with the weekly batch.",
      specialistByline: "Research",
    },
    choices: [
      {
        kind: "open-in-context",
        label: "Review",
        href: "/workspace/inbox?attentionId=research-proposal%3A1",
      },
    ],
    tags: [{ label: "Reversible", kind: "reversible" }],
    technical: { fields: [], builderActions: [] },
  },
  routing: {
    lane: "weekly-digest",
    reason: "Low urgency",
    hardFloor: false,
    appliedLevel: "balanced",
  },
} satisfies OwnerAttentionEntry;

describe("WeeklyDigestPanel", () => {
  it("stays out of the daily surface before Friday", () => {
    const { container } = render(
      <WeeklyDigestPanel entries={[entry]} nowMs={Date.parse("2026-07-15T12:00:00Z")} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders one Friday batch with batch and per-item actions", () => {
    render(<WeeklyDigestPanel entries={[entry]} nowMs={Date.parse("2026-07-17T12:00:00Z")} />);

    expect(screen.getByText("Friday review")).toBeTruthy();
    expect(screen.getByText("Approve this research?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Looks good, no changes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Snooze to next week" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve research" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip this" })).toBeTruthy();
  });

  it("acknowledges a batch choice without exposing every record again", async () => {
    render(<WeeklyDigestPanel entries={[entry]} nowMs={Date.parse("2026-07-17T12:00:00Z")} />);
    fireEvent.click(screen.getByRole("button", { name: "Looks good, no changes" }));

    expect(await screen.findByText("Weekly review cleared.")).toBeTruthy();
    expect(saveDisposition).toHaveBeenCalledWith("2026-07-17", "cleared");
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText("Approve this research?")).toBeNull();
  });

  it("restores a saved Friday choice after a refresh", () => {
    render(
      <WeeklyDigestPanel
        entries={[entry]}
        nowMs={Date.parse("2026-07-17T12:00:00Z")}
        initialDisposition="snoozed"
      />,
    );

    expect(screen.getByText("Snoozed to next week.")).toBeTruthy();
    expect(screen.queryByText("Approve this research?")).toBeNull();
  });
});
