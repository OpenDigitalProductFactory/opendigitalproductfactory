// @vitest-environment jsdom
//
// Regression coverage for BI-52648DB3: the public booking date step must never
// tell a customer "No availability this month" before an availability request
// has actually completed for the displayed month. Root cause was `datesLoading`
// initializing `false` and `availableDates` initializing empty, so the
// server-rendered / pre-hydration markup satisfied
// `!loading && !error && availableDates.size === 0` — the same predicate the
// empty-month message is gated on — even when the live API had dates.
//
// These tests hold the /dates fetch open with a deferred promise so the
// pre-resolution render is directly observable (not just asserted after
// `findBy*` has already waited it out), then resolve it to prove the
// no-availability message only appears after a completed empty response, and
// never appears when the response actually has dates for the visible month
// (the "API-consistency" acceptance check).

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/storefront-actions", () => ({
  submitBooking: vi.fn(),
}));

import { SlotBookingFlow } from "./SlotBookingFlow";

const NO_AVAILABILITY_TEXT = "No availability this month. Try the next month or check back soon.";
const LOADING_TEXT = "Loading availability…";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Stubs `fetch` for the /dates endpoint with a promise the caller controls,
 *  so the pending (pre-resolution) render can be asserted directly. */
function stubDatesFetch() {
  const gate = deferred<{ dates: string[] }>();
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/dates")) {
      const data = await gate.promise;
      return { ok: true, json: async () => data };
    }
    throw new Error(`Unexpected fetch in this test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, resolveDates: gate.resolve };
}

function renderFlow() {
  return render(
    <SlotBookingFlow
      orgSlug="demo-restaurant"
      itemId="itm-1"
      itemInternalId="cuid-1"
      itemName="Table for 2"
      timezone="Europe/London"
      bookingConfig={null}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BI-52648DB3: booking date step never shows a false no-availability dead end", () => {
  it("shows the neutral 'Checking'/loading state on initial render, not the no-availability message", () => {
    stubDatesFetch();
    renderFlow();

    // Pre-resolution: the /dates request is still in flight (the fetch
    // promise has not been resolved yet), simulating server-rendered /
    // pre-hydration markup and slow-hydration client state alike.
    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(NO_AVAILABILITY_TEXT)).toBeNull();
  });

  it("shows the no-availability message only after a completed empty response", async () => {
    const { resolveDates } = stubDatesFetch();
    renderFlow();

    expect(screen.queryByText(NO_AVAILABILITY_TEXT)).toBeNull();

    resolveDates({ dates: [] });

    await waitFor(() => expect(screen.getByText(NO_AVAILABILITY_TEXT)).toBeInTheDocument());
    expect(screen.queryByText(LOADING_TEXT)).toBeNull();
  });

  it("API-consistency: never exposes the no-availability dead end when the dates API has dates for the visible month", async () => {
    const { resolveDates } = stubDatesFetch();
    renderFlow();

    // Before the response lands: neutral loading, not a false dead end.
    expect(screen.queryByText(NO_AVAILABILITY_TEXT)).toBeNull();

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`;
    resolveDates({ dates: [dateStr] });

    // After the response lands with dates for the visible month: still no
    // false dead end, and the loading state has cleared.
    await waitFor(() => expect(screen.queryByText(LOADING_TEXT)).toBeNull());
    expect(screen.queryByText(NO_AVAILABILITY_TEXT)).toBeNull();
  });
});
