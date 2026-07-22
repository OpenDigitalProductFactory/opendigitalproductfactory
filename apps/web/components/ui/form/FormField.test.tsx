// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FormField } from "./FormField";
import { TextField } from "./TextField";

afterEach(() => cleanup());

describe("FormField", () => {
  it("binds label to control via htmlFor/id and wires the name", () => {
    render(
      <FormField name="email" label="Email address">
        {(control) => <input {...control} type="email" />}
      </FormField>,
    );
    const input = screen.getByLabelText(/email address/i);
    expect(input).toHaveAttribute("name", "email");
    expect(input.getAttribute("id")).toBeTruthy();
  });

  it("exposes required state visibly and to assistive tech", () => {
    render(
      <FormField name="email" label="Email" required>
        {(control) => <input {...control} type="email" />}
      </FormField>,
    );
    const input = screen.getByLabelText(/email/i);
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-required", "true");
    // Visible marker + screen-reader "(required)" text.
    expect(screen.getByText("*")).toBeInTheDocument();
    expect(screen.getByText(/\(required\)/i)).toBeInTheDocument();
  });

  it("marks a field optional when requested", () => {
    render(
      <FormField name="phone" label="Phone" optional>
        {(control) => <input {...control} type="tel" />}
      </FormField>,
    );
    expect(screen.getByText(/\(optional\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).not.toBeRequired();
  });

  it("associates a hint through aria-describedby", () => {
    render(
      <FormField name="password" label="Password" hint="At least 12 characters.">
        {(control) => <input {...control} type="password" />}
      </FormField>,
    );
    const input = screen.getByLabelText(/password/i);
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const hint = screen.getByText(/at least 12 characters/i);
    expect(describedBy).toContain(hint.id);
  });

  it("flags invalid state and announces the error via role=alert", () => {
    render(
      <FormField name="confirm" label="Confirm" error="Passwords do not match.">
        {(control) => <input {...control} type="password" />}
      </FormField>,
    );
    const input = screen.getByLabelText(/confirm/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/passwords do not match/i);
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("does not collide ids across two fields with the same name", () => {
    render(
      <>
        <TextField name="email" label="Primary email" value="" onValueChange={() => {}} />
        <TextField name="email" label="Backup email" value="" onValueChange={() => {}} />
      </>,
    );
    const a = screen.getByLabelText(/primary email/i);
    const b = screen.getByLabelText(/backup email/i);
    expect(a.id).not.toEqual(b.id);
  });
});
