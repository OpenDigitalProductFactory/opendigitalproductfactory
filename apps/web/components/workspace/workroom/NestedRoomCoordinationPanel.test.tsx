import { cleanup, fireEvent, render as renderComponent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { DEFAULT_LOCALE } from "@dpf/i18n/runtime";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { afterEach, expect, it } from "vitest";
import { NestedRoomCoordinationPanel } from "./NestedRoomCoordinationPanel";
afterEach(cleanup);
function render(component: ReactNode) {
  return renderComponent(<MessagesProvider locale={DEFAULT_LOCALE}
    messages={{ workrooms: namespaceMessages(DEFAULT_LOCALE, "workrooms") }}>{component}</MessagesProvider>);
}

it("keeps the recorded chain behind an accessible inline disclosure without claiming notification or approval", () => {
  render(<NestedRoomCoordinationPanel coordination={{ delegations: [], escalation: { state: "resolved", steps: [
    { kind: "room-owner", ref: "worker", displayName: "Release reviewer" },
    { kind: "human", ref: "human", displayName: "Alex Morgan" },
  ] } }} />);
  const trigger = screen.getByRole("button", { name: /Delegation and recovery/i });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Release reviewer")).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByText("Release reviewer")).toBeTruthy();
  expect(screen.getByText("Alex Morgan")).toBeTruthy();
  expect(screen.getByText(/Check the activity timeline for actual notifications and decisions/)).toBeTruthy();
});
it("shows a useful setup message without exposing withheld parent names", () => {
  render(<NestedRoomCoordinationPanel coordination={{ delegations: [], escalation: {
    state: "setup-required", reason: "incomplete-responsibility-lineage", steps: [],
  } }} />);
  expect(screen.getByText(/Recovery path needs attention/)).toBeTruthy();
  expect(screen.queryByText(/Ask the parent Workroom's owner for access/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Recovery path needs attention/ }));
  expect(screen.getByText(/Ask the parent Workroom's owner for access/)).toBeTruthy();
  expect(screen.queryByText(/PRN-/)).toBeNull();
});
// @vitest-environment jsdom
