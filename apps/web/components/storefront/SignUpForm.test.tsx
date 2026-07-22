// @vitest-environment jsdom
//
// Route-level accessible-submit-contract coverage for /s/[slug]/sign-up
// (renders <SignUpForm />). BI-8E74C749.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

import { SignUpForm } from "./SignUpForm";

afterEach(() => cleanup());

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
