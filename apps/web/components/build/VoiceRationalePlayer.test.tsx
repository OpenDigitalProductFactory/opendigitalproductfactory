// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { afterEach, describe, it, expect } from "vitest"
import { cleanup } from "@testing-library/react"
import { VoiceRationalePlayer } from "./VoiceRationalePlayer"

afterEach(() => { cleanup() })

describe("VoiceRationalePlayer", () => {
  it("shows loading indicator when audioUrl is undefined", () => {
    render(<VoiceRationalePlayer audioUrl={undefined} durationMs={undefined} />)
    // getByRole throws if not found — element presence is asserted implicitly
    expect(screen.getByRole("status")).toBeTruthy()
  })

  it("shows play button when audioUrl is provided", () => {
    render(<VoiceRationalePlayer audioUrl="/api/voice/audio/voice/DI-abc/f.mp3" durationMs={4200} />)
    expect(screen.getByRole("button", { name: /play/i })).toBeTruthy()
  })

  it("shows formatted duration", () => {
    render(<VoiceRationalePlayer audioUrl="/api/voice/audio/voice/DI-abc/f.mp3" durationMs={65000} />)
    expect(screen.getByText("1:05")).toBeTruthy()
  })

  it("renders nothing when voiceEnabled is false", () => {
    const { container } = render(
      <VoiceRationalePlayer audioUrl={undefined} durationMs={undefined} voiceEnabled={false} />
    )
    expect(container.firstChild).toBeNull()
  })
})
