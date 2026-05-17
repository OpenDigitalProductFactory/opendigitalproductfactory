// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { AgentMessageInput } from "./AgentMessageInput";

/**
 * Voice Input Slice 1 / Task 10 — AgentMessageInput integration tests.
 *
 * Asserts the mic-button wiring: button renders, calls useVoiceCapture.start
 * on click, transcript is appended at cursor position, spacebar push-to-talk
 * only fires when textarea is empty, send-after-transcribe still works.
 *
 * The hook itself is unit-tested in hooks/useVoiceCapture.test.ts. Here we
 * mock the hook at module boundary so each test can drive its outputs.
 */

// Hoisted mock state — exposed so each test can configure return values.
const hoisted = vi.hoisted(() => {
  const state = {
    voiceState: "idle" as
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

vi.mock("./hooks/useVoiceCapture", () => ({
  useVoiceCapture: ({ onTranscript }: { onTranscript: (t: string) => void }) => {
    hoisted.state.transcriptCallback = onTranscript;
    return {
      state: hoisted.state.voiceState,
      error: hoisted.state.error,
      errorCode: hoisted.state.errorCode,
      supported: hoisted.state.supported,
      start: hoisted.state.start,
      stop: hoisted.state.stop,
      reset: hoisted.state.reset,
    };
  },
}));

// AgentFileUpload pulls in server-side prisma/auth/etc. — stub it.
vi.mock("./AgentFileUpload", () => ({
  AgentFileUpload: () => null,
}));

const defaultProps = {
  onSend: vi.fn(),
  disabled: false,
  threadId: "thread-1",
  pendingFile: null,
  onFileUploaded: vi.fn(),
  onFileClear: vi.fn(),
};

beforeEach(() => {
  hoisted.state.voiceState = "idle";
  hoisted.state.error = null;
  hoisted.state.errorCode = null;
  hoisted.state.supported = true;
  hoisted.state.start.mockClear();
  hoisted.state.stop.mockClear();
  hoisted.state.reset.mockClear();
  hoisted.state.transcriptCallback = null;
});

afterEach(() => cleanup());

describe("AgentMessageInput — mic button is mounted", () => {
  it("renders the mic button in idle state", () => {
    render(<AgentMessageInput {...defaultProps} />);
    expect(screen.getByRole("button", { name: /start dictation/i })).toBeTruthy();
  });

  it("disables the mic button when the parent is busy or disabled", () => {
    render(<AgentMessageInput {...defaultProps} disabled={true} />);
    const mic = screen.getByRole("button", { name: /start dictation/i });
    expect((mic as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the mic button DISABLED when voice is unsupported (e.g. STT sidecar off)", () => {
    hoisted.state.supported = false;
    render(<AgentMessageInput {...defaultProps} />);
    const mic = screen.getByRole("button", { name: /not configured/i });
    expect((mic as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AgentMessageInput — mic button click → voice.start()", () => {
  it("calls voice.start() when the idle mic button is clicked", () => {
    render(<AgentMessageInput {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /start dictation/i }));
    expect(hoisted.state.start).toHaveBeenCalledTimes(1);
  });

  it("calls voice.stop() when the recording mic button is clicked", () => {
    hoisted.state.voiceState = "recording";
    render(<AgentMessageInput {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /stop dictation/i }));
    expect(hoisted.state.stop).toHaveBeenCalledTimes(1);
  });
});

describe("AgentMessageInput — transcript is appended to textarea at cursor", () => {
  it("appends transcript text to an empty textarea", () => {
    render(<AgentMessageInput {...defaultProps} />);
    expect(hoisted.state.transcriptCallback).not.toBeNull();
    act(() => {
      hoisted.state.transcriptCallback!("hello world");
    });
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("hello world");
  });

  it("inserts transcript at the cursor position with a leading space", () => {
    render(<AgentMessageInput {...defaultProps} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Daisy" } });
    // Place cursor at the end.
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    act(() => {
      hoisted.state.transcriptCallback!("can you help");
    });
    expect(textarea.value).toBe("Daisy can you help");
  });

  it("inserts transcript without duplicate space when cursor follows a space", () => {
    render(<AgentMessageInput {...defaultProps} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Daisy " } });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    act(() => {
      hoisted.state.transcriptCallback!("ready");
    });
    expect(textarea.value).toBe("Daisy ready");
  });
});

describe("AgentMessageInput — spacebar push-to-talk (spec §10 Q1)", () => {
  it("spacebar fires voice.start() when textarea is empty and focused", () => {
    render(<AgentMessageInput {...defaultProps} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: " " });
    expect(hoisted.state.start).toHaveBeenCalledTimes(1);
  });

  it("spacebar does NOT fire voice.start() when textarea has content", () => {
    render(<AgentMessageInput {...defaultProps} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi" } });
    fireEvent.keyDown(textarea, { key: " " });
    expect(hoisted.state.start).not.toHaveBeenCalled();
  });

  it("spacebar does NOT fire voice.start() when voice is unsupported", () => {
    hoisted.state.supported = false;
    render(<AgentMessageInput {...defaultProps} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: " " });
    expect(hoisted.state.start).not.toHaveBeenCalled();
  });
});

describe("AgentMessageInput — Escape cancels recording (spec §5.1)", () => {
  it("Escape calls voice.stop() while recording", () => {
    hoisted.state.voiceState = "recording";
    render(<AgentMessageInput {...defaultProps} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(hoisted.state.stop).toHaveBeenCalledTimes(1);
  });

  it("Escape does nothing when not recording", () => {
    render(<AgentMessageInput {...defaultProps} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(hoisted.state.stop).not.toHaveBeenCalled();
  });
});

describe("AgentMessageInput — Enter still sends after voice flow", () => {
  it("Enter triggers onSend after transcript was appended", () => {
    const onSend = vi.fn();
    render(<AgentMessageInput {...defaultProps} onSend={onSend} />);
    act(() => {
      hoisted.state.transcriptCallback!("schedule the review");
    });
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledWith("schedule the review");
  });
});
