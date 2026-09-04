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
  getThreadSnapshotByIdMock,
  startFeedbackSupportMock,
  startProviderComplianceConsultationMock,
} = vi.hoisted(() => ({
  agentCoworkerPanelMock: vi.fn(),
  getOrCreateThreadSnapshotMock: vi.fn(),
  getThreadSnapshotByIdMock: vi.fn(),
  startFeedbackSupportMock: vi.fn(),
  startProviderComplianceConsultationMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("@/lib/actions/agent-coworker", () => ({
  getOrCreateThreadSnapshot: getOrCreateThreadSnapshotMock,
  getThreadSnapshotById: getThreadSnapshotByIdMock,
}));

vi.mock("@/lib/actions/provider-compliance-consultation", () => ({
  startProviderComplianceConsultation: startProviderComplianceConsultationMock,
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

// Spread the real module so a new export cannot silently break every test in
// this file; override only what these tests mean to control -- send auto
// messages straight through, never suppress and never queue.
vi.mock("./agent-auto-message", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-auto-message")>()),
  shouldDispatchAutoMessageImmediately: () => true,
  shouldSuppressAutoMessage: () => false,
  planAutoMessage: ({ message, targetBuildId }: { message: string; targetBuildId: string | null }) =>
    ({ send: true, message, targetBuildId, routeContext: null }),
}));

vi.mock("./agent-panel-layout", () => ({
  clampPanelPosition: (position: { x: number; y: number }) => position,
  clampPanelSize: (size: { width: number; height: number }) => size,
  getDockedPanelFrame: () => null,
  getReservedPanelWidth: () => 0,
  isDockedPanelViewport: () => false,
  isMobilePanelViewport: () => window.innerWidth < 640,
}));

vi.mock("./agent-panel-prefs", () => ({
  loadPanelOpen: () => false,
  loadPanelPosition: () => ({ x: 32, y: 48 }),
  loadPanelSize: () => ({ width: 380, height: 480 }),
  savePanelOpen: vi.fn(),
  savePanelPosition: vi.fn(),
  savePanelSize: vi.fn(),
}));

function renderShell(cooConversationalName: string | null = null) {
  return render(
    <AgentCoworkerShell
      userContext={{
        userId: "user-1",
        platformRole: "OPS-100",
        isSuperuser: false,
      }}
      useUnifiedCoworker={true}
      cooConversationalName={cooConversationalName}
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
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    pathname = "/build";
    getOrCreateThreadSnapshotMock.mockResolvedValue({
      threadId: "thread-1",
      messages: [],
    });
    getThreadSnapshotByIdMock.mockResolvedValue({
      threadId: "thread-1",
      messages: [{ id: "request-1", content: "Provider review requested" }],
    });
    startProviderComplianceConsultationMock.mockResolvedValue({
      success: true,
      childThreadId: "child-1",
      taskRunId: "task-1",
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

  it("uses a viewport-bound frame on mobile", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    renderShell();

    fireEvent.click(await screen.findByRole("button", { name: "Open coworker" }));

    const dialog = await screen.findByRole("dialog", {
      name: "AI coworker panel",
    });
    expect(dialog).toHaveAttribute("data-panel-layout", "mobile-viewport");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveStyle({
      width: "100vw",
      maxWidth: "100vw",
      minWidth: "0",
      height: "100dvh",
      overflow: "hidden",
    });
    expect(agentCoworkerPanelMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ isDocked: true }),
    );
  });

  it("recomputes mobile mode when the viewport crosses the breakpoint", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    renderShell();
    fireEvent.click(await screen.findByRole("button", { name: "Open coworker" }));
    expect(
      await screen.findByRole("dialog", { name: "AI coworker panel" }),
    ).toHaveAttribute("data-panel-layout", "mobile-viewport");

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "AI coworker panel" }),
      ).not.toHaveAttribute("data-panel-layout", "mobile-viewport");
    });
    expect(
      screen.getByRole("dialog", { name: "AI coworker panel" }),
    ).not.toHaveAttribute("aria-modal");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("passes the organization COO presentation preference to the panel", async () => {
    renderShell("Number Two");
    fireEvent.click(screen.getByRole("button", { name: "Open coworker" }));
    await settleShellThread();
    expect(agentCoworkerPanelMock).toHaveBeenLastCalledWith(expect.objectContaining({
      cooConversationalName: "Number Two",
    }));
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

  it("lets named coworker actions own roster and record entry", async () => {
    pathname = "/platform/ai/overview";
    renderShell();
    await settleShellThread();

    expect(screen.queryByTestId("agent-fab")).not.toBeInTheDocument();

    act(() => {
      document.dispatchEvent(
        new CustomEvent("open-agent-panel", {
          detail: {
            routeContext: "/platform/ai/agent/customer-advisor",
          },
        }),
      );
    });

    expect(await screen.findByTestId("coworker-panel")).toBeInTheDocument();
  });

  it("starts a provider consultation once the routed COO thread is ready without auto-sending a duplicate model turn", async () => {
    pathname = "/workspace";
    renderShell();
    await settleShellThread();
    const packet = {
      schemaVersion: "provider-compliance-review.v1",
      purpose: "provider-suitability-advice",
      organizationRef: "org-1",
      businessContext: {
        archetypeId: null,
        archetypeCategory: null,
        jurisdictionBasis: { operatesIn: [], sellsTo: [], employsIn: [], dataResidency: [] },
        riskPosture: null,
      },
      recommendation: { status: "not-ready", workloadClasses: [] },
      providerConnections: [],
      requestedAdvisory: [
        "regulatory-applicability",
        "account-and-contract-evidence",
        "retention-and-training-treatment",
        "processing-region-and-sovereignty",
        "workload-restrictions",
        "safe-next-action",
      ],
    };

    act(() => {
      document.dispatchEvent(new CustomEvent("open-agent-panel", {
        detail: {
          autoMessage: "Review provider setup",
          routeContext: "/workspace",
          providerReviewPacket: packet,
        },
      }));
    });

    await waitFor(() => {
      expect(startProviderComplianceConsultationMock).toHaveBeenCalledWith({
        parentThreadId: "thread-1",
        routeContext: "/workspace",
        packet,
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Provider review requested")).toBeInTheDocument();
    });
    const latestProps = agentCoworkerPanelMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(latestProps.pendingAutoMessage).toBeNull();
    expect(startProviderComplianceConsultationMock).toHaveBeenCalledTimes(1);
  });

  it("keeps posture unchanged and offers retry or qualified review when consultation is denied", async () => {
    pathname = "/workspace";
    startProviderComplianceConsultationMock.mockRejectedValueOnce(new Error("delegation denied"));
    renderShell();
    await settleShellThread();
    const packet = {
      schemaVersion: "provider-compliance-review.v1",
      purpose: "provider-suitability-advice",
      organizationRef: "org-1",
      businessContext: {
        archetypeId: null,
        archetypeCategory: null,
        jurisdictionBasis: { operatesIn: ["eu"], sellsTo: [], employsIn: [], dataResidency: ["eu"] },
        riskPosture: "conservative",
      },
      recommendation: { status: "review-needed", workloadClasses: ["customer-records"] },
      providerConnections: [],
      requestedAdvisory: [
        "regulatory-applicability",
        "account-and-contract-evidence",
        "retention-and-training-treatment",
        "processing-region-and-sovereignty",
        "workload-restrictions",
        "safe-next-action",
      ],
    };

    act(() => {
      document.dispatchEvent(new CustomEvent("open-agent-panel", {
        detail: {
          autoMessage: "Review provider setup",
          routeContext: "/workspace",
          providerReviewPacket: packet,
        },
      }));
    });

    await waitFor(() => {
      const latestProps = agentCoworkerPanelMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      const messages = latestProps.initialMessages as Array<{ content: string }>;
      expect(messages.at(-1)?.content).toContain("Provider posture was not changed");
      expect(messages.at(-1)?.content).toContain("try again or request qualified review");
      expect(latestProps.pendingAutoMessage).toBeNull();
    });
  });

  it("surfaces a failed thread load and recovers via reload-to-reconnect (BI-D028B2A8)", async () => {
    vi.useFakeTimers();
    const originalLocation = window.location;
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock },
    });
    try {
      // Initial load + the single bounded auto-retry both fail — the canonical
      // stale-tab-after-self-upgrade case where the tab's cached server-action
      // reference 404s ("Failed to find Server Action").
      getOrCreateThreadSnapshotMock
        .mockRejectedValueOnce(new Error("Failed to find Server Action"))
        .mockRejectedValueOnce(new Error("Failed to find Server Action"));

      renderShell();
      fireEvent.click(screen.getByRole("button", { name: "Open coworker" }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      let latestProps = agentCoworkerPanelMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(latestProps.threadLoadState).toBe("loading");

      // The auto-retry fires after ~2s and also fails → explicit failed state.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      latestProps = agentCoworkerPanelMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(latestProps.threadLoadState).toBe("failed");
      expect(getOrCreateThreadSnapshotMock).toHaveBeenCalledTimes(2);

      // Recovery is a full reload, NOT a soft re-call of the dead action: the
      // stale bundle's action reference can never succeed, so only a reload
      // fetches a fresh bundle with current server-action IDs.
      expect(typeof latestProps.onReloadToReconnect).toBe("function");
      act(() => {
        (latestProps.onReloadToReconnect as () => void)();
      });
      expect(reloadMock).toHaveBeenCalledTimes(1);
      // The reconnect action must not re-invoke the same dead server action.
      expect(getOrCreateThreadSnapshotMock).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
      vi.useRealTimers();
    }
  });

  it("treats a snapshot that resolves to null as an invalid session, not a silent dead composer (BI-836B0304)", async () => {
    // getOrCreateThreadSnapshot resolves (does not throw) null in exactly one
    // case: the session's userId has no matching User row. Retrying can
    // never fix that row's absence, so this must NOT fall into the
    // retry-then-"failed" path — it should land directly on the re-auth
    // state after a single call.
    getOrCreateThreadSnapshotMock.mockResolvedValue(null);

    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open coworker" }));

    await waitFor(() => {
      const latestProps = agentCoworkerPanelMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(latestProps.threadLoadState).toBe("invalid-session");
    });
    expect(getOrCreateThreadSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it("treats a snapshot missing a threadId (but not resolved null) as a retryable failed load", async () => {
    vi.useFakeTimers();
    try {
      // An object without a threadId is a different shape than the
      // invalid-session `null` — keep it on the existing bounded-retry path.
      getOrCreateThreadSnapshotMock.mockResolvedValue({ threadId: undefined, messages: [] });

      renderShell();
      fireEvent.click(screen.getByRole("button", { name: "Open coworker" }));

      // Initial + auto-retry both come back without a threadId → failed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      const latestProps = agentCoworkerPanelMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(latestProps.threadLoadState).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes guided work route context to the coworker panel", async () => {
    pathname = "/customer";
    renderShell();
    await settleShellThread();

    act(() => {
      document.dispatchEvent(
        new CustomEvent("open-agent-panel", {
          detail: {
            autoMessage: "Diagnose stage health for OPP-CODEX-001.",
            routeContext: "/customer/opportunities/opp-1",
          },
        }),
      );
    });

    expect(await screen.findByTestId("coworker-panel")).toBeInTheDocument();
    await waitFor(() => {
      expect(getOrCreateThreadSnapshotMock).toHaveBeenCalledWith({
        routeContext: "/customer/opportunities/opp-1",
      });
    });
    await waitFor(() => {
      const latestProps = agentCoworkerPanelMock.mock.calls.at(-1)?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(latestProps?.routeContextOverride).toBe("/customer/opportunities/opp-1");
    });
  });
});

describe("AgentCoworkerShell opening briefing (BI-DED493BA)", () => {
  beforeEach(() => {
    pathname = "/customer/marketing";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the server-composed briefing as an ephemeral bubble on open", async () => {
    getOrCreateThreadSnapshotMock.mockResolvedValue({
      threadId: "thread-brief",
      messages: [],
      openingBriefing: {
        content:
          "**Most pressing:** [Launch email awaits your approval](/customer/marketing) — pending review",
        agentId: "marketing-specialist",
      },
    });

    renderShell();
    fireEvent.click(screen.getByText("Open coworker"));
    await settleShellThread();

    expect(
      await screen.findByText(/Most pressing:.*Launch email awaits your approval/),
    ).toBeInTheDocument();
  });

  it("does not duplicate the briefing across load retries of the same context", async () => {
    getOrCreateThreadSnapshotMock.mockResolvedValue({
      threadId: "thread-brief",
      messages: [],
      openingBriefing: { content: "**Most pressing:** one thing", agentId: null },
    });

    renderShell();
    fireEvent.click(screen.getByText("Open coworker"));
    await settleShellThread();

    const latestProps = agentCoworkerPanelMock.mock.calls.at(-1)?.[0] as {
      initialMessages?: Array<{ id: string }>;
    };
    const briefingRows = (latestProps.initialMessages ?? []).filter((row) =>
      row.id.startsWith("opening-briefing:"),
    );
    expect(briefingRows).toHaveLength(1);
  });

  it("stays silent when the snapshot carries no briefing (quiet / nothing pending)", async () => {
    getOrCreateThreadSnapshotMock.mockResolvedValue({
      threadId: "thread-silent",
      messages: [],
      openingBriefing: null,
    });

    renderShell();
    fireEvent.click(screen.getByText("Open coworker"));
    await settleShellThread();

    expect(screen.queryByText(/Most pressing/)).not.toBeInTheDocument();
  });
});
