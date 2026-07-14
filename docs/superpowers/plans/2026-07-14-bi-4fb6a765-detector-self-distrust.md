# BI-4FB6A765 — Detector self-distrust for alert/feature contradictions

Backlog item: `BI-4FB6A765`

## Problem

`VoiceServiceDown` is only truthful when voice narration is enabled and the TTS sidecar is down. The Prometheus rule encodes that (`dpf_voice_tts_enabled == 1 and dpf_voice_tts_up == 0`), but the alert delivery path currently trusts evaluator output blindly. If gauge export, scrape staleness, or evaluator state contradicts the platform's live feature state, the portal can persist and show a phantom outage as if it were true.

## Plan

1. Add a shared alert self-distrust screen in the observability layer.
   - Input: normalized `PlatformAlert` records from Prometheus/Loki.
   - First rule: for `VoiceServiceDown`, query live voice narration state via `isVoiceNarrationEnabled`.
   - If the alert says voice is down while live state says narration is disabled, transform it into a detector-contradiction alert instead of a service-down alert.

2. Apply the screen to both user-facing and durable alert paths.
   - `/api/platform/metrics/alerts` should stop showing a contradicted alert as a true voice outage.
   - `alert-delivery-bridge` should persist the detector contradiction as the actionable issue and allow stale `VoiceServiceDown` issues to resolve.

3. Verify with focused tests.
   - Unit-test the self-distrust screen for enabled, disabled, and checker-error cases.
   - Extend alert-delivery tests so a contradicted `VoiceServiceDown` becomes a `DetectorSelfDistrust` issue and does not keep the original `VoiceServiceDown` key firing.

## Verification

- `pnpm --filter web exec vitest run lib/observability/alert-self-distrust.test.ts lib/queue/functions/alert-delivery-bridge.test.ts components/monitoring/alert-humanize.test.ts`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter web typecheck`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter web build`
- Local-CI merge gate before push/PR.

## Rollback

Remove the self-distrust screen and restore direct consumption of `fetchAlertSources()` in the metrics route and bridge. No migration or data-shape change is required.
