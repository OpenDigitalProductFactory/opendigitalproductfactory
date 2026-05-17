// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MicButton } from "./MicButton";

/**
 * Voice Input Slice 1 / Task 9 — MicButton tests.
 *
 * Covers the state machine surface, ARIA labels per spec §5.1, the
 * disabled-with-tooltip "unconfigured" state per Task 13 Step 6, the
 * red privacy-indicator dot, and click handler routing.
 */

afterEach(() => cleanup());

const defaultProps = {
  state: "idle" as const,
  supported: true,
  onStart: vi.fn(),
  onStop: vi.fn(),
  onReset: vi.fn(),
};

describe("MicButton — idle state", () => {
  it("renders with 'Start dictation' aria-label", () => {
    render(<MicButton {...defaultProps} />);
    expect(screen.getByRole("button", { name: /start dictation/i })).toBeTruthy();
  });

  it("calls onStart when clicked", () => {
    const onStart = vi.fn();
    render(<MicButton {...defaultProps} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("does NOT render the recording dot", () => {
    render(<MicButton {...defaultProps} />);
    expect(screen.queryByTestId("voice-recording-dot")).toBeNull();
  });

  it("sets aria-pressed=false when idle", () => {
    render(<MicButton {...defaultProps} />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("MicButton — recording state (spec §5.1)", () => {
  it("renders with 'Stop dictation' aria-label and aria-pressed=true", () => {
    render(<MicButton {...defaultProps} state="recording" />);
    const button = screen.getByRole("button", { name: /stop dictation/i });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders the red privacy-indicator dot", () => {
    render(<MicButton {...defaultProps} state="recording" />);
    expect(screen.getByTestId("voice-recording-dot")).toBeTruthy();
  });

  it("calls onStop when clicked", () => {
    const onStop = vi.fn();
    render(<MicButton {...defaultProps} state="recording" onStop={onStop} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("treats permission_check the same as recording (microphone is live)", () => {
    render(<MicButton {...defaultProps} state="permission_check" />);
    expect(screen.getByTestId("voice-recording-dot")).toBeTruthy();
  });
});

describe("MicButton — transcribing state", () => {
  it("renders 'Transcribing…' tooltip and is disabled", () => {
    render(<MicButton {...defaultProps} state="transcribing" />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("title")).toBe("Transcribing…");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("ignores clicks while transcribing", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    render(
      <MicButton {...defaultProps} state="transcribing" onStart={onStart} onStop={onStop} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onStart).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });
});

describe("MicButton — error state", () => {
  it("renders the user-supplied error message in the tooltip", () => {
    render(
      <MicButton
        {...defaultProps}
        state="error"
        errorMessage="Microphone access denied. Re-enable in browser settings."
      />,
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("title")).toMatch(/Microphone access denied/);
  });

  it("exposes errorCode as a data attribute for upstream UX hooks", () => {
    render(
      <MicButton
        {...defaultProps}
        state="error"
        errorCode="permission_denied"
        errorMessage="denied"
      />,
    );
    expect(screen.getByRole("button").getAttribute("data-voice-error-code")).toBe(
      "permission_denied",
    );
  });

  it("calls onReset (not onStart) when clicked in error state", () => {
    const onReset = vi.fn();
    const onStart = vi.fn();
    render(
      <MicButton {...defaultProps} state="error" onReset={onReset} onStart={onStart} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("MicButton — unconfigured state (Task 13 Step 6 decision)", () => {
  it("renders DISABLED with the 'not configured' tooltip when supported=false", () => {
    render(<MicButton {...defaultProps} supported={false} />);
    const button = screen.getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toMatch(/not configured/i);
    expect(button.getAttribute("title")).toMatch(/Platform Tools/i);
  });

  it("ignores clicks when unsupported (no callbacks fire)", () => {
    const onStart = vi.fn();
    render(<MicButton {...defaultProps} supported={false} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("MicButton — globally disabled (e.g. agent busy)", () => {
  it("is disabled when disabled=true regardless of state", () => {
    render(<MicButton {...defaultProps} state="idle" disabled={true} />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not fire onStart when disabled and clicked", () => {
    const onStart = vi.fn();
    render(<MicButton {...defaultProps} state="idle" disabled={true} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("MicButton — data-voice-state attribute (for telemetry / e2e selectors)", () => {
  it.each([
    ["idle", "idle"],
    ["recording", "recording"],
    ["transcribing", "transcribing"],
    ["error", "error"],
  ] as const)("exposes data-voice-state='%s' when state=%s", (_label, state) => {
    render(<MicButton {...defaultProps} state={state} />);
    expect(screen.getByRole("button").getAttribute("data-voice-state")).toBe(_label);
  });

  it("exposes data-voice-state='unconfigured' when supported=false", () => {
    render(<MicButton {...defaultProps} supported={false} />);
    expect(screen.getByRole("button").getAttribute("data-voice-state")).toBe("unconfigured");
  });
});
