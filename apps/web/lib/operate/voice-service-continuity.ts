// Boot-time desired-state check for the voice (TTS) service. [BI-264565A4]
//
// A /health-only sidecar cannot be a Prometheus scrape target, and a profile-
// gated sidecar that is enabled in config but never actuated is invisible — the
// 2026-06-24 incident, where voice was dead for ~a month while the page showed
// "ready". This mirrors db-continuity's fail-loud pattern: if narration is
// enabled but the sidecar is unreachable AT BOOT, log CRITICAL immediately
// (before the first Prometheus scrape + the VoiceServiceDown alert's 2m wait).
// Non-fatal. Self-healing (auto-starting the sidecar) needs host exec and is a
// separate follow-up — this is the detection/fail-loud half.

export async function assertVoiceServiceOnBoot(
  logger: Pick<Console, "log" | "error"> = console,
): Promise<{ enabled: boolean; up: boolean } | null> {
  try {
    const { isVoiceNarrationEnabled, resolveTtsServiceUp } = await import(
      "@/lib/voice-synthesis/service-status"
    )
    const enabled = await isVoiceNarrationEnabled()
    if (!enabled) return { enabled: false, up: true }

    const status = await resolveTtsServiceUp()
    if (!status.up) {
      logger.error(
        `[voice-continuity] CRITICAL: voice narration is enabled but the TTS service (${status.provider}) is unreachable: ${status.reason ?? "down"}. ` +
          `WWMD narration and voice previews will fail until the dpf-tts sidecar is running.`,
      )
    } else {
      logger.log("[voice-continuity] voice narration enabled and TTS service reachable")
    }
    return { enabled: true, up: status.up }
  } catch (err) {
    logger.error("[voice-continuity] boot check failed (non-fatal):", err)
    return null
  }
}
