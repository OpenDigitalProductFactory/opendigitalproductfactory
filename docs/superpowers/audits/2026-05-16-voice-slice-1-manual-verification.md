# Voice Input Slice 1 — Manual UX Verification Checklist

**Date:** 2026-05-16
**Status:** Awaiting first execution
**Owning plan:** [`docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md`](../plans/2026-05-16-voice-input-slice-1-portal-mic.md)
**Owning spec:** [`docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md`](../specs/2026-05-16-voice-input-and-transcription-design.md)

This checklist is the live-machine companion to the Slice 1 build gate. The automated test suite (128 tests across 12 files in apps/web, plus 12 in packages/db) covers every unit + integration concern testable in vitest. This document covers what only a real browser + real sidecar can prove.

Execute the checklist once after all four Slice 1 chunks are merged to main (#686, #692, #696, and the Chunk 4 PR). Record the date + signer for each box.

---

## 0. Prerequisites

- [ ] `git pull` on `main` includes all four Slice 1 chunk merges.
- [ ] `pnpm install` completes cleanly with `@ricky0123/vad-web@^0.0.30` in the lockfile.
- [ ] Postgres + Prisma seed run cleanly: `pnpm --filter @dpf/db exec prisma db seed` shows the line "Seeded speaches transcription profile (Systran/faster-distil-whisper-large-v3)" and "Ensured EndpointTaskPerformance(speaches/..., taskType=transcription)".
- [ ] `docker compose --profile stt up -d dpf-stt` succeeds:
  - First-time pull of `ghcr.io/speaches-ai/speaches:latest-cuda` completes (may take 2–10 min depending on bandwidth).
  - `docker compose ps` shows `dpf-stt` as `running (healthy)` within ~60s.
  - `curl -fsS http://127.0.0.1:8765/v1/models` returns a JSON list including a `*whisper*` model id.

---

## 1. Default-compose state (sidecar NOT running)

The mic button must be discoverable-but-disabled when STT is not configured.

- [ ] Stop the STT sidecar: `docker compose --profile stt down`.
- [ ] Default-compose stack is still up: `docker compose up -d`.
- [ ] Open the AI Coworker panel (any portal page that mounts `AgentMessageInput`).
- [ ] Confirm the mic button is **rendered + disabled** (greyed out, no pulsing dot).
- [ ] Hover the disabled button — tooltip reads exactly: `"Speech-to-text not configured — see Platform Tools > Communications"`.
- [ ] `data-voice-state="unconfigured"` is set on the button in DevTools.
- [ ] Navigate to **Platform Tools > Communications**. The **Speech-to-text** card renders with the **"Not configured"** badge and the actionable reason mentioning `docker compose --profile stt up`.
- [ ] Test-phrase mic on the admin card is **also disabled** with the same tooltip — no permission prompt is triggered.

---

## 2. Healthy state (sidecar running)

- [ ] Start the sidecar: `docker compose --profile stt up -d dpf-stt`.
- [ ] Wait for `docker compose ps` to report `dpf-stt` healthy.
- [ ] Refresh the Communications page. The **Speech-to-text** card now shows the **"Healthy"** badge, the speaches provider name, the distil-whisper model id, and the `http://dpf-stt:8000` endpoint.

---

## 3. Chrome / Edge — happy path (audio/webm)

- [ ] Open the AI Coworker panel on `https://localhost:<port>/storefront` (HTTPS required — `getUserMedia` refuses HTTP).
- [ ] Click the mic button. Browser permission prompt appears once. Approve.
- [ ] **Recording state:** button shows a pulsing red dot top-right; `data-voice-state="recording"`; aria-pressed=true; aria-label=`"Stop dictation"`.
- [ ] Speak three phrases including a technical term, e.g.:
  - "Schedule the design review with Daisy for Friday."
  - "Open the Kubernetes pod logs."
  - "Push the latest changes to the repository."
- [ ] Click the mic again to stop. **Transcribing state:** spinner icon; button disabled; tooltip `"Transcribing…"`.
- [ ] Within ~3s the transcript lands in the textarea at the cursor position. The textarea regains focus.
- [ ] Press **Enter** to send. The non-blocking SSE flow (PR #645 / `2026-04-03-async-coworker-messaging-design.md`) carries the message through; the coworker responds normally.
- [ ] Inspect the `AgentAttachment` row created during this exchange (`select * from "AgentAttachment" order by "createdAt" desc limit 1;`):
  - `mimeType` is `audio/webm` (Chrome/Edge).
  - `storageKey` matches the pattern `{threadId}/voice/{uuid}.webm` (per Gate 1 decision).
  - `parsedContent` JSON includes a `voice` namespace with `audioBlobId`, `durationMs`, `normalizedConfidence`, `providerConfidenceRaw`, `transcribedBy: "speaches"`, `providerModel`. **Note (deferred):** if the AgentAttachment row is not yet being written by Chunk 1–4 because the route currently relies on `AdapterRunTelemetry` only, log this as a follow-up — the attachment write lives in Chunk 4 verification scope.

---

## 4. Safari — happy path (audio/mp4)

Repeat §3 on Safari 16.4+. Same observed UX. **Confirm specifically:**

- [ ] In DevTools (Develop > Show Web Inspector), the MediaRecorder constructor receives `mimeType: "audio/mp4"` — not webm.
- [ ] The `/api/transcribe` POST body's `audio` form field has `Content-Type: audio/mp4`.
- [ ] The transcript still lands correctly. The server-side FFmpeg shim in speaches handled the format conversion transparently.
- [ ] `AgentAttachment.mimeType` is `audio/mp4` for this row.

---

## 5. Permission denial

- [ ] In Chrome: visit `chrome://settings/content/microphone`, deny the portal origin.
- [ ] Reload the portal. Click the mic.
- [ ] Button transitions to **error** state: red ring, `data-voice-state="error"`, `data-voice-error-code="permission_denied"`.
- [ ] Tooltip reads `"Microphone access denied. Re-enable in browser settings."` (or whatever the localized variant is — exact wording from `useVoiceCapture.ts`).
- [ ] Click the button again — it calls `reset()` and returns to **idle**. No crash, no infinite-loop.

---

## 6. Page Visibility auto-stop (spec §7.4)

- [ ] Start a recording, speak a phrase, then **switch tabs** before clicking stop.
- [ ] On return to the tab, recording has stopped silently. **No transcript appears.** **No POST to /api/transcribe was made.** The textarea is untouched.
- [ ] Server-side: no `AgentAttachment` row was created. No `AdapterRunTelemetry` row for this aborted recording.

This proves the buffer is discarded per spec §7.4 — backgrounded audio never leaves the browser.

---

## 7. Spacebar push-to-talk (spec §10 Q1)

- [ ] Focus the textarea while it is **empty**. Press Space (do not release immediately, just press).
- [ ] Recording starts. No space character is inserted into the textarea.
- [ ] Click mic to stop. Transcript lands.
- [ ] Type "Hello". Press Space. The space character IS inserted normally. Pressing Space again — still just inserts a space; the mic does NOT activate (textarea has content).
- [ ] Clear the textarea. Press Space again — mic activates again.

---

## 8. Escape cancels (spec §5.1)

- [ ] Start a recording. Press **Escape**.
- [ ] Recording stops; the audio is sent through to `/api/transcribe` (Escape stops cleanly, it does NOT discard like backgrounding).
- [ ] Transcript appears.

---

## 9. Admin test-phrase harness

- [ ] On the Communications page, find the Speech-to-text card.
- [ ] Click the test-phrase mic. Permission prompt (if not already approved).
- [ ] Speak a short phrase. Click stop.
- [ ] Transcript appears in the "Last test result" panel below the mic, formatted as `"<phrase>"`.
- [ ] An ISO timestamp `"Tested <date>"` renders.
- [ ] Repeat the test — both panels update on each run.
- [ ] Empty-result path: click mic, click stop immediately without speaking. Result panel shows `"(empty transcript — try speaking a clearer phrase)"`.

---

## 10. Error path: provider unreachable

- [ ] Stop the sidecar while a recording is in flight: in a separate terminal, `docker compose --profile stt stop dpf-stt`. Click mic in the portal, speak, click stop.
- [ ] Button transitions to error state with `data-voice-error-code="network"` (or `transcription_failed` if the sidecar accepted the request before going down).
- [ ] Tooltip carries a meaningful HTTP / network error message.
- [ ] Restart the sidecar: `docker compose --profile stt start dpf-stt`. Click the error mic to reset. Click again to record. Transcript flows again.

---

## 11. AdapterRunTelemetry audit

After completing §3, §4, and §9:

- [ ] `select "providerId","modelId","durationMs","status","agentId" from "AdapterRunTelemetry" where "providerId"='speaches' order by "startedAt" desc limit 10;` returns rows for each completed transcription.
- [ ] `status` is `success` for the happy-path runs; appropriate failure class for any §10 deliberate-failure runs.
- [ ] Per Gate 2 decision: `EndpointTaskPerformance.evaluationCount` for the speaches endpoint may still be 0 (evaluation cycle runs separately); `RouteDecisionLog` follow-up is captured as Slice 2 polish work, not blocking this checklist.

---

## 12. Edge cases worth checking

- [ ] **Audio > 25 MB upload:** dictate for ~25 minutes straight (or programmatically POST a 26 MB blob to /api/transcribe). Server returns **413 tool-denied**. Client surfaces a friendly error.
- [ ] **Audio of wrong MIME** (manually POST `Content-Type: image/png`): server returns **415 tool-denied**.
- [ ] **Network drop mid-record:** disconnect Wi-Fi during recording. Click stop. The fetch fails; `data-voice-error-code="network"`.
- [ ] **Concurrent recordings prevented:** double-click the mic quickly. Only one `getUserMedia` call fires; subsequent clicks while in `recording` or `transcribing` state are no-ops.

---

## 13. Sign-off

| Section | Tester | Date | Pass / fail / notes |
|---------|--------|------|----------------------|
| 0. Prerequisites | | | |
| 1. Default-compose unconfigured | | | |
| 2. Healthy state | | | |
| 3. Chrome/Edge happy path | | | |
| 4. Safari happy path | | | |
| 5. Permission denial | | | |
| 6. Page Visibility auto-stop | | | |
| 7. Spacebar PTT | | | |
| 8. Escape cancels | | | |
| 9. Admin test harness | | | |
| 10. Provider unreachable | | | |
| 11. Telemetry audit | | | |
| 12. Edge cases | | | |

A green pass on §1–11 is the bar for declaring Slice 1 shipped. §12 edge cases are advisory and can be tracked as polish work without blocking.

## 14. Known follow-ups not gated by this checklist

These were deferred during Slice 1 implementation; they are tracked but do NOT block Slice 1 ship:

- **VAD silence-detection auto-stop** (spec §4.6) — `@ricky0123/vad-web` is on the dependency list but the silence-trigger wiring is deferred to Slice 2. Manual stop via the button or Escape works fine; this is a polish item.
- **Playwright e2e spec** (Prerequisite 5, Path A) — Slice 1 shipped with Vitest + Testing Library coverage of the mic→textarea round-trip. A 1-task follow-up PR adds a Playwright spec once a Playwright-config PR lands on main.
- **`RouteDecisionLog` lightweight audit row** (Gate 2 decision) — deferred until multiple STT providers exist and routing decisions become non-trivial.
- **Live Whisper verbose_json fixture** (Task 5) — current fixture at `apps/web/app/api/transcribe/__fixtures__/whisper-segments.json` is spec-shape-accurate but synthetic. Swap with a live capture after §2 succeeds.
