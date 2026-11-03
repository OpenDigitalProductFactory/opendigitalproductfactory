// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render as renderUi, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./ShellSignOut", () => ({ ShellSignOut: () => <button>Sign out</button> }));
import { ShellAccount } from "./ShellAccount";
afterEach(cleanup);
const render = (ui: ReactNode) => renderUi(<MessagesProvider locale="en-US" messages={{ shell: namespaceMessages("en-US", "shell") }}>{ui}</MessagesProvider>);
const account = { displayName: "Alex Morgan", email: "alex@example.com", roleName: "Administrator", organizationName: "Example organization" };

describe("shell account disclosure", () => {
  it("keeps the name visible and exposes complete details in one disclosure", () => {
    const { container } = render(<ShellAccount {...account} />);
    const summary = container.querySelector("summary")!;
    expect(summary).toHaveTextContent("Alex Morgan");
    expect(summary).toHaveAccessibleName("Signed in as Alex Morgan — account details");
    fireEvent.click(summary);
    expect(container.querySelector("details")).toHaveAttribute("open");
    expect(screen.getByText("alex@example.com")).toBeVisible();
    expect(screen.getByText("Administrator")).toBeVisible();
    expect(screen.getByText("Example organization")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
  it("closes on Escape and returns focus to the trigger", () => {
    const { container } = render(<ShellAccount {...account} />);
    const summary = container.querySelector("summary")!;
    fireEvent.click(summary);
    fireEvent.keyDown(screen.getByRole("button", { name: "Sign out" }), { key: "Escape" });
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(summary).toHaveFocus();
  });
  it("uses email when the display name is blank and closes on outside interaction", () => {
    const { container } = render(<ShellAccount {...account} displayName=" " />);
    const summary = container.querySelector("summary")!;
    expect(summary).toHaveAccessibleName("Signed in as alex@example.com — account details");
    fireEvent.click(summary);
    fireEvent.pointerDown(document.body);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });
});
