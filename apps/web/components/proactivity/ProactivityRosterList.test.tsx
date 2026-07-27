// @vitest-environment jsdom
//
// BI-20716EA4: this file was upgraded from a `renderToStaticMarkup` snapshot
// smoke test to an interactive RTL suite so the save-state contract (pending
// → saved/failed, retry, revert, 44px tap targets) is actually exercised, not
// just the initial markup.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const saveProactivityPreference = vi.fn();

vi.mock("@/lib/actions/proactivity", () => ({
  saveCoworkerProactivityPreference: (agentId: string, level: unknown) =>
    saveProactivityPreference(agentId, level),
}));

import { ProactivityRosterList } from "./ProactivityRosterList";
import type { ProactivityRosterRow } from "@/lib/proactivity/proactivity-roster";
import { SHELL_TAP_TARGET_CLASS } from "@/lib/shell/shell-action-contract";
import type { OwnerFacingArea } from "@/lib/coworker-record/owner-areas";

const CUSTOMERS: OwnerFacingArea = {
  key: "products_and_services_sold",
  label: "Customers and sales",
  order: 1,
};
const PLATFORM: OwnerFacingArea = {
  key: "foundational",
  label: "Platform and back office",
  order: 4,
};

const rows: ProactivityRosterRow[] = [
  {
    agentId: "coo",
    displayName: "Chief Operating Officer",
    role: "orchestrator",
    level: "balanced",
    isOverride: false,
    explanation: "Derived from the business risk posture.",
    area: PLATFORM,
  },
  {
    agentId: "bookkeeper",
    displayName: "Bookkeeper",
    role: "analyst",
    level: "assertive",
    isOverride: true,
    explanation: "Owner override.",
    area: CUSTOMERS,
  },
];

afterEach(() => {
  cleanup();
  saveProactivityPreference.mockReset();
});

function changeLevel(rowName: RegExp, targetLevel: RegExp) {
  const row = screen.getByText(rowName).closest("li");
  if (!row) throw new Error("row not found");
  // Scope BOTH clicks to this row: a sibling row's own trigger can carry the
  // same visible level name (e.g. Bookkeeper's trigger already reads
  // "Proactivity Assertive"), so a global query for the target level can
  // collide with an unrelated row's trigger rather than the open popover
  // option.
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /Proactivity/i }));
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: targetLevel }));
}

describe("ProactivityRosterList", () => {
  it("labels a derived default and an owner override distinctly", () => {
    render(<ProactivityRosterList rows={rows} />);
    expect(screen.getByText("Chief Operating Officer")).toBeInTheDocument();
    // The override label shares a <p> with the role text (role · label), so a
    // full-string getByText won't match it — regex matches the substring.
    expect(screen.getByText(/From your industry/)).toBeInTheDocument();
    expect(screen.getByText("Bookkeeper")).toBeInTheDocument();
    expect(screen.getByText(/You set this/)).toBeInTheDocument();
  });

  it("renders the coworkers grouped under their business-area headings", () => {
    render(<ProactivityRosterList rows={rows} />);
    expect(screen.getByText("Customers and sales")).toBeInTheDocument();
    expect(screen.getByText("Platform and back office")).toBeInTheDocument();
  });

  it("shows an empty message when there are no coworkers", () => {
    render(<ProactivityRosterList rows={[]} />);
    expect(screen.getByText("No coworkers to configure yet.")).toBeInTheDocument();
  });

  it("shows a saved result after a successful change (BI-20716EA4)", async () => {
    saveProactivityPreference.mockResolvedValue({ ok: true });
    render(<ProactivityRosterList rows={rows} />);

    changeLevel(/Chief Operating Officer/, /Assertive/i);

    await waitFor(() => expect(saveProactivityPreference).toHaveBeenCalledWith("coo", "assertive"));
    await screen.findByText("Saved");
  });

  it("surfaces a failed save with retry and reverts the optimistic value (BI-20716EA4)", async () => {
    saveProactivityPreference.mockResolvedValueOnce({ ok: false });
    render(<ProactivityRosterList rows={rows} />);

    changeLevel(/Chief Operating Officer/, /Assertive/i);

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(/couldn.t save/i);
    // Optimistic value snaps back to the last confirmed level (Balanced) — the
    // control must not keep showing an unsaved value as if it persisted.
    expect(screen.getByRole("button", { name: /Proactivity balanced/i })).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: "Retry" });
    expect(retryButton).toHaveClass(SHELL_TAP_TARGET_CLASS);
    expect(screen.getByRole("button", { name: "Revert" })).toHaveClass(SHELL_TAP_TARGET_CLASS);

    saveProactivityPreference.mockResolvedValueOnce({ ok: true });
    fireEvent.click(retryButton);

    await screen.findByText("Saved");
    expect(saveProactivityPreference).toHaveBeenCalledTimes(2);
  });

  it("dismisses a failed banner on Revert without retrying", async () => {
    saveProactivityPreference.mockResolvedValueOnce({ ok: false });
    render(<ProactivityRosterList rows={rows} />);

    changeLevel(/Chief Operating Officer/, /Assertive/i);
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Revert" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(saveProactivityPreference).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed row's status isolated from other rows", async () => {
    saveProactivityPreference.mockImplementation(async (agentId: string) =>
      agentId === "coo" ? { ok: false } : { ok: true },
    );
    render(<ProactivityRosterList rows={rows} />);

    changeLevel(/Chief Operating Officer/, /Assertive/i);
    await screen.findByRole("alert");

    changeLevel(/Bookkeeper/, /Quiet/i);
    await waitFor(() => expect(saveProactivityPreference).toHaveBeenCalledWith("bookkeeper", "quiet"));

    // Both rows resolve independently: COO stays failed, Bookkeeper saves.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    const bookkeeperRow = screen.getByText("Bookkeeper").closest("li");
    expect(bookkeeperRow).not.toBeNull();
    expect(within(bookkeeperRow as HTMLElement).getByText("Saved")).toBeInTheDocument();
  });
});
