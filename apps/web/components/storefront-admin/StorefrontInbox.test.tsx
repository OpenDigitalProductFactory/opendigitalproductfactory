// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StorefrontInbox } from "./StorefrontInbox";

afterEach(() => cleanup());

const defaultDigitalProduct = { id: "dp_1", name: "Open Digital Product Factory" };

function inquiry(overrides: Record<string, unknown> = {}) {
  return {
    id: "inq_1",
    ref: "INQ-0001",
    name: "Jane Prospect",
    email: "jane@example.com",
    type: "inquiry",
    detail: "I want to run product ops on DPF.",
    createdAt: "2026-07-20T10:00:00.000Z",
    providerName: null,
    status: "",
    backlogItemId: null,
    ...overrides,
  };
}

describe("StorefrontInbox send-to-backlog state", () => {
  it("offers an enabled Send to backlog action when the inquiry is untracked", () => {
    render(
      <StorefrontInbox entries={[inquiry()]} defaultDigitalProduct={defaultDigitalProduct} />,
    );
    const button = screen.getByRole("button", { name: /send inquiry INQ-0001 to backlog/i });
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("replaces the action with a completed marker and a direct link once tracked", () => {
    render(
      <StorefrontInbox
        entries={[inquiry({ backlogItemId: "BI-SFI-INQ0001" })]}
        defaultDigitalProduct={defaultDigitalProduct}
      />,
    );

    // No lingering enabled action beside a tracked inquiry.
    expect(screen.queryByRole("button", { name: /send inquiry INQ-0001 to backlog/i })).toBeNull();

    // Unmistakable completed state plus an owner-readable link to the item.
    expect(screen.getByText(/sent to backlog/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /open backlog item BI-SFI-INQ0001 for inquiry INQ-0001/i });
    expect(link.getAttribute("href")).toBe("/ops?itemId=BI-SFI-INQ0001");
    expect(link.textContent).toContain("BI-SFI-INQ0001");
  });

  it("disables the action when backlog sending is unavailable", () => {
    render(<StorefrontInbox entries={[inquiry()]} defaultDigitalProduct={null} />);
    const button = screen.getByRole("button", { name: /send inquiry INQ-0001 to backlog/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
