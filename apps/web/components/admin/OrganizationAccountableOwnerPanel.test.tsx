// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/actions/organization-accountable-owner", () => ({
  setOrganizationAccountableOwner: vi.fn(),
}));

import { OrganizationAccountableOwnerPanel } from "./OrganizationAccountableOwnerPanel";

const candidates = [
  { id: "p-1", displayName: "Avery Owner", email: "avery@example.test" },
  { id: "p-2", displayName: "Blair Lead", email: "blair@example.test" },
];

afterEach(() => cleanup());

describe("OrganizationAccountableOwnerPanel", () => {
  it("arrives collapsed as one line naming the owner", () => {
    render(<OrganizationAccountableOwnerPanel owner={{ id: "p-1", displayName: "Avery Owner" }} candidates={candidates} />);
    expect(screen.getByText("Accountable owner:")).toBeInTheDocument();
    expect(screen.getByText("Avery Owner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Every workroom without its own owner/)).not.toBeInTheDocument();
  });

  it("reveals the picker and the consequence on Change", () => {
    render(<OrganizationAccountableOwnerPanel owner={{ id: "p-1", displayName: "Avery Owner" }} candidates={candidates} />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const picker = screen.getByLabelText("Accountable owner");
    expect(picker).toHaveValue("p-1");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Choose a person",
      "Avery Owner (avery@example.test)",
      "Blair Lead (blair@example.test)",
    ]);
    expect(screen.getByText("Every workroom without its own owner answers to this person.")).toBeInTheDocument();
  });

  it("says no owner is recorded and offers Set when unset", () => {
    render(<OrganizationAccountableOwnerPanel owner={null} candidates={candidates} />);
    expect(screen.getByText("No accountable owner recorded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
