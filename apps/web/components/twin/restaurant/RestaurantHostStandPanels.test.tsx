// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createWalkIn: vi.fn() }));
vi.mock("@/lib/twin/restaurant-floor-actions", () => ({
  createRestaurantWalkIn: mocks.createWalkIn,
}));

import {
  RestaurantCapacityTimeline,
  RestaurantWalkInIntake,
} from "./RestaurantHostStandPanels";

describe("Restaurant host-stand panels", () => {
  beforeEach(() => {
    mocks.createWalkIn.mockReset();
    mocks.createWalkIn.mockResolvedValue({ ok: true, bookingId: "booking-1", bookingRef: "BK-1", replayed: false });
  });

  it("captures a name and party size while leaving contact optional", async () => {
    const onCreated = vi.fn();
    render(<RestaurantWalkInIntake onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: "Add walk-in" }));
    expect(screen.getByRole("textbox", { name: "Party name" })).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox", { name: "Party name" }), { target: { value: "Riley Chen" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Guests" }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to waitlist" }));
    await waitFor(() => expect(mocks.createWalkIn).toHaveBeenCalledWith(expect.objectContaining({ name: "Riley Chen", covers: 3, phone: "" })));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("shows booked covers and splits online from protected open tables", () => {
    const startsAt = new Date(Date.now());
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    render(<RestaurantCapacityTimeline slots={[{
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      reservationCount: 2,
      reservedCovers: 7,
      onlineOpen: 3,
      inHouseOpen: 1,
    }]} />);
    expect(screen.getByRole("heading", { name: "Reservations and open tables" })).toBeInTheDocument();
    expect(screen.getByText("2 reserved · 7 guests")).toBeInTheDocument();
    expect(screen.getByText("3 open")).toBeInTheDocument();
    expect(screen.getByText("1 open")).toBeInTheDocument();
  });
});
