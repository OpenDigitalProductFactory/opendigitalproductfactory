// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderFeedbackButton } from "./HeaderFeedbackButton";

let pathname = "/build";

const feedbackFormMock = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("./FeedbackForm", () => ({
  FeedbackForm: (props: Record<string, unknown>) => {
    feedbackFormMock.props.push(props);

    return <div data-testid="feedback-form">Feedback form</div>;
  },
}));

describe("HeaderFeedbackButton", () => {
  beforeEach(() => {
    pathname = "/build";
    feedbackFormMock.props = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("opens a feedback-labeled surface, not the AI coworker conversation", () => {
    // BI-62FF22DB: a control labeled "Feedback" must not open the coworker
    // panel. Guard against any coworker-panel event being dispatched.
    const coworkerEvents: Event[] = [];
    const handler = ((event: Event) => {
      coworkerEvents.push(event);
    }) as EventListener;
    document.addEventListener("open-agent-feedback", handler);
    document.addEventListener("open-agent-panel", handler);

    try {
      render(<HeaderFeedbackButton userId="user-1" />);
      const trigger = screen.getByRole("button", { name: /^feedback$/i });
      expect(trigger).toHaveAccessibleName("Feedback");

      fireEvent.click(trigger);

      // A feedback-specific surface appears, with a clear title and the form.
      const dialog = screen.getByRole("dialog", { name: /send feedback/i });
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText("Send Feedback")).toBeVisible();
      expect(screen.getByTestId("feedback-form")).toBeInTheDocument();

      // ...and no AI coworker panel is opened.
      expect(coworkerEvents).toHaveLength(0);
    } finally {
      document.removeEventListener("open-agent-feedback", handler);
      document.removeEventListener("open-agent-panel", handler);
    }
  });

  it("passes the current route and manual support context to the feedback form", () => {
    render(<HeaderFeedbackButton userId="user-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^feedback$/i }));

    expect(feedbackFormMock.props).toHaveLength(1);
    expect(feedbackFormMock.props[0]).toEqual(
      expect.objectContaining({
        routeContext: "/build",
        userId: "user-1",
        source: "manual",
        triggerKind: "manual",
        autoFilePolicy: "ask",
      }),
    );
    expect(feedbackFormMock.props[0].supportSessionId).toMatch(
      /^dpf_support_[a-f0-9]{32}$/,
    );
  });

  it("toggles the feedback surface closed on a second click", () => {
    render(<HeaderFeedbackButton userId="user-1" />);
    const trigger = screen.getByRole("button", { name: /^feedback$/i });

    fireEvent.click(trigger);
    expect(screen.getByTestId("feedback-form")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(trigger);
    expect(screen.queryByTestId("feedback-form")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
