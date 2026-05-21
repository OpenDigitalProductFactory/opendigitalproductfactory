import { describe, it, expect, vi } from "vitest"
import { writeAudioBlob, audioStorageKeyToUrl } from "./audio-storage"
import * as fs from "node:fs/promises"

vi.mock("node:fs/promises")
const mockFs = vi.mocked(fs)

describe("writeAudioBlob", () => {
  it("writes audio buffer and returns storageKey with interactionId prefix", async () => {
    mockFs.mkdir = vi.fn().mockResolvedValue(undefined)
    mockFs.writeFile = vi.fn().mockResolvedValue(undefined)
    mockFs.rename = vi.fn().mockResolvedValue(undefined)

    const buf = Buffer.from("FAKE_AUDIO").buffer
    const result = await writeAudioBlob({
      interactionId: "DI-abc123",
      audioBuffer: buf,
      ext: "mp3",
      storageRoot: "/tmp/uploads",
    })

    expect(result.storageKey).toMatch(/^voice\/DI-abc123\//)
    expect(result.storageKey).toMatch(/\.mp3$/)
    expect(mockFs.writeFile).toHaveBeenCalled()
  })
})

describe("audioStorageKeyToUrl", () => {
  it("converts storageKey to /api/voice/audio/ URL", () => {
    const url = audioStorageKeyToUrl("voice/DI-abc/file.mp3")
    expect(url).toBe("/api/voice/audio/voice/DI-abc/file.mp3")
  })
})
