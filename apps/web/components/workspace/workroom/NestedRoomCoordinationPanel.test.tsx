import { cleanup, fireEvent, waitFor, render as renderComponent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { DEFAULT_LOCALE } from "@dpf/i18n/runtime";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { afterEach, expect, it, vi } from "vitest";
import { NestedRoomCoordinationPanel, WorkroomBlockerInspectionLink } from "./NestedRoomCoordinationPanel";
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
afterEach(() => {
  cleanup(); window.history.replaceState(null, "", "/"); vi.restoreAllMocks();
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
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

const recordedBlocker = {
  reason: "workroom-blocked" as const,
  explanation: 'Transfer refused before request creation. {"owner":"unverified","tool":"retry"} https://example.invalid/execute',
  explanationState: "current" as const,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  source: { kind: "workroom-status-override" as const, capsuleId: "WC-ORIGINAL" },
  coordinationOnly: true as const,
};

it("reveals the exact recorded blocker as text without deriving a transfer, owner or executable link", () => {
  render(<NestedRoomCoordinationPanel coordination={null} recordedBlocker={recordedBlocker} />);
  expect(screen.queryByText(recordedBlocker.explanation)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Delegation and recovery/i }));
  expect(screen.getByText(recordedBlocker.explanation)).toBeTruthy();
  expect(screen.getByText("WC-ORIGINAL")).toBeTruthy();
  expect(screen.getByText(/This explanation does not authorize another attempt/)).toBeTruthy();
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(screen.getAllByRole("button")).toHaveLength(1);
});

it("opens and focuses the recorded blocker from an in-page inspection link without navigating away", async () => {
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  render(<NestedRoomCoordinationPanel coordination={null} recordedBlocker={recordedBlocker} />);
  window.location.hash = "workroom-recorded-blocker";
  fireEvent(window, new HashChangeEvent("hashchange"));
  await waitFor(() => expect(screen.getByRole("button", { name: /Delegation and recovery/i }).getAttribute("aria-expanded")).toBe("true"));
  const heading = screen.getByRole("heading", { name: "Recorded blocker" });
  expect(document.activeElement).toBe(heading);
  expect(scroll).toHaveBeenCalled();
});

it("keeps expired explanation text out of the disclosure while preserving the blocked state", () => {
  render(<NestedRoomCoordinationPanel coordination={null}
    recordedBlocker={{ ...recordedBlocker, explanationState: "expired", explanation: null, expiresAt: new Date(Date.now() - 86_400_000).toISOString() }} />);
  fireEvent.click(screen.getByRole("button", { name: /Delegation and recovery/i }));
  expect(screen.getByText(/The recorded explanation has expired/)).toBeTruthy();
  expect(screen.queryByText(recordedBlocker.explanation)).toBeNull();
});

it("can inspect again after closing the disclosure while the same fragment is already selected", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  render(<><WorkroomBlockerInspectionLink /><details open><summary>Other evidence</summary><p>Keep this open</p></details>
    <NestedRoomCoordinationPanel coordination={null} recordedBlocker={recordedBlocker} /></>);
  const link = screen.getByRole("link", { name: "Inspect recorded blocker" });
  window.history.replaceState(null, "", "/#workroom-recorded-blocker");
  fireEvent.click(link);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Recorded blocker" })));
  const trigger = screen.getByRole("button", { name: /Delegation and recovery/i });
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(link);
  await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Recorded blocker" }));
  expect(screen.getByText("Keep this open").closest("details")?.open).toBe(true);
  expect(window.location.pathname).toBe("/");
});

it("opens an initial blocker fragment and supports the existing expanded pseudo-locale catalog", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  window.history.replaceState(null, "", "/#workroom-recorded-blocker");
  renderComponent(<MessagesProvider locale="en-XA" messages={{ workrooms: namespaceMessages("en-XA", "workrooms") }}>
    <WorkroomBlockerInspectionLink /><NestedRoomCoordinationPanel coordination={null} recordedBlocker={recordedBlocker} />
  </MessagesProvider>);
  await waitFor(() => expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true"));
  expect(screen.getByRole("link").textContent).toContain("⟦");
  expect(screen.getByText(recordedBlocker.explanation)).toBeTruthy();
  expect(document.activeElement?.id).toBe("workroom-recorded-blocker");
});

it("does not reopen a manually closed blocker when a refreshed projection changes its text", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  window.history.replaceState(null, "", "/#workroom-recorded-blocker");
  const content = (explanation: string) => <MessagesProvider locale={DEFAULT_LOCALE}
    messages={{ workrooms: namespaceMessages(DEFAULT_LOCALE, "workrooms") }}>
    <NestedRoomCoordinationPanel coordination={null} recordedBlocker={{ ...recordedBlocker, explanation }} />
  </MessagesProvider>;
  const view = renderComponent(content("Original explanation"));
  const trigger = screen.getByRole("button", { name: /Delegation and recovery/i });
  await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  view.rerender(content("Refreshed explanation"));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("shows actual completed handoff history without stale retry or missing-owner copy",()=>{render(<NestedRoomCoordinationPanel coordination={null} recordedBlocker={recordedBlocker} failedHandoffRecovery={{kind:"failed-bounded-handoff",state:"resolved",reason:"handoff-completed-after-original-refusal",checkedAt:new Date().toISOString(),owner:{userId:"owner",agentId:"AGT-EXT-CODEX",executorRef:"recorded-source-chat"},original:{envelopeId:"original-refusal",executionId:"real-failed-execution",executedAt:new Date().toISOString()},action:null,resolution:{requestId:"real-later-request",activityId:"real-completion",recordedAt:new Date().toISOString()}}} />);fireEvent.click(screen.getByRole("button",{name:/Delegation and recovery/i}));expect(screen.getByText(/A later handoff completed/)).toBeTruthy();expect(screen.getByText("real-later-request")).toBeTruthy();expect(screen.getByText("AGT-EXT-CODEX")).toBeTruthy();expect(screen.queryByText(/Repair owner and action are not recorded here/)).toBeNull();expect(screen.queryByRole("button",{name:/retry|request a fresh handoff/i})).toBeNull();});
it("keeps actual pending receiver identity visible without a second request control",()=>{render(<NestedRoomCoordinationPanel coordination={null} failedHandoffRecovery={{kind:"failed-bounded-handoff",state:"waiting",reason:"handoff-receiver-acknowledgement-required",checkedAt:new Date().toISOString(),owner:null,original:null,action:null,pending:{requestId:"real-pending-request",requestDigest:"a".repeat(64),receiverRef:"exact-receiver-chat"}}} />);fireEvent.click(screen.getByRole("button",{name:/Delegation and recovery/i}));expect(screen.getByText(/Waiting for the recorded receiver/)).toBeTruthy();expect(screen.getByText("exact-receiver-chat")).toBeTruthy();expect(screen.queryByRole("button",{name:/retry|request/i})).toBeNull();});

it.each([["authenticated-source-assistant-required",/source assistant must use its own authenticated connection/i],["handoff-source-changed",/source executor changed/i],["handoff-lineage-unavailable",/handoff history could not be verified/i]])("explains the precise verified handoff hold %s",(reason,copy)=>{render(<NestedRoomCoordinationPanel coordination={null} failedHandoffRecovery={{kind:"failed-bounded-handoff",state:"blocked",reason,checkedAt:new Date().toISOString(),owner:null,original:null,action:null}}/>);fireEvent.click(screen.getByRole("button",{name:/Delegation and recovery/i}));expect(screen.getByText(copy)).toBeTruthy();expect(screen.queryByRole("button",{name:/retry|request/i})).toBeNull();});

it.each([["handoff-build-dependency",/A build still depends on the source executor/i],["handoff-policy-exemption-dependency",/publication exception still depends/i],["handoff-dependency-unavailable",/Dependency checks could not be completed/i],["handoff-completion-unproven",/handoff history could not be verified/i],["handoff-recovery-packet-over-budget",/context exceeds the recovery preview limit/i]])("explains the canonical hold %s without raw error content",(reason,copy)=>{render(<NestedRoomCoordinationPanel coordination={null} failedHandoffRecovery={{kind:"failed-bounded-handoff",state:"unavailable",reason,checkedAt:new Date().toISOString(),owner:null,original:null,action:null}}/>);fireEvent.click(screen.getByRole("button",{name:/Delegation and recovery/i}));expect(screen.getByText(copy)).toBeTruthy();expect(screen.queryByRole("button",{name:/retry|request/i})).toBeNull();});
