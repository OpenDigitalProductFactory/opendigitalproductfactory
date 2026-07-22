// @vitest-environment jsdom
//
// Route-level accessible-submit-contract coverage for the Restaurant (and other
// archetype) booking/intake form rendered on /s/[slug]/book/*. BI-8E74C749.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/storefront-actions", () => ({ submitBooking: vi.fn() }));

import { BookingForm } from "./BookingForm";

const props = {
  orgSlug: "trattoria",
  itemId: "item-1",
  itemName: "Table for two",
  durationMinutes: 90,
};

afterEach(() => cleanup());

describe("BookingForm accessible contract", () => {
  it("labels the contact fields with correct autocomplete + required state", () => {
    render(<BookingForm {...props} />);

    const name = screen.getByLabelText(/full name/i);
    expect(name).toHaveAttribute("name", "name");
    expect(name).toHaveAttribute("autocomplete", "name");
    expect(name).toBeRequired();

    const email = screen.getByLabelText(/email address/i);
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toBeRequired();
  });

  it("marks phone optional and not required", () => {
    render(<BookingForm {...props} />);
    const phone = screen.getByLabelText(/phone/i);
    expect(phone).toHaveAttribute("name", "phone");
    expect(phone).toHaveAttribute("autocomplete", "tel");
    expect(phone).not.toBeRequired();
  });

  it("requires date and time and exposes an optional notes field", () => {
    render(<BookingForm {...props} />);
    expect(screen.getByLabelText(/date/i)).toBeRequired();
    expect(screen.getByLabelText(/time/i)).toBeRequired();
    expect(screen.getByLabelText(/notes/i)).not.toBeRequired();
  });

  it("renders the submit action for the item", () => {
    render(<BookingForm {...props} />);
    expect(screen.getByRole("button", { name: /book table for two/i })).toBeInTheDocument();
  });
});
