// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useVoiceCapture } from "./useVoiceCapture";

/**
 * Voice Input Slice 1 / Task 8 — useVoiceCapture hook tests.
 *
 * Covers the state machine, Safari MIME probe integration, Page Visibility
 * auto-stop, and error mapping. MediaRecorder, getUserMedia, and fetch are
 * stubbed at the global level — see beforeEach.
 */

// ── Test-controllable MediaRecorder stub ────────────────────────────────────
type StubRecorderState = "inactive" | "recording" | "paused";
interface StubRecorder {
  state: StubRecorderState;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((e: Event) => void) | null;
  start(): void;
  stop(): void;
  emitChunk(bytes: number): void;
  emitError(): void;
}

let recorderInstances: StubRecorder[] = [];
let recorderConstructorCalls: Array<{ mimeType?: string }> = [];
let supportedMimeTypes: Set<string> = new Set(["audio/webm;codecs=opus", "audio/webm"]);

function installMediaRecorder() {
  class MockMediaRecorder implements Partial<StubRecorder> {
    state: StubRecorderState = "inactive";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
      recorderConstructorCalls.push({ mimeType: options?.mimeType });
      recorderInstances.push(this as unknown as StubRecorder);
      (this as unknown as StubRecorder).emitChunk = (bytes: number) => {
        this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
      };
      (this as unknown as StubRecorder).emitError = () => {
        this.onerror?.(new Event("error"));
      };
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.onstop?.();
    }
    static isTypeSupported(mime: string): boolean {
      return supportedMimeTypes.has(mime);
    }
  }
  (globalThis as unknown as { MediaRecorder: typeof MockMediaRecorder }).MediaRecorder = MockMediaRecorder;
}

function installMediaDevices(opts: { granted: boolean; errorName?: string } = { granted: true }) {
  const getUserMedia = vi.fn(async () => {
    if (!opts.granted) {
      const err = new Error("denied");
      (err as { name?: string }).name = opts.errorName ?? "NotAllowedError";
      throw err;
    }
    return {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  return getUserMedia;
}

function installFetch(fn: typeof fetch) {
  globalThis.fetch = fn as typeof fetch;
}

beforeEach(() => {
  recorderInstances = [];
  recorderConstructorCalls = [];
  supportedMimeTypes = new Set(["audio/webm;codecs=opus", "audio/webm"]);
  installMediaRecorder();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useVoiceCapture — supported feature detection", () => {
  it("reports supported=true when MediaRecorder + getUserMedia are present", () => {
    installMediaDevices();
    const { result } = renderHook(() => useVoiceCapture({ onTranscript: vi.fn() }));
    expect(result.current.supported).toBe(true);
    expect(result.current.state).toBe("idle");
  });
});

describe("useVoiceCapture — state machine happy path", () => {
  it("idle → permission_check → recording → transcribing → result → idle", async () => {
    installMediaDevices({ granted: true });
    const onTranscript = vi.fn();
    installFetch(async () => new Response(JSON.stringify({ text: "Hello world" }), { status: 200 }));

    const { result } = renderHook(() => useVoiceCapture({ onTranscript }));

    await act(async () => {
      await result.current.start();
    });

    // Recording started.
    expect(result.current.state).toBe("recording");
    expect(recorderInstances.length).toBe(1);

    // Simulate some audio chunks, then stop.
    act(() => {
      recorderInstances[0].emitChunk(1024);
    });
    act(() => {
      result.current.stop();
    });

    // After stop → onstop fires → transcribing → result → idle (setTimeout 0).
    await waitFor(() => {
      expect(onTranscript).toHaveBeenCalledWith("Hello world");
    });
    await waitFor(() => {
      expect(result.current.state).toBe("idle");
    });
  });
});

describe("useVoiceCapture — Safari MIME probe (spec §7.3)", () => {
  it("uses audio/mp4 when only Safari MIME types are supported", async () => {
    supportedMimeTypes = new Set(["audio/mp4"]);
    installMediaDevices({ granted: true });
    installFetch(async () => new Response(JSON.stringify({ text: "" }), { status: 200 }));

    const { result } = renderHook(() => useVoiceCapture({ onTranscript: vi.fn() }));
    await act(async () => {
      await result.current.start();
    });

    expect(recorderConstructorCalls.length).toBe(1);
    expect(recorderConstructorCalls[0].mimeType).toBe("audio/mp4");
  });

  it("uses audio/webm;codecs=opus on Chrome/Firefox", async () => {
    supportedMimeTypes = new Set(["audio/webm;codecs=opus", "audio/webm"]);
    installMediaDevices({ granted: true });
    installFetch(async () => new Response(JSON.stringify({ text: "" }), { status: 200 }));

    const { result } = renderHook(() => useVoiceCapture({ onTranscript: vi.fn() }));
    await act(async () => {
      await result.current.start();
    });

    expect(recorderConstructorCalls[0].mimeType).toBe("audio/webm;codecs=opus");
  });
});

describe("useVoiceCapture — permission denial (spec §5.1 error path)", () => {
  it("transitions to error with code 'permission_denied' when getUserMedia throws NotAllowedError", async () => {
    installMediaDevices({ granted: false, errorName: "NotAllowedError" });
    const { result } = renderHook(() => useVoiceCapture({ onTranscript: vi.fn() }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe("error");
    expect(result.current.errorCode).toBe("permission_denied");
    expect(result.current.error).toMatch(/Microphone/i);
  });

  it("transitions to error with code 'no_microphone' when getUserMedia throws NotFoundError", async () => {
    installMediaDevices({ granted: false, errorName: "NotFoundError" });
    const { result } = renderHook(() => useVoiceCapture({ onTranscript: vi.fn() }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.errorCode).toBe("no_microphone");
  });

  it("reset() clears error and returns to idle", async () => {
    installMediaDevices({ granted: false });
    const { result } = renderHook(() => useVoiceCapture({ onTranscript: vi.fn() }));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe("error");

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.errorCode).toBeNull();
  });
});

describe("useVoiceCapture — transcription error mapping (spec §7.2)", () => {
  it("maps fetch network failure to errorCode='network'", async () => {
    installMediaDevices({ granted: true });
    installFetch(async () => {
      throw new Error("Failed to fetch");
    });

    const { result } = renderHook(() => useVoiceCapture({ onTranscript: vi.fn() }));
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      recorderInstances[0].emitChunk(512);
    });
    act(() => {
      result.current.stop();
    });
    await waitFor(() => {
      expect(result.current.state).toBe("error");
    });
    expect(result.current.errorCode).toBe("network");
  });

  it("maps non-2xx response to errorCode='transcription_failed'", async () => {
    installMediaDevices({ granted: true });
    installFetch(
      async () =>
        new Response(JSON.stringify({ error: { class: "tool-error", message: "STT down" } }), {
          status: 503,
        }),
    );

    const { result } = renderHook(() => useVoiceCapture({ onTranscript: vi.fn() }));
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      recorderInstances[0].emitChunk(512);
    });
    act(() => {
      result.current.stop();
    });
    await waitFor(() => {
      expect(result.current.state).toBe("error");
    });
    expect(result.current.errorCode).toBe("transcription_failed");
  });
});

describe("useVoiceCapture — Page Visibility auto-stop (spec §7.4)", () => {
  it("stops recording and discards the buffer when the tab is backgrounded", async () => {
    installMediaDevices({ granted: true });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ text: "" }), { status: 200 }));
    installFetch(fetchSpy as unknown as typeof fetch);
    const onTranscript = vi.fn();

    const { result } = renderHook(() => useVoiceCapture({ onTranscript }));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe("recording");

    act(() => {
      recorderInstances[0].emitChunk(256);
    });

    // Simulate backgrounding.
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Hook should have transitioned back to idle without firing fetch.
    await waitFor(() => {
      expect(result.current.state).toBe("idle");
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });
});

describe("useVoiceCapture — POST payload", () => {
  it("includes context and threadId on the request body", async () => {
    installMediaDevices({ granted: true });
    let captured: { context?: FormDataEntryValue; threadId?: FormDataEntryValue } = {};
    installFetch(async (_url, init) => {
      const body = init?.body as FormData;
      captured = {
        context: body.get("context") ?? undefined,
        threadId: body.get("threadId") ?? undefined,
      };
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    });

    const { result } = renderHook(() =>
      useVoiceCapture({ onTranscript: vi.fn(), threadId: "thread-7" }),
    );
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      recorderInstances[0].emitChunk(512);
    });
    act(() => {
      result.current.stop();
    });

    await waitFor(() => {
      expect(captured.context).toBe("coworker_panel");
    });
    expect(captured.threadId).toBe("thread-7");
  });
});
