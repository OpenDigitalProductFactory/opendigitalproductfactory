// @vitest-environment jsdom
//
// Route-level accessible-submit-contract coverage for /portal/sign-in and
// /s/[slug]/sign-in (both render <SignInForm />). BI-8E74C749.
//
// Also covers BI-CC4BEB5F: a Restaurant guest stepping out of a public
// booking/inquiry/order route to sign in must land back on that route (or the
// storefront home, never the internal /portal) after a successful sign-in,
// forgot-password must be reachable, and "Staff login" must not read as a
// peer option to "Create an account".
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const signInMock = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signInMock(...args) }));

import { SignInForm } from "./SignInForm";

afterEach(() => {
  cleanup();
  push.mockClear();
  signInMock.mockClear();
});

async function submitSignIn() {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "guest@example.com" } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "correct-horse-battery" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await waitFor(() => expect(signInMock).toHaveBeenCalled());
}

describe("SignInForm accessible contract", () => {
  it("labels the email field and wires name + username autocomplete", () => {
    render(<SignInForm />);
    const email = screen.getByLabelText(/email address/i);
    expect(email).toHaveAttribute("name", "email");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(email).toBeRequired();
  });

  it("labels the password field with the current-password autocomplete hint", () => {
    render(<SignInForm />);
    const password = screen.getByLabelText(/password/i);
    expect(password).toHaveAttribute("name", "password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toBeRequired();
  });

  it("renders an accessible submit button", () => {
    render(<SignInForm />);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });
});

describe("SignInForm journey-context navigation (BI-CC4BEB5F)", () => {
  it("routes to the storefront home, not /portal, when no returnTo is given", async () => {
    render(<SignInForm orgSlug="bistro" />);
    await submitSignIn();
    expect(push).toHaveBeenCalledWith("/s/bistro");
  });

  it("routes back to the booking/inquiry/order page captured as returnTo", async () => {
    render(<SignInForm orgSlug="bistro" returnTo="/s/bistro/book/itm-42" />);
    await submitSignIn();
    expect(push).toHaveBeenCalledWith("/s/bistro/book/itm-42");
  });

  it("rejects an off-storefront returnTo (open-redirect) and falls back to the storefront home", async () => {
    render(<SignInForm orgSlug="bistro" returnTo="https://evil.example/phish" />);
    await submitSignIn();
    expect(push).toHaveBeenCalledWith("/s/bistro");
  });

  it("still routes to /portal (unchanged) when this form isn't storefront-scoped", async () => {
    render(<SignInForm />);
    await submitSignIn();
    expect(push).toHaveBeenCalledWith("/portal");
  });

  it("carries returnTo through the create-account link", () => {
    render(<SignInForm orgSlug="bistro" returnTo="/s/bistro/book/itm-42" />);
    const createAccount = screen.getByRole("link", { name: /create an account/i });
    expect(createAccount).toHaveAttribute(
      "href",
      "/s/bistro/sign-up?returnTo=%2Fs%2Fbistro%2Fbook%2Fitm-42",
    );
  });

  it("links to forgot-password", () => {
    render(<SignInForm orgSlug="bistro" />);
    expect(screen.getByRole("link", { name: /forgot password/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("demotes staff login below and apart from the customer create-account CTA", () => {
    render(<SignInForm orgSlug="bistro" />);
    const staffLink = screen.getByRole("link", { name: /sign in here/i });
    const createAccount = screen.getByRole("link", { name: /create an account/i });
    expect(staffLink).toHaveAttribute("href", "/login");
    // Staff login must not be the same DOM row as the customer CTA (no longer
    // joined by " · " into one line) — it lives in its own, separately
    // de-emphasized container.
    expect(staffLink.parentElement).not.toBe(createAccount.parentElement);
  });
});
