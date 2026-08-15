// @vitest-environment jsdom

// Mobile smoke for the public booking flow at phone width (BI-2B2FCB2B):
// calendar day buttons and time-slot buttons carry a 44px touch-target floor and
// full-context accessible names, and the final form keeps the selected slot as
// the single source of truth (no duplicate editable preferred date/time).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/storefront-actions", () => ({
  submitBooking: vi.fn(),
}));

import { SlotBookingFlow } from "./SlotBookingFlow";
import { submitBooking } from "@/lib/storefront-actions";

// Tomorrow in local time — a clickable (non-past) calendar day. If tomorrow
// rolls into the next month the test clicks "Next month" first.
const now = new Date();
const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(
  tomorrow.getDate(),
).padStart(2, "0")}`;
const tomorrowLabel = tomorrow.toLocaleDateString("default", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

function stubBookingFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/dates")) {
      return { ok: true, json: async () => ({ dates: [tomorrowStr] }) };
    }
    if (url.includes("/slots")) {
      return {
        ok: true,
        json: async () => ({
          mode: "next-available",
          slots: [{ startTime: "18:30", endTime: "20:00" }],
        }),
      };
    }
    if (url.includes("/hold")) {
      return { ok: true, json: async () => ({ holderToken: "tok_1" }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderFlowAtSlotStep() {
  stubBookingFetch();
  render(
    <SlotBookingFlow
      orgSlug="demo-restaurant"
      itemId="itm-1"
      itemInternalId="cuid-1"
      itemName="Table for 2"
      timezone="Europe/London"
      bookingConfig={null}
      resourceNoun="table"
    />,
  );
  if (tomorrow.getMonth() !== now.getMonth()) {
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  }
  const dayButton = await screen.findByRole("button", {
    name: `${tomorrowLabel} — available`,
  });
  return dayButton;
}

describe("public booking mobile contract (390px floor)", () => {
  it("gives calendar day buttons a 44px floor and a full-date accessible name", async () => {
    const dayButton = await renderFlowAtSlotStep();
    expect((dayButton as HTMLButtonElement).style.minHeight).toBe("44px");
  });

  it("labels time-slot buttons with the full slot context and a 44px floor", async () => {
    const dayButton = await renderFlowAtSlotStep();
    fireEvent.click(dayButton);

    const slotButton = await screen.findByRole("button", {
      name: `6:30 PM to 8:00 PM on ${tomorrowLabel}`,
    });
    expect((slotButton as HTMLButtonElement).style.minHeight).toBe("44px");
    expect((slotButton as HTMLButtonElement).style.minWidth).toBe("44px");
  });

  it("keeps the selected slot authoritative on the final form — no duplicate date/time fields", async () => {
    const dayButton = await renderFlowAtSlotStep();
    fireEvent.click(dayButton);
    fireEvent.click(await screen.findByRole("button", { name: `6:30 PM to 8:00 PM on ${tomorrowLabel}` }));

    // Final form: the reservation summary states the fixed slot…
    const summary = await screen.findByRole("group", { name: "Your reservation" });
    await waitFor(() => expect(summary.textContent).toContain("6:30 PM — 8:00 PM"));
    expect(summary.textContent).toContain(tomorrowLabel);
    expect(summary.textContent).toContain("To change the date or time, go back and pick another slot.");

    // …and no editable preferred-date/preferred-time controls re-ask for it.
    expect(screen.queryByLabelText(/preferred date/i)).toBeNull();
    expect(screen.queryByLabelText(/preferred time/i)).toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(document.querySelector('input[type="time"]')).toBeNull();
  });

  it("submits on LAN HTTP when randomUUID is unavailable", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(9),
    });
    vi.mocked(submitBooking).mockResolvedValueOnce({
      success: false,
      error: "Synthetic stop after idempotency assertion",
    });

    const dayButton = await renderFlowAtSlotStep();
    fireEvent.click(dayButton);
    fireEvent.click(await screen.findByRole("button", { name: `6:30 PM to 8:00 PM on ${tomorrowLabel}` }));
    fireEvent.change(await screen.findByLabelText("Full name *"), { target: { value: "Taylor Guest" } });
    fireEvent.change(screen.getByLabelText("Email address *"), { target: { value: "taylor@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));

    await waitFor(() => expect(submitBooking).toHaveBeenCalledTimes(1));
    expect(vi.mocked(submitBooking).mock.calls[0]?.[1].idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
