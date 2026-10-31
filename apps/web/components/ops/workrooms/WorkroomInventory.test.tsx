// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkroomInventory, type WorkroomInventoryRow } from "./WorkroomInventory";

afterEach(cleanup);
const renderInventory = (node: ReactNode) => render(<MessagesProvider locale="en-US"
  messages={{ workrooms: namespaceMessages("en-US", "workrooms") }}>{node}</MessagesProvider>);
const summary = { scanned: 3, live: 2, working: 1, history: 1, reapable: 1, byLiveness: {},
  heavyLane: { executing: 1, nextReady: 0, dormant: 0 }, progressSlo: { oldestWaitMs: null, maxNoTransitionMs: null } };
const row = (capsuleId: string, liveness: string, title: string): WorkroomInventoryRow => ({
  capsuleId, backlogItemId: null, title, status: "working",
  portfolioRole: "foundational", pullRequestUrl: null,
  liveness, isLive: liveness !== "lease-expired", accountableName: "Dana Reyes",
});
const rows = [row("WC-NOW", "live", "Prepare adoption event"), row("WC-WAIT", "paused", "Update user guide"), row("WC-OLD", "lease-expired", "Stopped review")];
describe("operator Workrooms inventory", () => {
  it("shows actual progress first without mounting history or exposing diagnostic text", () => {
    renderInventory(<WorkroomInventory workrooms={rows} summary={summary} />);
    expect(screen.getByRole("table", { name: "Working now" })).toBeVisible();
    expect(screen.queryByText("Stopped review")).toBeNull();
    expect(screen.getByText("Dana Reyes")).toBeVisible();
    expect(screen.queryByText("private-session-id", { exact: false })).toBeNull();
    expect(screen.getByRole("link", { name: "View recorded evidence in the room", hidden: true }))
      .toHaveAttribute("href", "/workspace/cases/work-capsule%3AWC-NOW");
    expect(screen.getByRole("link", { name: "Prepare adoption event" })).toHaveAttribute("href", "/workspace/cases/work-capsule%3AWC-NOW");
  });
  it("puts paused workers in Waiting rather than Working now", () => {
    renderInventory(<WorkroomInventory workrooms={rows} summary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "Waiting · 1" }));
    expect(screen.getByRole("link", { name: "Update user guide" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Prepare adoption event" })).toBeNull();
    expect(screen.getByText("Worker paused")).toBeVisible();
  });
  it("mounts retained records only when history is requested, and removes them on close", () => {
    renderInventory(<WorkroomInventory workrooms={rows} summary={summary} />);
    const details = screen.getByText("History · 1 retained rooms").closest("details")!;
    details.open = true; fireEvent(details, new Event("toggle"));
    expect(screen.getByRole("link", { name: "Stopped review" })).toBeVisible();
    details.open = false; fireEvent(details, new Event("toggle"));
    expect(screen.queryByText("Stopped review")).toBeNull();
  });
  it("prioritizes a blocked room and is honest about missing accountability", () => {
    renderInventory(<WorkroomInventory workrooms={[...rows, { ...row("WC-BLOCK", "live", "Restore failed review"), status: "blocked", accountableName: null }]} summary={summary} />);
    expect(screen.getByRole("table", { name: "Needs attention" })).toBeVisible();
    expect(screen.getByText("Not assigned")).toBeVisible();
    expect(screen.getByText(/Actor not recorded.*Action not recorded/)).toBeVisible();
  });
  it("shows a shared hold once instead of repeating it as an individual row", () => {
    const blocked = { ...row("WC-BLOCK", "live", "Repeated review"), status: "blocked" };
    renderInventory(<WorkroomInventory workrooms={[blocked]} summary={summary} heldCapsuleIds={["WC-BLOCK"]}
      attentionContent={<p>One shared recovery issue</p>} />);
    expect(screen.getByText("One shared recovery issue")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Repeated review" })).toBeNull();
  });
  it("starts with attention when shared recovery is outside the recent inventory", () => {
    renderInventory(<WorkroomInventory workrooms={[]} summary={summary} heldCapsuleIds={["WC-OLDER-HELD"]}
      attentionContent={<p>One older recovery issue</p>} />);
    expect(screen.getByRole("button", { name: "Needs attention · 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("One older recovery issue")).toBeVisible();
  });
  it("retains an individual held room when no shared-recovery replacement is supplied", () => {
    const blocked = { ...row("WC-BLOCK", "live", "Retained review"), status: "blocked" };
    renderInventory(<WorkroomInventory workrooms={[blocked]} summary={summary} heldCapsuleIds={["WC-BLOCK"]} />);
    expect(screen.getByRole("link", { name: "Retained review" })).toBeVisible();
  });
  it("keeps COO cycle, wake, span and escalation inside details and routes the action to the room case", () => {
    const coo = {
      lastCycleKey: "shape@1:2026-10-26", lastAction: "dispatch_agent", lastReason: "agent_stage",
      ticksSinceAdvance: 3, nextWakeAt: "2026-10-26T13:15:00.000Z", spanOfControl: 8, overSpan: true,
      unowned: false, paused: false, ownerIsSuggestion: true, escalationLabel: "PRN-human",
      missingAckCount: 1, actionHref: "/workspace/cases/work-capsule%3AWC-NOW",
    };
    renderInventory(<WorkroomInventory workrooms={[{ ...row("WC-NOW", "live", "Prepare adoption event"), coo }]}
      summary={summary} supervision={{ unownedCount: 1, pausedCount: 2, missingAckCount: 1,
        overSpanOwners: [{ principalId: "PRN-busy", displayName: "Busy", roomCount: 8 }] }} />);
    expect(screen.getByText("Last action: dispatch_agent")).not.toBeVisible();
    expect(screen.getByText("Last cycle: shape@1:2026-10-26")).not.toBeVisible();
    expect(screen.getByText("Supervision")).toBeVisible();
    const technical = screen.getByText("Technical evidence").closest("details")!;
    technical.open = true; fireEvent(technical, new Event("toggle"));
    expect(screen.getByText("Last action: dispatch_agent")).toBeVisible();
    expect(screen.getByText("3 ticks since advance")).toBeVisible();
    expect(screen.getByText("Next wake 2026-10-26T13:15:00.000Z")).toBeVisible();
    expect(screen.getByText("Over span of control")).toBeVisible();
    expect(screen.getByText("Escalation: PRN-human")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Open room" })).toBeNull();
    expect(screen.getByRole("link", { name: "Prepare adoption event" })).toHaveAttribute("href", "/workspace/cases/work-capsule%3AWC-NOW");
    const supervision = screen.getByText("Supervision").closest("details")!;
    supervision.open = true; fireEvent(supervision, new Event("toggle"));
    expect(screen.getByText("Busy · 8")).toBeVisible();
  });
});
