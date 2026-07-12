// TTS health-probe contract guard (BI-7988DAD8).
//
// The 2026-06/07 phantom-VoiceServiceDown incident: the portal probe requested
// GET /health, but the chatterbox sidecar served its health check at "/" only.
// Each side had green unit tests — the probe's tests MOCKED the server and the
// server had no CI-run tests at all — so the contract mismatch lived for weeks
// as a permanently-firing alert on a healthy install. The probe and the server
// are different languages in different runtimes; this test is the one place CI
// pins them to the same contract, source-to-source (same genre as the
// Dockerfile build-context guard).

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = resolve(__dirname, "../../../..")

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8")
}

describe("TTS health-probe contract", () => {
  it("chatterbox sidecar serves the /health path the portal probe requests", () => {
    const server = read("scripts/tts/chatterbox_server.py")
    expect(server).toContain('@app.get("/health")')
    // The probe's 404 fallback target must also exist for sidecars provisioned
    // before /health was added.
    expect(server).toContain('@app.get("/")')
  })

  it("probe requests /health and falls back to the base URL on 404", () => {
    const probe = read("apps/web/lib/voice-synthesis/service-status.ts")
    expect(probe).toContain("/health")
    // Fallback is what covers legacy chatterbox installs AND the mlx sidecar
    // (mlx_audio.server has no /health but serves "/" with 200).
    expect(probe).toMatch(/status === 404[\s\S]*new URL\("\/", healthUrl\)/)
  })

  it("macOS overlay wires host-native TTS env on EVERY service exporting voice gauges", () => {
    const overlay = read("docker-compose.macos.yml")
    // Both portal and sandbox run the web app and export dpf_voice_tts_*.
    // Missing either one re-creates the phantom VoiceServiceDown{job="sandbox"}:
    // the base compose defaults to dpf-tts:8000, which macOS installs never run.
    for (const service of ["portal:", "sandbox:"]) {
      const idx = overlay.indexOf(`  ${service}`)
      expect(idx, `${service} service missing from macOS overlay`).toBeGreaterThan(-1)
      const nextService = overlay.slice(idx + 2).search(/\n {2}[a-z-]+:/)
      const block = overlay.slice(idx, nextService === -1 ? undefined : idx + 2 + nextService)
      expect(block, `${service} block must set DPF_TTS_URL`).toContain("DPF_TTS_URL")
    }
  })
})
