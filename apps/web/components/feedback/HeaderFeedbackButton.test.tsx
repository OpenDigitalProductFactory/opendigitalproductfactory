// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

    return <div data-testid="feedback-form">Feedback fallback</div>;
  },
}));

describe("HeaderFeedbackButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pathname = "/build";
    feedbackFormMock.props = [];
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  it("dispatches a cancelable manual support event for the build route", () => {
    const received: CustomEvent[] = [];
    const handler = ((event: Event) => {
      received.push(event as CustomEvent);
    }) as EventListener;
    document.addEventListener("open-agent-feedback", handler);

    try {
      render(<HeaderFeedbackButton userId="user-1" />);
      const trigger = screen.getByRole("button", {
        name: /^feedback$/i,
      });

      expect(trigger).toHaveAccessibleName("Feedback");

      fireEvent.click(trigger);

      expect(received).toHaveLength(1);
      expect(received[0].cancelable).toBe(true);
      expect(received[0].detail).toEqual(
        expect.objectContaining({
          routeContext: "/build",
          triggerKind: "manual",
          autoFilePolicy: "ask",
        }),
      );
      expect(received[0].detail.supportSessionId).toMatch(
        /^dpf_support_[a-f0-9]{32}$/,
      );
    } finally {
      document.removeEventListener("open-agent-feedback", handler);
    }
  });

  it("keeps the fallback form closed when the support event is handled", () => {
    const handler = ((event: Event) => {
      event.preventDefault();
    }) as EventListener;
    document.addEventListener("open-agent-feedback", handler);

    try {
      render(<HeaderFeedbackButton userId="user-1" />);
      fireEvent.click(screen.getByRole("button", { name: "Feedback" }));

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(screen.queryByTestId("feedback-form")).not.toBeInTheDocument();
      expect(feedbackFormMock.props).toHaveLength(0);
    } finally {
      document.removeEventListener("open-agent-feedback", handler);
    }
  });

  it("keeps the fallback form closed when the coworker panel opens", () => {
    render(<HeaderFeedbackButton userId="user-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));

    const panel = document.createElement("div");
    panel.setAttribute("data-agent-panel", "true");
    document.body.appendChild(panel);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByTestId("feedback-form")).not.toBeInTheDocument();
    expect(feedbackFormMock.props).toHaveLength(0);
    panel.remove();
  });

  it("opens the fallback form with the same support context when the event is unhandled", () => {
    render(<HeaderFeedbackButton userId="user-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^feedback$/i }));

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByTestId("feedback-form")).toBeInTheDocument();
    expect(screen.getByText("Feedback fallback")).toBeVisible();
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
});
