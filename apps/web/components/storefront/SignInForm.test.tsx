// @vitest-environment jsdom
//
// Route-level accessible-submit-contract coverage for /portal/sign-in and
// /s/[slug]/sign-in (both render <SignInForm />). BI-8E74C749.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

import { SignInForm } from "./SignInForm";

afterEach(() => cleanup());

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
