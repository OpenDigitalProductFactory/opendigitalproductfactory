// @vitest-environment jsdom
//
// Route-level accessible-submit-contract coverage for /s/[slug]/sign-up
// (renders <SignUpForm />). BI-8E74C749.
//
// Also covers BI-CC4BEB5F: returnTo must survive account creation and the
// cross-link back to sign-in.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const signInMock = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signInMock(...args) }));

const originalFetch = global.fetch;

import { SignUpForm } from "./SignUpForm";

afterEach(() => {
  cleanup();
  push.mockClear();
  signInMock.mockClear();
  global.fetch = originalFetch;
});

async function submitSignUp() {
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ada Guest" } });
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "guest@example.com" } });
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "correct-horse-battery" } });
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "correct-horse-battery" } });
  fireEvent.click(screen.getByRole("button", { name: /create account/i }));
  await waitFor(() => expect(signInMock).toHaveBeenCalled());
}

describe("SignUpForm accessible contract", () => {
  it("marks the name field required (regression: it used to be unmarked)", () => {
    render(<SignUpForm orgSlug="acme" />);
    const name = screen.getByLabelText(/full name/i);
    expect(name).toHaveAttribute("name", "name");
    expect(name).toHaveAttribute("autocomplete", "name");
    expect(name).toBeRequired();
  });

  it("uses the new-password autocomplete hint on both password fields", () => {
    render(<SignUpForm orgSlug="acme" />);
    const password = screen.getByLabelText(/^password/i);
    const confirm = screen.getByLabelText(/confirm password/i);
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(confirm).toHaveAttribute("autocomplete", "new-password");
  });

  it("shows inline validation when the confirmation does not match", () => {
    render(<SignUpForm orgSlug="acme" />);
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "abcdefghijkl" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "different" } });
    const confirm = screen.getByLabelText(/confirm password/i);
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/passwords do not match/i);
    expect(screen.getByRole("button", { name: /create account/i })).toBeDisabled();
  });
});

describe("SignUpForm journey-context navigation (BI-CC4BEB5F)", () => {
  function mockFetchOk() {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
  }

  it("routes to the storefront home, not /portal, when no returnTo is given", async () => {
    mockFetchOk();
    render(<SignUpForm orgSlug="bistro" />);
    await submitSignUp();
    expect(push).toHaveBeenCalledWith("/s/bistro");
  });

  it("routes back to the booking/inquiry/order page captured as returnTo", async () => {
    mockFetchOk();
    render(<SignUpForm orgSlug="bistro" returnTo="/s/bistro/book/itm-42" />);
    await submitSignUp();
    expect(push).toHaveBeenCalledWith("/s/bistro/book/itm-42");
  });

  it("rejects an off-storefront returnTo (open-redirect) and falls back to the storefront home", async () => {
    mockFetchOk();
    render(<SignUpForm orgSlug="bistro" returnTo="//evil.example" />);
    await submitSignUp();
    expect(push).toHaveBeenCalledWith("/s/bistro");
  });

  it("carries returnTo through the sign-in cross-link", () => {
    render(<SignUpForm orgSlug="bistro" returnTo="/s/bistro/book/itm-42" />);
    const signIn = screen.getByRole("link", { name: /sign in/i });
    expect(signIn).toHaveAttribute(
      "href",
      "/s/bistro/sign-in?returnTo=%2Fs%2Fbistro%2Fbook%2Fitm-42",
    );
  });
});
