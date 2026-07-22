// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/components/ui/Dialog", () => ({
  promptDialog: vi.fn(),
}));

import { StorefrontInbox } from "./StorefrontInbox";

const defaultDigitalProduct = { id: "dp_1", name: "Open Digital Product Factory" };

function inquiry(overrides: Record<string, unknown> = {}) {
  return {
    id: "inq_1",
    ref: "INQ-0001",
    name: "Jane Prospect",
    email: "jane@example.com",
    type: "inquiry",
    detail: "I want to run product ops on DPF.",
    createdAt: "2026-07-20T10:00:00.000Z",
    providerName: null,
    status: "",
    backlogItemId: null,
    ...overrides,
  };
}

afterEach(() => cleanup());

// ── Send-to-backlog action state (BI-4F4252DB) ──────────────────────────────
describe("StorefrontInbox send-to-backlog state", () => {
  it("offers an enabled Send to backlog action when the inquiry is untracked", () => {
    render(
      <StorefrontInbox entries={[inquiry()]} defaultDigitalProduct={defaultDigitalProduct} />,
    );
    const button = screen.getByRole("button", { name: /send inquiry INQ-0001 to backlog/i });
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("replaces the action with a completed marker and a direct link once tracked", () => {
    render(
      <StorefrontInbox
        entries={[inquiry({ backlogItemId: "BI-SFI-INQ0001" })]}
        defaultDigitalProduct={defaultDigitalProduct}
      />,
    );

    // No lingering enabled action beside a tracked inquiry.
    expect(screen.queryByRole("button", { name: /send inquiry INQ-0001 to backlog/i })).toBeNull();

    // Unmistakable completed state plus an owner-readable link to the item.
    expect(screen.getByText(/sent to backlog/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /open backlog item BI-SFI-INQ0001 for inquiry INQ-0001/i });
    expect(link.getAttribute("href")).toBe("/ops?itemId=BI-SFI-INQ0001");
    expect(link.textContent).toContain("BI-SFI-INQ0001");
  });

  it("disables the action when backlog sending is unavailable", () => {
    render(<StorefrontInbox entries={[inquiry()]} defaultDigitalProduct={null} />);
    const button = screen.getByRole("button", { name: /send inquiry INQ-0001 to backlog/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── Owner inbox visibility + row-specific action (BI-F20763F5) ───────────────
describe("StorefrontInbox — owner inbox visibility (inquiry)", () => {
  it("shows reference, customer, and request context on the row", () => {
    render(
      <StorefrontInbox entries={[inquiry()]} defaultDigitalProduct={defaultDigitalProduct} />,
    );
    expect(screen.getByText("INQ-0001")).toBeTruthy();
    expect(screen.getByText(/Jane Prospect/)).toBeTruthy();
    expect(screen.getByText(/jane@example\.com/)).toBeTruthy();
    // The request itself (the customer's message) is visible to the owner.
    expect(screen.getByText("I want to run product ops on DPF.")).toBeTruthy();
  });

  it("uses a row-specific action label instead of a generic 'Send to backlog'", () => {
    render(
      <StorefrontInbox entries={[inquiry()]} defaultDigitalProduct={defaultDigitalProduct} />,
    );
    // Visible label carries the reference; accessible name is row-specific.
    const button = screen.getByRole("button", { name: /send inquiry INQ-0001 to backlog/i });
    expect(button.textContent).toContain("INQ-0001");
    // No bare generic label survives on the action.
    expect(screen.queryByText(/^Send to backlog$/)).toBeNull();
  });

  it("explains the consequence of the action to a non-technical owner", () => {
    render(
      <StorefrontInbox entries={[inquiry()]} defaultDigitalProduct={defaultDigitalProduct} />,
    );
    expect(
      screen.getByText(/Creates an internal work item for your team to follow up\. The customer isn't notified\./),
    ).toBeTruthy();
  });

  it("keeps each row uniquely targetable when multiple inquiries exist", () => {
    render(
      <StorefrontInbox
        entries={[
          inquiry(),
          inquiry({ id: "inq_2", ref: "INQ-SECOND22", name: "Second Guest" }),
        ]}
        defaultDigitalProduct={defaultDigitalProduct}
      />,
    );
    expect(screen.getByRole("button", { name: /send inquiry INQ-0001 to backlog/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /send inquiry INQ-SECOND22 to backlog/i })).toBeTruthy();
  });
});
