// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useVoiceSynth } from "./useVoiceSynth"

// Tracks every Audio element constructed during a test so we can assert the
// gesture-unlock behaviour (created with no src, primed on a silent clip during
// the user gesture, then swapped to the real blob after the fetch resolves).
let audioInstances: MockAudio[] = []

class MockAudio {
  public onended: (() => void) | null = null
  public onerror: (() => void) | null = null
  public src = ""
  public muted = false
  public play = vi.fn().mockResolvedValue(undefined)
  public pause = vi.fn()
  constructor(src?: string) {
    if (src) this.src = src
    audioInstances.push(this)
  }
}

describe("useVoiceSynth", () => {
  let originalAudio: typeof Audio
  let originalFetch: typeof fetch
  let originalCreateURL: typeof URL.createObjectURL
  let originalRevokeURL: typeof URL.revokeObjectURL

  beforeEach(() => {
    audioInstances = []
    originalAudio = global.Audio
    originalFetch = global.fetch
    originalCreateURL = URL.createObjectURL
    originalRevokeURL = URL.revokeObjectURL
    global.Audio = MockAudio as unknown as typeof Audio
    URL.createObjectURL = vi.fn(() => "blob:mock-url")
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    global.Audio = originalAudio
    global.fetch = originalFetch
    URL.createObjectURL = originalCreateURL
    URL.revokeObjectURL = originalRevokeURL
    vi.clearAllMocks()
  })

  it("calls /api/voice/synthesize and plays the synthesized audio on success", async () => {
    const mockBlob = new Blob(["audio"], { type: "audio/wav" })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    }) as unknown as typeof fetch

    const { result } = renderHook(() => useVoiceSynth())

    await act(async () => {
      await result.current.synthesize("Hello world")
    })

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/voice/synthesize",
      expect.objectContaining({ method: "POST" }),
    )
    // One audio element is created synchronously (gesture unlock) and reused.
    expect(audioInstances).toHaveLength(1)
    const audio = audioInstances[0]
    // Primed on the silent clip during the gesture, then swapped to the blob.
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(audio.src).toBe("blob:mock-url")
    expect(audio.muted).toBe(false)
    await waitFor(() => expect(result.current.isPlaying).toBe(true))
  })

  it("unlocks audio within the gesture before the async fetch resolves", async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    global.fetch = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolveFetch = r
      }),
    ) as unknown as typeof fetch

    const { result } = renderHook(() => useVoiceSynth())

    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.synthesize("Hello")
    })

    // Before the fetch resolves, the audio element already exists and play()
    // was called once (the silent-clip unlock) — this is what survives the
    // autoplay policy after the await.
    expect(audioInstances).toHaveLength(1)
    expect(audioInstances[0].play).toHaveBeenCalledTimes(1)
    expect(audioInstances[0].muted).toBe(true)

    await act(async () => {
      resolveFetch({
        ok: true,
        blob: () => Promise.resolve(new Blob(["a"], { type: "audio/wav" })),
      })
      await pending
    })
  })

  it("sets isPlaying false and available false on 503", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ code: "tts_unavailable" }),
    }) as unknown as typeof fetch

    const { result } = renderHook(() => useVoiceSynth())

    await act(async () => {
      await result.current.synthesize("Hello")
    })

    await waitFor(() => {
      expect(result.current.available).toBe(false)
      expect(result.current.unavailableReason).toBe("Text-to-speech service is not running.")
    })
  })
})
