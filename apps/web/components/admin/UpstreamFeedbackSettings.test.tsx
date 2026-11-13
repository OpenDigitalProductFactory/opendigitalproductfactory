// @vitest-environment jsdom

import { act, cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { namespaceMessages } from "@dpf/i18n";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BI-6ED89EC6: the one standing place to turn upstream feedback on. It saves
// through the existing consent action, unchanged, so who and when stay recorded.
const { mockSet } = vi.hoisted(() => ({ mockSet: vi.fn() }));
vi.mock("@/lib/actions/feedback-escalation", () => ({ setUpstreamFeedbackOptIn: mockSet }));

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { UpstreamFeedbackSettings, UPSTREAM_FEEDBACK_ANCHOR } from "@/components/admin/UpstreamFeedbackSettings";

const render = (ui: ReactElement) => rtlRender(
  <MessagesProvider locale="en-US" messages={{ admin: namespaceMessages("en-US", "admin") }}>{ui}</MessagesProvider>,
);

afterEach(() => cleanup());

describe("UpstreamFeedbackSettings", () => {
  beforeEach(() => {
    mockSet.mockReset();
    mockSet.mockResolvedValue({ ok: true, optIn: true });
  });

  it("carries the anchor the Needs-you item links to", () => {
    render(<UpstreamFeedbackSettings optIn={false} forkOnly={false} paused={false} />);
    expect(screen.getByTestId("upstream-feedback-settings").id).toBe(UPSTREAM_FEEDBACK_ANCHOR);
  });

  it("says plainly that nothing leaves while it is off, and what is sent when it is on", () => {
    render(<UpstreamFeedbackSettings optIn={false} forkOnly={false} paused={false} />);
    expect(screen.getByText(/Off\. Nothing leaves this installation/)).toBeTruthy();
    expect(screen.getByText(/redacted and sent under this installation's pseudonym/)).toBeTruthy();
  });

  it("enables Save only once changed, and saves through the existing consent action", async () => {
    render(<UpstreamFeedbackSettings optIn={false} forkOnly={false} paused={false} />);
    const save = screen.getByTestId("upstream-feedback-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByTestId("upstream-feedback-opt-in"));
    expect(save.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(save);
    });
    expect(mockSet).toHaveBeenCalledWith({ enabled: true });
    expect(screen.getByRole("status").textContent).toBe("Saved");
  });

  it("explains why it cannot apply on a private installation, and cannot be changed there", () => {
    render(<UpstreamFeedbackSettings optIn={false} forkOnly paused={false} />);
    const box = screen.getByTestId("upstream-feedback-opt-in") as HTMLInputElement;
    // Blocked by policy, but still reachable by keyboard so its reason can be found.
    expect(box.getAttribute("aria-disabled")).toBe("true");
    expect(box.disabled).toBe(false);
    fireEvent.click(box);
    expect((screen.getByTestId("upstream-feedback-save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/keeps everything on its own system/)).toBeTruthy();
  });

  it("explains that the master pause overrides it", () => {
    render(<UpstreamFeedbackSettings optIn forkOnly={false} paused />);
    expect(screen.getByText(/paused for this installation, which overrides this switch/)).toBeTruthy();
  });

  it("shows the state but cannot be changed by someone who does not manage the platform", () => {
    render(<UpstreamFeedbackSettings optIn={false} forkOnly={false} paused={false} mayChange={false} />);
    expect(screen.getByTestId("upstream-feedback-opt-in").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/Only someone who manages the platform/)).toBeTruthy();
  });

  it("shows the refusal when saving fails rather than claiming success", async () => {
    mockSet.mockRejectedValueOnce(new Error("You need platform management to change this."));
    render(<UpstreamFeedbackSettings optIn={false} forkOnly={false} paused={false} />);
    fireEvent.click(screen.getByTestId("upstream-feedback-opt-in"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("upstream-feedback-save"));
    });
    expect(screen.getByRole("alert").textContent).toContain("platform management");
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("never describes an unsaved change as the current state", () => {
    render(<UpstreamFeedbackSettings optIn={false} forkOnly={false} paused={false} />);
    fireEvent.click(screen.getByTestId("upstream-feedback-opt-in"));
    const state = screen.getByTestId("upstream-feedback-state").textContent ?? "";
    expect(state).toContain("Not saved yet");
    expect(state).not.toMatch(/^On\./);
  });

  it("treats a save the action answers without confirming as not saved", async () => {
    mockSet.mockResolvedValueOnce({ ok: false });
    render(<UpstreamFeedbackSettings optIn={false} forkOnly={false} paused={false} />);
    fireEvent.click(screen.getByTestId("upstream-feedback-opt-in"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("upstream-feedback-save"));
    });
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByRole("alert").textContent).toBe("Could not save. Try again.");
    expect(screen.getByTestId("upstream-feedback-state").textContent).toContain("Not saved yet");
  });

  it("settles on the saved value, so Save disables and turning it back off is still savable", async () => {
    render(<UpstreamFeedbackSettings optIn={false} forkOnly={false} paused={false} />);
    const save = screen.getByTestId("upstream-feedback-save") as HTMLButtonElement;
    fireEvent.click(screen.getByTestId("upstream-feedback-opt-in"));
    await act(async () => {
      fireEvent.click(save);
    });
    expect(save.disabled).toBe(true);
    expect(screen.getByTestId("upstream-feedback-state").textContent).toBe("On. Triaged problems are sent daily.");

    fireEvent.click(screen.getByTestId("upstream-feedback-opt-in"));
    expect(save.disabled).toBe(false);
    expect(screen.getByTestId("upstream-feedback-state").textContent).toContain("Still on until you save");
  });
});
