// @vitest-environment jsdom
//
// Route-level accessible-submit-contract coverage for /admin "Create user"
// (renders <AdminUserAccessPanel />). BI-8E74C749.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/users", () => ({
  createUserAccount: vi.fn(),
  adminIssuePasswordReset: vi.fn(),
}));

import { AdminUserAccessPanel } from "./AdminUserAccessPanel";

const roles = [
  { roleId: "HR-100", name: "HR Manager" },
  { roleId: "OPS-200", name: "Operations" },
];
const users = [{ id: "u1", email: "person@company.com" }];

afterEach(() => cleanup());

describe("AdminUserAccessPanel accessible contract", () => {
  it("labels every create-user control and wires names + password autocomplete", () => {
    render(<AdminUserAccessPanel roles={roles} users={users} />);

    const email = screen.getByLabelText(/email/i);
    expect(email).toHaveAttribute("name", "new-user-email");
    expect(email).toHaveAttribute("type", "email");
    // An admin creating another account should not autofill their own address.
    expect(email).toHaveAttribute("autocomplete", "off");

    const password = screen.getByLabelText(/temporary password/i);
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(password).toBeRequired();

    expect(screen.getByLabelText(/primary role/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/superuser/i)).toHaveAttribute("type", "checkbox");
  });

  it("explains the consequence of creating a user (what/who/reversible/recovery)", () => {
    render(<AdminUserAccessPanel roles={roles} users={users} />);
    // Summary is always visible; the four details expand via progressive disclosure.
    // The four term labels appear on every ConsequenceNotice, so assert presence
    // (>= 1) rather than uniqueness here — the create-specific copy is the summary.
    expect(screen.getByText(/creates a new sign-in and grants portal access/i)).toBeInTheDocument();
    expect(screen.getAllByText(/what changes/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/who's affected/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/can it be undone/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/if it was a mistake/i).length).toBeGreaterThanOrEqual(1);
  });

  it("explains the consequence of a password reset", () => {
    render(<AdminUserAccessPanel roles={roles} users={users} />);
    expect(
      screen.getByText(/ends the user's current password and issues a recovery link/i),
    ).toBeInTheDocument();
  });

  it("renders both submit actions", () => {
    render(<AdminUserAccessPanel roles={roles} users={users} />);
    expect(screen.getByRole("button", { name: /create user/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /issue recovery/i })).toBeInTheDocument();
  });
});
