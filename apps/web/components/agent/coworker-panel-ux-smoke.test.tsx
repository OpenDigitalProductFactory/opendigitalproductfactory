// @vitest-environment jsdom

/**
 * UX smoke coverage for the coworker side-panel shell (BI-3238AAF0).
 *
 * Reproduces the live cognitive-load audit findings as executable checks:
 *  1. The coworker panel persists ONLY once intentionally opened, carries its
 *     open state across /finance and other routes, and collapses back to the
 *     launcher on close.
 *  2. The panel's controls expose owner-readable accessible names — not the bare
 *     `⋯`, `x`, `+ Add`, or `Controls` glyphs the audit flagged — and the header
 *     names the current route/business context.
 *
 * The sibling BI-62FF22DB concern — clicking header `Feedback` on /workspace must
 * yield a feedback-labeled surface rather than a generic coworker conversation —
 * is owned and smoke-tested by `HeaderFeedbackButton.test.tsx` (PR #3376). This
 * file deliberately does not duplicate that coverage; it exercises the panel
 * shell itself, which that change does not touch.
 */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentCoworkerShell } from "./AgentCoworkerShell";
import { AgentPanelHeader } from "./AgentPanelHeader";
import { AgentMessageInput } from "./AgentMessageInput";
import { CoworkerPostureControl } from "./CoworkerPostureControl";

// ── Mutable route for usePathname ────────────────────────────────────────────
let pathname = "/workspace";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

// ── AgentCoworkerShell dependencies ──────────────────────────────────────────
const shell = vi.hoisted(() => ({
  agentPanel: vi.fn(),
  getOrCreateThreadSnapshot: vi.fn(),
  getThreadSnapshotById: vi.fn(),
  startFeedbackSupport: vi.fn(),
  startProviderComplianceConsultation: vi.fn(),
  savePanelOpen: vi.fn(),
  panelOpen: { value: false },
}));

vi.mock("@/lib/actions/agent-coworker", () => ({
  getOrCreateThreadSnapshot: shell.getOrCreateThreadSnapshot,
  getThreadSnapshotById: shell.getThreadSnapshotById,
}));
vi.mock("@/lib/actions/provider-compliance-consultation", () => ({
  startProviderComplianceConsultation: shell.startProviderComplianceConsultation,
}));
vi.mock("@/lib/actions/feedback-support", () => ({
  startFeedbackSupport: shell.startFeedbackSupport,
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
    shell.agentPanel(props);
    return (
      <section data-testid="coworker-panel">
        <span data-testid="panel-route-override">
          {String(props.routeContextOverride ?? "")}
        </span>
        <button type="button" onClick={props.onClose as () => void}>
          Close
        </button>
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
  isMobilePanelViewport: () => false,
}));

// Stateful panel-open persistence so we can prove the panel is only pinned once
// intentionally opened, and that the pinned flag survives a fresh mount.
vi.mock("./agent-panel-prefs", () => ({
  loadPanelOpen: () => shell.panelOpen.value,
  loadPanelPosition: () => ({ x: 32, y: 48 }),
  loadPanelSize: () => ({ width: 380, height: 480 }),
  savePanelOpen: (userId: string, open: boolean) => {
    shell.panelOpen.value = open;
    shell.savePanelOpen(userId, open);
  },
  savePanelPosition: vi.fn(),
  savePanelSize: vi.fn(),
}));

// ── Control-surface dependencies (AgentPanelHeader / AgentMessageInput) ──────
vi.mock("./AgentSkillsDropdown", () => ({
  AgentSkillsDropdown: () => <span>Skills</span>,
}));
vi.mock("./AgentFileUpload", () => ({
  AgentFileUpload: () => null,
}));
vi.mock("./uploadAgentAttachment", () => ({
  uploadAgentAttachment: vi.fn(),
  isAcceptedUploadFile: () => true,
  UPLOAD_ACCEPT_ATTR: ".png",
  ACCEPTED_UPLOAD_EXTENSIONS: ["png"],
}));
vi.mock("./hooks/useVoiceCapture", () => ({
  useVoiceCapture: () => ({
    state: "idle",
    error: null,
    errorCode: null,
    supported: true,
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  }),
}));

function shellElement() {
  return (
    <AgentCoworkerShell
      userContext={{ userId: "user-1", platformRole: "OPS-100", isSuperuser: false }}
      useUnifiedCoworker
      cooConversationalName={null}
    />
  );
}

async function settleMount() {
  await waitFor(() => {
    expect(shell.getOrCreateThreadSnapshot).toHaveBeenCalled();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("UX smoke — coworker panel persistence & collapse (BI-3238AAF0)", () => {
  beforeEach(() => {
    shell.panelOpen.value = false;
    shell.savePanelOpen.mockClear();
    shell.getOrCreateThreadSnapshot.mockReset();
    shell.getOrCreateThreadSnapshot.mockResolvedValue({ threadId: "thread-1", messages: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not show the panel until it is intentionally opened", async () => {
    pathname = "/workspace";
    render(shellElement());
    await settleMount();

    expect(screen.queryByTestId("coworker-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open coworker" })).toBeInTheDocument();
  });

  it("persists the panel across /finance and another route once intentionally opened", async () => {
    pathname = "/workspace";
    const view = render(shellElement());
    await settleMount();

    // Intentional open via the launcher pins the panel.
    fireEvent.click(screen.getByRole("button", { name: "Open coworker" }));
    await flush();
    expect(screen.getByTestId("coworker-panel")).toBeInTheDocument();
    expect(shell.savePanelOpen).toHaveBeenCalledWith("user-1", true);

    // Navigate to /finance — the panel remains.
    pathname = "/finance";
    view.rerender(shellElement());
    await flush();
    expect(screen.getByTestId("coworker-panel")).toBeInTheDocument();

    // Navigate again — still present.
    pathname = "/storefront";
    view.rerender(shellElement());
    await flush();
    expect(screen.getByTestId("coworker-panel")).toBeInTheDocument();
  });

  it("reopens on a fresh mount when the panel was left intentionally open (route reload)", async () => {
    shell.panelOpen.value = true; // persisted intentional-open flag
    pathname = "/finance";
    render(shellElement());
    await settleMount();

    expect(await screen.findByTestId("coworker-panel")).toBeInTheDocument();
  });

  it("collapses back to the launcher on close", async () => {
    pathname = "/workspace";
    render(shellElement());
    await settleMount();

    fireEvent.click(screen.getByRole("button", { name: "Open coworker" }));
    await flush();
    expect(screen.getByTestId("coworker-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await flush();
    expect(screen.queryByTestId("coworker-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open coworker" })).toBeInTheDocument();
    expect(shell.savePanelOpen).toHaveBeenLastCalledWith("user-1", false);
  });
});

describe("UX smoke — panel controls have owner-readable accessible names (BI-3238AAF0)", () => {
  afterEach(() => cleanup());

  const headerProps = {
    agent: {
      agentId: "agent-1",
      agentName: "Ops Co-worker",
      agentDescription: "Helps with operations",
      canAssist: true,
      sensitivity: "internal" as const,
      systemPrompt: "prompt",
      skills: [],
    },
    userContext: { userId: "user-1", platformRole: "OPS-100", isSuperuser: false },
    onSend: () => {},
    onOpenClearConfirm: () => {},
    onCancelClearConfirm: () => {},
    onConfirmClear: () => {},
    clearDisabled: false,
    clearConfirmOpen: false,
    onClose: () => {},
    onDragStart: () => {},
  };

  const inputProps = {
    onSend: () => {},
    composerState: "ready" as const,
    threadId: "thread-1",
    pendingFile: null,
    onFileUploaded: () => {},
    onFileClear: () => {},
  };

  const postureProps = {
    elevatedAssistEnabled: false,
    onToggleElevatedAssist: () => {},
    externalAccessEnabled: false,
    onToggleExternalAccess: () => {},
  };

  it("header overflow and close controls read in plain language, not ⋯ / x", () => {
    render(<AgentPanelHeader {...headerProps} />);
    expect(screen.getByRole("button", { name: "More options" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close coworker panel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "⋯" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^x$/i })).not.toBeInTheDocument();
  });

  it("header names the current route/business context", () => {
    render(<AgentPanelHeader {...headerProps} routeContextLabel="Finance" />);
    const context = screen.getByTestId("panel-route-context");
    expect(context).toHaveTextContent("Finance");
    expect(context).toHaveAttribute("aria-label", "Current context: Finance");
  });

  it("composer add-context control reads 'Add context', not '+ Add'", () => {
    render(<AgentMessageInput {...inputProps} />);
    expect(screen.getByRole("button", { name: "Add context" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^\+\s*add$/i })).not.toBeInTheDocument();
    // Dictation and send are owner-readable too.
    expect(screen.getByRole("button", { name: /start dictation/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("posture control's accessible name is 'Conversation controls', not 'Controls'", () => {
    render(<CoworkerPostureControl {...postureProps} />);
    expect(
      screen.getByRole("button", { name: /conversation controls/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^controls$/i })).not.toBeInTheDocument();
  });
});
