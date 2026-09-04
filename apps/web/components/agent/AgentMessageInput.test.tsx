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

// Stub the upload helper so paste/drag tests don't hit the network.
const uploadMock = vi.hoisted(() => ({
  uploadAgentAttachment: vi.fn(async () => ({
    ok: true as const,
    result: { attachmentId: "att-1", fileName: "shot.png", parsedContent: null },
  })),
}));
vi.mock("./uploadAgentAttachment", () => ({
  uploadAgentAttachment: uploadMock.uploadAgentAttachment,
  isAcceptedUploadFile: () => true,
  UPLOAD_ACCEPT_ATTR: ".png",
  ACCEPTED_UPLOAD_EXTENSIONS: ["png"],
}));

const defaultProps = {
  onSend: vi.fn(),
  composerState: "ready" as const,
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
  uploadMock.uploadAgentAttachment.mockClear();
});

afterEach(() => cleanup());

describe("AgentMessageInput — mic button is mounted", () => {
  it("renders the mic button in idle state", () => {
    render(<AgentMessageInput {...defaultProps} />);
    expect(screen.getByRole("button", { name: /start dictation/i })).toBeTruthy();
  });

  it("disables the mic button when the parent is busy or disabled", () => {
    render(<AgentMessageInput {...defaultProps} composerState="connecting" />);
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

describe("AgentMessageInput — voice playback affordance", () => {
  it("announces capability checking separately from an unavailable service", () => {
    render(
      <AgentMessageInput
        {...defaultProps}
        voiceSynthChecking
        voiceSynthAvailable={false}
        voicePlaybackEnabled={true}
        onVoicePlaybackToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /checking voice playback/i })).toBeTruthy();
  });

  it("keeps the speaker control visible but disabled when voice synthesis is unavailable", () => {
    render(
      <AgentMessageInput
        {...defaultProps}
        voiceSynthAvailable={false}
        voicePlaybackEnabled={true}
        onVoicePlaybackToggle={vi.fn()}
      />,
    );

    const speaker = screen.getByRole("button", { name: /voice playback unavailable/i });
    expect(speaker).toBeTruthy();
    expect((speaker as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AgentMessageInput — paste / drag-drop attachment", () => {
  it("uploads a pasted image file and notifies the parent", async () => {
    const onFileUploaded = vi.fn();
    render(<AgentMessageInput {...defaultProps} onFileUploaded={onFileUploaded} />);
    const textarea = screen.getByRole("textbox");
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    await act(async () => {
      fireEvent.paste(textarea, { clipboardData: { files: [file], items: [], types: ["Files"] } });
    });
    expect(uploadMock.uploadAgentAttachment).toHaveBeenCalledWith(file, "thread-1");
    expect(onFileUploaded).toHaveBeenCalledWith({ attachmentId: "att-1", fileName: "shot.png", parsedContent: null });
  });

  it("ignores a plain-text paste (no files) so normal text paste still works", async () => {
    render(<AgentMessageInput {...defaultProps} />);
    const textarea = screen.getByRole("textbox");
    await act(async () => {
      fireEvent.paste(textarea, { clipboardData: { files: [], items: [], types: ["text/plain"] } });
    });
    expect(uploadMock.uploadAgentAttachment).not.toHaveBeenCalled();
  });

  it("uploads a dropped file and notifies the parent", async () => {
    const onFileUploaded = vi.fn();
    render(<AgentMessageInput {...defaultProps} onFileUploaded={onFileUploaded} />);
    const textarea = screen.getByRole("textbox");
    const file = new File([new Uint8Array([1, 2, 3])], "diagram.png", { type: "image/png" });
    await act(async () => {
      fireEvent.drop(textarea, { dataTransfer: { files: [file], items: [], types: ["Files"] } });
    });
    expect(uploadMock.uploadAgentAttachment).toHaveBeenCalledWith(file, "thread-1");
    expect(onFileUploaded).toHaveBeenCalledTimes(1);
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

describe("AgentMessageInput — optional question packet context", () => {
  it("keeps simple sends lightweight when the context tray is empty", () => {
    const onSend = vi.fn();
    render(<AgentMessageInput {...defaultProps} onSend={onSend} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Explain this page" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(onSend).toHaveBeenCalledWith("Explain this page");
  });

  it("opens the context popover when the [+] button is clicked", () => {
    render(<AgentMessageInput {...defaultProps} />);

    // Popover hidden by default — menu role not in the DOM.
    expect(screen.queryByRole("menu", { name: /add context/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /add context/i }));

    expect(screen.getByRole("menu", { name: /add context/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /set intent/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /add source ref/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /add scope edge/i })).toBeTruthy();
  });

  it("sends populated chips as a structured question packet", () => {
    const onSend = vi.fn();
    render(<AgentMessageInput {...defaultProps} onSend={onSend} />);

    // 1. Intent chip via popover → inline editor → Save.
    fireEvent.click(screen.getByRole("button", { name: /add context/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /set intent/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /^intent$/i }), {
      target: { value: "Find the smallest safe implementation slice" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // 2. First source chip (commits via Enter — exercises keyboard path).
    fireEvent.click(screen.getByRole("button", { name: /add context/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /add source ref/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /^source$/i }), {
      target: {
        value:
          "docs/superpowers/plans/2026-05-22-ai-question-method-platform-implementation.md",
      },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: /^source$/i }), {
      key: "Enter",
    });

    // 3. Second source chip.
    fireEvent.click(screen.getByRole("button", { name: /add context/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /add source ref/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /^source$/i }), {
      target: { value: "BI-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // 4. First scope-edge chip.
    fireEvent.click(screen.getByRole("button", { name: /add context/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /add scope edge/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /^scope edge$/i }), {
      target: { value: "Do not grant extra tool authority" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // 5. Second scope-edge chip.
    fireEvent.click(screen.getByRole("button", { name: /add context/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /add scope edge/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /^scope edge$/i }), {
      target: { value: "Do not turn chat into a form" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // 6. Output shape pill inside the popover (artifact has no inline editor).
    fireEvent.click(screen.getByRole("button", { name: /add context/i }));
    fireEvent.click(screen.getByRole("button", { name: /^patch$/i }));

    // 7. Type the message and send.
    fireEvent.change(screen.getByPlaceholderText(/ask your co-worker/i), {
      target: { value: "Continue" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(onSend).toHaveBeenCalledWith("Continue", {
      questionPacket: {
        intentCenter: "Find the smallest safe implementation slice",
        contextRefs: [
          {
            kind: "freeform",
            label: "Source 1",
            ref: "docs/superpowers/plans/2026-05-22-ai-question-method-platform-implementation.md",
          },
          { kind: "freeform", label: "Source 2", ref: "BI-123" },
        ],
        hardEdges: [
          "Do not grant extra tool authority",
          "Do not turn chat into a form",
        ],
        expectedArtifact: "patch",
      },
    });
  });

  it("removes a chip via its × button and excludes it from the outgoing packet", () => {
    const onSend = vi.fn();
    render(<AgentMessageInput {...defaultProps} onSend={onSend} />);

    fireEvent.click(screen.getByRole("button", { name: /add context/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /set intent/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /^intent$/i }), {
      target: { value: "Decide redesign vs keep" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    fireEvent.click(screen.getByRole("button", { name: /remove intent/i }));

    fireEvent.change(screen.getByPlaceholderText(/ask your co-worker/i), {
      target: { value: "Plain question" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    // No second argument — chip was removed, so the packet is empty.
    expect(onSend).toHaveBeenCalledWith("Plain question");
  });

  it("Escape cancels an in-progress chip entry without creating a chip", () => {
    const onSend = vi.fn();
    render(<AgentMessageInput {...defaultProps} onSend={onSend} />);

    fireEvent.click(screen.getByRole("button", { name: /add context/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /add source ref/i }));
    const editor = screen.getByRole("textbox", { name: /^source$/i });
    fireEvent.change(editor, { target: { value: "draft never committed" } });
    fireEvent.keyDown(editor, { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: /^source$/i })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/ask your co-worker/i), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(onSend).toHaveBeenCalledWith("Hello");
  });
});
