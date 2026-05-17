// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";

/**
 * Voice Input Slice 1 / Task 11 — admin test-phrase harness tests.
 *
 * Verifies the harness:
 *   - Disables the mic when readiness is not healthy (prevents wasted
 *     permission prompts).
 *   - Forwards the transcript into a visible "last test result" panel
 *     with an ISO timestamp.
 *   - Surfaces errors via role="alert" so screen readers announce them.
 *
 * The useVoiceCapture hook is mocked at module boundary so each test can
 * drive its return values.
 */

const hoisted = vi.hoisted(() => {
  const state = {
    state: "idle" as
      | "idle"
      | "permission_check"
      | "recording"
      | "transcribing"
      | "result"
      | "error",
    error: null as string | null,
    errorCode: null as string | null,
    supported: true,
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    transcriptCallback: null as ((text: string) => void) | null,
  };
  return { state };
});

vi.mock("@/components/agent/hooks/useVoiceCapture", () => ({
  useVoiceCapture: ({ onTranscript }: { onTranscript: (t: string) => void }) => {
    hoisted.state.transcriptCallback = onTranscript;
    return {
      state: hoisted.state.state,
      error: hoisted.state.error,
      errorCode: hoisted.state.errorCode,
      supported: hoisted.state.supported,
      start: hoisted.state.start,
      stop: hoisted.state.stop,
      reset: hoisted.state.reset,
    };
  },
}));

import { SpeechToTextTestHarness } from "./SpeechToTextTestHarness";

beforeEach(() => {
  hoisted.state.state = "idle";
  hoisted.state.error = null;
  hoisted.state.errorCode = null;
  hoisted.state.supported = true;
  hoisted.state.start.mockClear();
  hoisted.state.stop.mockClear();
  hoisted.state.reset.mockClear();
  hoisted.state.transcriptCallback = null;
});

afterEach(() => cleanup());

describe("SpeechToTextTestHarness — initial render", () => {
  it("renders the test-phrase instructions and a mic button", () => {
    render(<SpeechToTextTestHarness readinessIsHealthy={true} />);
    expect(screen.getByText(/Test phrase/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /start dictation/i })).toBeTruthy();
  });

  it("does NOT render a last-test-result panel before any test runs", () => {
    render(<SpeechToTextTestHarness readinessIsHealthy={true} />);
    expect(screen.queryByTestId("stt-test-result")).toBeNull();
  });
});

describe("SpeechToTextTestHarness — readinessIsHealthy=false (sidecar not running)", () => {
  it("renders the mic button DISABLED with the 'not configured' tooltip", () => {
    render(<SpeechToTextTestHarness readinessIsHealthy={false} />);
    const button = screen.getByRole("button", { name: /not configured/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("clicking the disabled mic does NOT call voice.start()", () => {
    render(<SpeechToTextTestHarness readinessIsHealthy={false} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(hoisted.state.start).not.toHaveBeenCalled();
  });
});

describe("SpeechToTextTestHarness — transcript renders + timestamp recorded", () => {
  it("surfaces the transcript via the onTranscript callback", () => {
    render(<SpeechToTextTestHarness readinessIsHealthy={true} />);
    expect(hoisted.state.transcriptCallback).not.toBeNull();
    act(() => {
      hoisted.state.transcriptCallback!("This is a test phrase.");
    });
    const result = screen.getByTestId("stt-test-result");
    expect(result.textContent).toMatch(/This is a test phrase/);
  });

  it("renders a friendly placeholder when the transcript is empty", () => {
    render(<SpeechToTextTestHarness readinessIsHealthy={true} />);
    act(() => {
      hoisted.state.transcriptCallback!("");
    });
    const result = screen.getByTestId("stt-test-result");
    expect(result.textContent).toMatch(/empty transcript/i);
  });

  it("renders a 'Tested ...' timestamp after a successful test", () => {
    render(<SpeechToTextTestHarness readinessIsHealthy={true} />);
    act(() => {
      hoisted.state.transcriptCallback!("hello world");
    });
    const result = screen.getByTestId("stt-test-result");
    expect(result.textContent).toMatch(/Tested/);
  });
});

describe("SpeechToTextTestHarness — error display", () => {
  it("renders the error message via role='alert' when state=error", () => {
    hoisted.state.state = "error";
    hoisted.state.error = "Microphone access denied. Re-enable in browser settings.";
    hoisted.state.errorCode = "permission_denied";
    render(<SpeechToTextTestHarness readinessIsHealthy={true} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Microphone access denied/);
  });

  it("does NOT render an alert when there is no error", () => {
    render(<SpeechToTextTestHarness readinessIsHealthy={true} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
