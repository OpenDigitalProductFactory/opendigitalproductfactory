// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { VoiceProfileSetup } from "./VoiceProfileSetup"

vi.mock("@/components/admin/VoiceConsentForm", () => ({
  VoiceConsentForm: () => <div>voice consent form</div>,
}))

vi.mock("@/lib/actions/voice-profile", () => ({
  resetVoiceProfile: vi.fn(),
  setVoiceEnabled: vi.fn(),
}))

const hoisted = vi.hoisted(() => ({
  voiceSynth: {
    available: false,
    isPlaying: false,
    isSynthesizing: false,
    synthesize: vi.fn(),
    stop: vi.fn(),
  },
}))

vi.mock("@/components/agent/hooks/useVoiceSynth", () => ({
  useVoiceSynth: () => hoisted.voiceSynth,
}))

afterEach(() => cleanup())

describe("VoiceProfileSetup", () => {
  it("keeps the preview voice control visible when synthesis is unavailable", () => {
    render(
      <VoiceProfileSetup
        profileId="mark-dpf-platform"
        profileName="Mark / DPF Platform"
        voiceEnabled={true}
        currentUserId="user-1"
        voiceProfile={{
          id: "voice-1",
          provider: "chatterbox",
          providerVoiceId: "voices/mark/reference.webm",
          status: "ready",
          consentType: "explicit",
          qualityScore: null,
          language: "en",
          consentRecord: {
            id: "consent-1",
            subjectName: "Mark Bodman",
            expiresAt: "2099-12-31T00:00:00.000Z",
            revokedAt: null,
          },
        }}
      />,
    )

    const preview = screen.getByRole("button", { name: /voice preview unavailable/i })
    expect(preview).toBeTruthy()
    expect((preview as HTMLButtonElement).disabled).toBe(true)
  })
})
