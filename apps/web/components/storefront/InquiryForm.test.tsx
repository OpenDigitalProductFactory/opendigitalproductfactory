// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const submitInquiry = vi.fn();
const push = vi.fn();

vi.mock("@/lib/storefront-actions", () => ({
  submitInquiry: (...args: unknown[]) => submitInquiry(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { InquiryForm } from "./InquiryForm";

const SCHEMA = [
  { name: "name", label: "Your name", type: "text", required: true },
  { name: "email", label: "Email address", type: "email", required: true },
  { name: "message", label: "Message", type: "textarea", required: false },
];

beforeEach(() => {
  cleanup();
  submitInquiry.mockReset();
  push.mockReset();
});

describe("InquiryForm empty/invalid submit", () => {
  it("shows a visible error summary and does not submit or navigate", async () => {
    render(<InquiryForm orgSlug="acme" formSchema={SCHEMA} />);
    fireEvent.submit(screen.getByRole("button", { name: /send enquiry/i }).closest("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/before sending/i);
    // Inline errors reference the two required fields.
    expect(alert.textContent).toMatch(/Your name is required/);
    expect(alert.textContent).toMatch(/Email address is required/);
    // No side effects on an invalid submit.
    expect(submitInquiry).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("marks the invalid fields with aria-invalid", async () => {
    render(<InquiryForm orgSlug="acme" formSchema={SCHEMA} />);
    fireEvent.submit(screen.getByRole("button", { name: /send enquiry/i }).closest("form")!);
    await screen.findByRole("alert");
    expect(screen.getByLabelText(/Your name/).getAttribute("aria-invalid")).toBe("true");
  });
});

describe("InquiryForm valid submit", () => {
  it("calls the action once and routes to the named inquiry result page", async () => {
    submitInquiry.mockResolvedValue({ success: true, ref: "INQ-ABC123", type: "inquiry" });
    render(<InquiryForm orgSlug="acme" formSchema={SCHEMA} />);

    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Ada Lovelace" } });
    fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: "ada@example.com" } });
    fireEvent.submit(screen.getByRole("button", { name: /send enquiry/i }).closest("form")!);

    await waitFor(() => expect(submitInquiry).toHaveBeenCalledTimes(1));
    expect(submitInquiry).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ customerName: "Ada Lovelace", customerEmail: "ada@example.com" }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/s/acme/inquiry/received?ref=INQ-ABC123"),
    );
  });

  it("surfaces a server error without navigating", async () => {
    submitInquiry.mockResolvedValue({ success: false, error: "Storefront not found or not published" });
    render(<InquiryForm orgSlug="acme" formSchema={SCHEMA} />);

    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: "ada@example.com" } });
    fireEvent.submit(screen.getByRole("button", { name: /send enquiry/i }).closest("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not found or not published/i);
    expect(push).not.toHaveBeenCalled();
  });
});
