// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useVoiceSynth } from "./useVoiceSynth"

const fetchMock = vi.fn()

class FakeAudio {
  src = ""
  onended: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(src: string) {
    this.src = src
  }

  pause() {}
  play = vi.fn().mockResolvedValue(undefined)
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("Audio", FakeAudio)
  vi.spyOn(console, "warn").mockImplementation(() => {})
  fetchMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("useVoiceSynth", () => {
  it("marks synthesis unavailable when the ready profile is missing reference audio", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ code: "reference_missing" }),
    })

    const { result } = renderHook(() => useVoiceSynth())

    expect(result.current.available).toBe(true)

    await act(async () => {
      await result.current.synthesize("preview this", "mark-dpf-platform")
    })

    expect(result.current.available).toBe(false)
    expect(result.current.unavailableReason).toMatch(/reference voice sample is missing/i)
  })
})
