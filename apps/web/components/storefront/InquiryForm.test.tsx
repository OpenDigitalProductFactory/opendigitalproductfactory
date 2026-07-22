// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const submitInquiry = vi.fn();
vi.mock("@/lib/storefront-actions", () => ({
  submitInquiry: (...args: unknown[]) => submitInquiry(...args),
}));

import { InquiryForm } from "./InquiryForm";

const SCHEMA = [
  { name: "name", label: "Your name", type: "text", required: true },
  { name: "email", label: "Email address", type: "email", required: true },
  { name: "phone", label: "Phone number", type: "tel", required: false },
  { name: "message", label: "Message", type: "textarea", required: false },
];

function setup() {
  return render(<InquiryForm orgSlug="bella-trattoria" formSchema={SCHEMA} />);
}

beforeEach(() => {
  push.mockReset();
  submitInquiry.mockReset();
});
afterEach(() => cleanup());

describe("InquiryForm — empty validation", () => {
  it("shows a visible accessible summary and blocks submit on empty required fields", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /send enquiry/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain("Your name is required");
    expect(alert.textContent).toContain("Email address is required");

    // No network action, no navigation — browser-native blocking is not relied on.
    expect(submitInquiry).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("marks invalid fields with aria-invalid and links the inline error", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /send enquiry/i }));
    await screen.findByRole("alert");

    const nameInput = screen.getByLabelText(/your name/i);
    expect(nameInput.getAttribute("aria-invalid")).toBe("true");
    expect(nameInput.getAttribute("aria-describedby")).toBe("inquiry-name-error");
  });

  it("rejects a malformed email without submitting", async () => {
    setup();
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Guest" } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /send enquiry/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Enter a valid email address");
    expect(submitInquiry).not.toHaveBeenCalled();
  });
});

describe("InquiryForm — safe successful submit", () => {
  it("submits valid data and navigates to the named result route", async () => {
    submitInquiry.mockResolvedValue({ success: true, ref: "INQ-XYZ789", type: "inquiry" });
    setup();

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "UX Study Guest" } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "guest@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send enquiry/i }));

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    expect(submitInquiry).toHaveBeenCalledWith(
      "bella-trattoria",
      expect.objectContaining({ customerName: "UX Study Guest", customerEmail: "guest@example.com" }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/s/bella-trattoria/inquiry/received?ref=INQ-XYZ789"),
    );
    // Never routes through /checkout for an inquiry.
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining("/checkout"));
  });

  it("surfaces a server error without navigating", async () => {
    submitInquiry.mockResolvedValue({ success: false, error: "Storefront not published" });
    setup();

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Guest" } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "guest@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send enquiry/i }));

    expect(await screen.findByText("Storefront not published")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
