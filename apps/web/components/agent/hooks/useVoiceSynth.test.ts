// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useVoiceSynth } from "./useVoiceSynth"

// ── AudioContext mock ───────────────────────────────────────────────────────
class MockAudioBufferSource {
  buffer: null = null
  onended: (() => void) | null = null
  connect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}

class MockAudioContext {
  state = "running"
  currentTime = 0
  sampleRate = 44100
  createBuffer = vi.fn(() => ({} as AudioBuffer))
  createBufferSource = vi.fn(() => new MockAudioBufferSource())
  decodeAudioData = vi.fn(() =>
    Promise.resolve({ duration: 2.0, numberOfChannels: 1, sampleRate: 24000 } as AudioBuffer),
  )
  resume = vi.fn()
  destination = {} as AudioDestinationNode
}

function makeChunk() {
  const wavBytes = new Uint8Array(44).fill(0)
  const length = wavBytes.length
  const buf = new Uint8Array(4 + length)
  buf[0] = (length >> 24) & 0xff
  buf[1] = (length >> 16) & 0xff
  buf[2] = (length >> 8) & 0xff
  buf[3] = length & 0xff
  buf.set(wavBytes, 4)
  return buf
}

describe("useVoiceSynth (streaming)", () => {
  let originalFetch: typeof fetch
  let originalAudioContext: typeof AudioContext

  beforeEach(() => {
    originalFetch = global.fetch
    originalAudioContext = global.AudioContext
    vi.spyOn(console, "warn").mockImplementation(() => {})
    global.AudioContext = MockAudioContext as unknown as typeof AudioContext
  })

  afterEach(() => {
    global.fetch = originalFetch
    global.AudioContext = originalAudioContext
    vi.restoreAllMocks()
  })

  it("calls /api/voice/synthesize/stream", async () => {
    const chunk = makeChunk()
    const readable = new ReadableStream({
      start(controller) { controller.enqueue(chunk); controller.close() },
    })
    global.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes("service-status")
      ? new Response(JSON.stringify({ available: true, state: "ready", reason: null }), { status: 200 })
      : ({ ok: true, body: readable, headers: new Headers({ "X-Sentence-Count": "1" }) } as Response)
    ) as typeof fetch

    const { result } = renderHook(() => useVoiceSynth())
    await act(async () => { await result.current.synthesize("Hello world") })

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/voice/synthesize/stream",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("marks available false on 503 tts_unavailable", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes("service-status")
      ? new Response(JSON.stringify({ available: true, state: "ready", reason: null }), { status: 200 })
      : ({ ok: false, status: 503, json: () => Promise.resolve({ code: "tts_unavailable" }) } as Response)
    ) as typeof fetch

    const { result } = renderHook(() => useVoiceSynth())
    await waitFor(() => expect(result.current.checking).toBe(false))
    await act(async () => { await result.current.synthesize("Hello") })

    await waitFor(() => {
      expect(result.current.available).toBe(false)
      expect(result.current.unavailableReason).toBe("Text-to-speech is unavailable.")
    })
  })

  it("stop() aborts the stream and clears state", async () => {
    let abortCalled = false
    global.fetch = vi.fn().mockImplementation((url: string, opts: RequestInit) => {
      if (url.includes("service-status")) {
        return Promise.resolve(new Response(JSON.stringify({ available: true, state: "ready", reason: null }), { status: 200 }))
      }
      (opts.signal as AbortSignal).addEventListener("abort", () => { abortCalled = true })
      return new Promise(() => {})
    }) as unknown as typeof fetch

    const { result } = renderHook(() => useVoiceSynth())
    act(() => { void result.current.synthesize("Hello") })
    await act(async () => { result.current.stop() })

    expect(abortCalled).toBe(true)
    expect(result.current.isPlaying).toBe(false)
    expect(result.current.isSynthesizing).toBe(false)
  })

  it("probes playback capability on mount before enabling the speaker", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      available: false,
      state: "profile_missing",
      reason: "No ready voice profile is available.",
    }), { status: 200 })) as typeof fetch

    const { result } = renderHook(() => useVoiceSynth())
    expect(result.current.checking).toBe(true)
    expect(result.current.available).toBe(false)
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(result.current.readinessState).toBe("profile_missing")
    expect(result.current.unavailableReason).toMatch(/No ready voice profile/)
  })

  it("requests preview readiness without requiring narration to be enabled", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      available: true,
      state: "ready",
      reason: null,
    }), { status: 200 })) as typeof fetch

    const { result } = renderHook(() => useVoiceSynth({ purpose: "preview" }))
    await waitFor(() => expect(result.current.checking).toBe(false))

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/voice/service-status?purpose=preview",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.current.available).toBe(true)
  })
})
