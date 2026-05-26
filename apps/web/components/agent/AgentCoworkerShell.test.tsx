// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FeedbackEventDetail } from "@/lib/feedback/feedback-event";
import { AgentCoworkerShell } from "./AgentCoworkerShell";

let pathname = "/build";

const {
  agentCoworkerPanelMock,
  getOrCreateThreadSnapshotMock,
  startFeedbackSupportMock,
} = vi.hoisted(() => ({
  agentCoworkerPanelMock: vi.fn(),
  getOrCreateThreadSnapshotMock: vi.fn(),
  startFeedbackSupportMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("@/lib/actions/agent-coworker", () => ({
  getOrCreateThreadSnapshot: getOrCreateThreadSnapshotMock,
}));

vi.mock("@/lib/actions/feedback-support", () => ({
  startFeedbackSupport: startFeedbackSupportMock,
}));

vi.mock("./AgentFAB", () => ({
  AgentFAB: ({ onClick }: { onClick: () => void }) => (
    <button type="button" data-agent-fab="true" onClick={onClick}>
      Open coworker
    </button>
  ),
}));

vi.mock("./AgentCoworkerPanel", () => ({
  AgentCoworkerPanel: (props: Record<string, unknown>) => {
    agentCoworkerPanelMock(props);

    const initialMessages =
      (props.initialMessages as Array<{ id: string; content: string }> | undefined) ?? [];
    const supportCopy =
      typeof props.supportCopy === "string" ? props.supportCopy : null;

    return (
      <section data-testid="coworker-panel">
        <div data-testid="panel-thread-id">{String(props.threadId ?? "")}</div>
        <button type="button" onClick={props.onClose as () => void}>
          Close
        </button>
        {supportCopy && <p>{supportCopy}</p>}
        {initialMessages.map((message) => (
          <p key={message.id}>{message.content}</p>
        ))}
        {props.pendingAutoMessage ? (
          <p data-testid="pending-auto-message">{String(props.pendingAutoMessage)}</p>
        ) : null}
      </section>
    );
  },
}));

vi.mock("./agent-auto-message", () => ({
  shouldDispatchAutoMessageImmediately: () => true,
  shouldSuppressAutoMessage: () => false,
}));

vi.mock("./agent-panel-layout", () => ({
  clampPanelPosition: (position: { x: number; y: number }) => position,
  clampPanelSize: (size: { width: number; height: number }) => size,
  getDockedPanelFrame: () => null,
  getReservedPanelWidth: () => 0,
  isDockedPanelViewport: () => false,
}));

vi.mock("./agent-panel-prefs", () => ({
  loadPanelOpen: () => false,
  loadPanelPosition: () => ({ x: 32, y: 48 }),
  loadPanelSize: () => ({ width: 380, height: 480 }),
  savePanelOpen: vi.fn(),
  savePanelPosition: vi.fn(),
  savePanelSize: vi.fn(),
}));

function renderShell() {
  return render(
    <AgentCoworkerShell
      userContext={{
        userId: "user-1",
        platformRole: "OPS-100",
        isSuperuser: false,
      }}
      useUnifiedCoworker={true}
    />,
  );
}

function supportDetail(
  supportSessionId = "dpf_support_1234567890abcdef1234567890abcdef",
): FeedbackEventDetail {
  return {
    routeContext: "/build",
    triggerKind: "manual",
    supportSessionId,
    autoFilePolicy: "ask",
  };
}

function activeBuild(buildId = "FB-9E4FA6DE") {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("build-studio-active-build", { detail: buildId }),
    );
  });
}

async function settleShellThread() {
  await waitFor(() => {
    expect(getOrCreateThreadSnapshotMock).toHaveBeenCalled();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AgentCoworkerShell support entry", () => {
  beforeEach(() => {
    pathname = "/build";
    getOrCreateThreadSnapshotMock.mockResolvedValue({
      threadId: "thread-1",
      messages: [],
    });
    startFeedbackSupportMock.mockResolvedValue({
      ok: true,
      status: "created",
      reportId: "PIR-1",
      supportSessionId: "dpf_support_1234567890abcdef1234567890abcdef",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("handles a valid open-agent-feedback event in the existing panel", async () => {
    renderShell();
    activeBuild();
    await settleShellThread();

    const event = new CustomEvent("open-agent-feedback", {
      cancelable: true,
      detail: supportDetail(),
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByTestId("coworker-panel")).toBeInTheDocument();
    expect(screen.getByText(/support mode/i)).toBeInTheDocument();
    expect(
      screen.getByText(/capture route\/build\/thread context/i),
    ).toBeVisible();
    expect(screen.queryByText(/category/i)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(startFeedbackSupportMock).toHaveBeenCalledTimes(1);
    });
    expect(startFeedbackSupportMock).toHaveBeenCalledWith({
      detail: supportDetail(),
      featureBuildId: "FB-9E4FA6DE",
      threadId: "thread-1",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("opens support in a focusable panel and returns focus to the launcher on close", async () => {
    renderShell();
    await settleShellThread();

    const launcher = screen.getByRole("button", { name: "Open coworker" });
    launcher.focus();
    fireEvent.click(launcher);

    const panel = await screen.findByRole("dialog", {
      name: /coworker panel/i,
    });
    expect(panel).toHaveAttribute("tabindex", "-1");
    await waitFor(() => {
      expect(panel).toHaveFocus();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    const restoredLauncher = await screen.findByRole("button", {
      name: "Open coworker",
    });
    await waitFor(() => {
      expect(restoredLauncher).toHaveFocus();
    });
  });

  it("shows text feedback when support report start is rate limited", async () => {
    startFeedbackSupportMock.mockRejectedValueOnce(
      new Error("Too many support sessions started. Try again in a minute."),
    );

    renderShell();
    activeBuild();
    await settleShellThread();

    act(() => {
      document.dispatchEvent(
        new CustomEvent("open-agent-feedback", {
          cancelable: true,
          detail: supportDetail(),
        }),
      );
    });

    expect(
      await screen.findByText(/too many support sessions started/i),
    ).toBeVisible();
  });

  it("shows text feedback when support report start fails", async () => {
    startFeedbackSupportMock.mockRejectedValueOnce(new Error("Report start failed"));

    renderShell();
    activeBuild();
    await settleShellThread();

    act(() => {
      document.dispatchEvent(
        new CustomEvent("open-agent-feedback", {
          cancelable: true,
          detail: supportDetail(),
        }),
      );
    });

    expect(await screen.findByText(/couldn't start support triage/i)).toBeVisible();
  });

  it("calls support start once per supportSessionId", async () => {
    renderShell();
    activeBuild();
    await settleShellThread();

    const detail = supportDetail();

    act(() => {
      document.dispatchEvent(
        new CustomEvent("open-agent-feedback", { cancelable: true, detail }),
      );
      document.dispatchEvent(
        new CustomEvent("open-agent-feedback", { cancelable: true, detail }),
      );
    });

    await waitFor(() => {
      expect(startFeedbackSupportMock).toHaveBeenCalledTimes(1);
    });

    const nextDetail = supportDetail("dpf_support_fedcba0987654321fedcba0987654321");
    act(() => {
      document.dispatchEvent(
        new CustomEvent("open-agent-feedback", {
          cancelable: true,
          detail: nextDetail,
        }),
      );
    });

    await waitFor(() => {
      expect(startFeedbackSupportMock).toHaveBeenCalledTimes(2);
    });
  });

  it("reconciles a support entry when the thread arrives after the event", async () => {
    let resolveSnapshot:
      | ((value: { threadId: string; messages: [] }) => void)
      | undefined;
    getOrCreateThreadSnapshotMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    renderShell();

    const detail = supportDetail();
    const event = new CustomEvent("open-agent-feedback", {
      cancelable: true,
      detail,
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(startFeedbackSupportMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId("coworker-panel")).toBeInTheDocument();

    await act(async () => {
      resolveSnapshot?.({ threadId: "thread-late", messages: [] });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(startFeedbackSupportMock).toHaveBeenCalledTimes(1);
    });
    expect(startFeedbackSupportMock).toHaveBeenCalledWith({
      detail,
      featureBuildId: null,
      threadId: "thread-late",
    });
  });

  it("preserves legacy open-agent-panel behavior", async () => {
    pathname = "/setup";
    renderShell();
    await settleShellThread();

    act(() => {
      document.dispatchEvent(
        new CustomEvent("open-agent-panel", {
          detail: {
            welcomeMessage: "Setup helper",
            autoMessage: "Continue setup",
          },
        }),
      );
    });

    expect(await screen.findByTestId("coworker-panel")).toBeInTheDocument();
    expect(screen.getByText("Setup helper")).toBeInTheDocument();
    expect(screen.getByTestId("pending-auto-message")).toHaveTextContent(
      "Continue setup",
    );
    expect(startFeedbackSupportMock).not.toHaveBeenCalled();
  });
});
