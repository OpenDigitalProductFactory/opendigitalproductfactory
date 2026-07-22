// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const dialogMocks = vi.hoisted(() => ({
  confirmDialog: vi.fn(),
  promptDialog: vi.fn(),
}));
vi.mock("@/components/ui/Dialog", () => dialogMocks);

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  dialogMocks.confirmDialog.mockReset();
  dialogMocks.promptDialog.mockReset();
});

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "bk_1",
    ref: "BK-0001",
    name: "Jane Smith",
    email: "jane.smith@example.com",
    type: "booking",
    detail: "Wednesday, July 22",
    createdAt: "2026-07-20T10:00:00.000Z",
    providerName: null,
    status: "pending",
    backlogItemId: null,
    itemName: "Table for 2",
    covers: 2,
    whenLabel: "Wednesday, July 22 · 6:30 PM",
    timeLabel: "6:30 PM",
    nextAction: "Confirm or decline",
    ...overrides,
  };
}

function stubFetch(response: { ok: boolean; body?: Record<string, unknown> }) {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok,
    json: async () => response.body ?? {},
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

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

// ── Booking action-result contract (BI-3DA1DFDC) ─────────────────────────────
describe("StorefrontInbox — booking confirm/cancel result states", () => {
  it("reviews the exact reservation before confirming, then shows a success state without reloading", async () => {
    dialogMocks.confirmDialog.mockResolvedValue(true);
    const fetchMock = stubFetch({ ok: true });
    render(<StorefrontInbox entries={[booking()]} defaultDigitalProduct={defaultDigitalProduct} />);

    fireEvent.click(screen.getByRole("button", { name: /confirm jane smith, table for 2 at 6:30 pm/i }));

    await waitFor(() =>
      expect(screen.getByText(/confirmed — the guest's booking is now confirmed\./i)).toBeTruthy(),
    );
    // Pre-action review named the exact reservation + consequence.
    expect(dialogMocks.confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/confirm jane smith, table for 2 at 6:30 pm/i),
        message: expect.stringMatching(/BK-0001.*becomes confirmed/i),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/storefront/bookings/bk_1/confirm", { method: "POST" });
    // The row's visible status updated in place — no window.location.reload().
    expect(screen.getByText("confirmed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /confirm jane smith/i })).toBeNull();
  });

  it("does nothing when the owner declines the confirm review", async () => {
    dialogMocks.confirmDialog.mockResolvedValue(false);
    const fetchMock = stubFetch({ ok: true });
    render(<StorefrontInbox entries={[booking()]} defaultDigitalProduct={defaultDigitalProduct} />);

    fireEvent.click(screen.getByRole("button", { name: /confirm jane smith/i }));
    await waitFor(() => expect(dialogMocks.confirmDialog).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a failed confirm as a row-specific retryable error, not a silent reload", async () => {
    dialogMocks.confirmDialog.mockResolvedValue(true);
    stubFetch({ ok: false, body: { error: "Booking already cancelled by the guest." } });
    render(<StorefrontInbox entries={[booking()]} defaultDigitalProduct={defaultDigitalProduct} />);

    fireEvent.click(screen.getByRole("button", { name: /confirm jane smith/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Booking already cancelled by the guest.");
    expect(alert.textContent).toMatch(/the booking is unchanged — try again/i);
    // The action is still available for retry.
    expect(screen.getByRole("button", { name: /confirm jane smith/i })).toBeTruthy();
  });

  it("names the reservation in the cancel dialog and shows the cancelled result", async () => {
    dialogMocks.promptDialog.mockResolvedValue("Guest phoned to cancel");
    const fetchMock = stubFetch({ ok: true });
    render(<StorefrontInbox entries={[booking()]} defaultDigitalProduct={defaultDigitalProduct} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel jane smith, table for 2 at 6:30 pm/i }));

    await waitFor(() =>
      expect(screen.getByText(/cancelled — the guest sees this booking as cancelled\./i)).toBeTruthy(),
    );
    expect(dialogMocks.promptDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/cancel jane smith, table for 2 at 6:30 pm/i),
        message: expect.stringMatching(/BK-0001.*guest will see this booking as cancelled/i),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/storefront/bookings/bk_1/cancel",
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.getByText("cancelled")).toBeTruthy();
  });
});

// ── Filter announcement + labelled provider select (BI-F0B389C9 residue) ─────
describe("StorefrontInbox — filter chips and provider select", () => {
  it("marks the active filter chip and announces the result count", () => {
    render(
      <StorefrontInbox
        entries={[inquiry(), booking()]}
        defaultDigitalProduct={defaultDigitalProduct}
      />,
    );
    const all = screen.getByRole("button", { name: /filter requests: all/i });
    expect(all.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /filter requests: booking/i }));
    expect(
      screen.getByRole("button", { name: /filter requests: booking/i }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("status").textContent).toMatch(/showing 1 of 2 requests — booking filter on/i);
  });

  it("gives the booking provider filter an accessible name", () => {
    render(
      <StorefrontInbox
        entries={[booking({ providerName: "Table 1" })]}
        providers={[{ id: "p1", name: "Table 1" }]}
        defaultDigitalProduct={defaultDigitalProduct}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /filter requests: booking/i }));
    expect(screen.getByRole("combobox", { name: /filter bookings by provider/i })).toBeTruthy();
  });
});
