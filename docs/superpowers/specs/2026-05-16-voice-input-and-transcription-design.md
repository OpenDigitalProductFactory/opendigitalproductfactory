# Voice Input and Transcription Design

**Date:** 2026-05-16
**Status:** Draft — Architect review pass 1 (2026-05-16)
**Related backlog:** Parent epic `EP-INT-2E7C1A` ("Integration Harness: Benchmarking and Private Deployment Foundation") — confirmed against live state via `dpf.list_epics` on 2026-05-16 (status `open`, 19 items, 15 open + 4 done). A child backlog item for this voice modality slice will be filed during the writing-plans phase per [live-state-over-seed-data](../../professions/data-architect/wiki/live-state-over-seed-data.md).
**Related specs:**
- `2026-05-15-employee-communication-fabric-design.md` — channel adapters, inbound normalization, delivery evidence
- `2026-05-11-autonomous-coworker-runtime-design.md` — `TaskRun` spine, `tasks/submit` contract, failure taxonomy
- `2026-04-03-async-coworker-messaging-design.md` — non-blocking send + SSE event bus the mic button rides on
- `2026-03-19-mobile-companion-app-design.md` — mobile is the future "always have the mic on you" surface
- `2026-05-13-realtime-hitl-mobile-companion-design.md` — paused-work approval flow voice can later accelerate

---

## 0. Architect Review Log

**2026-05-16 — Architect pass 1 (Chief Architect).** Substrate claims verified against the worktree:
- `apps/web/lib/routing/transcription-adapter.ts` exists and is registry-registered ✓
- `apps/web/components/agent/AgentMessageInput.tsx` exists ✓
- `AgentAttachment` model with `parsedContent Json?` exists at `packages/db/prisma/schema.prisma:3398` ✓
- Comm fabric §6.4, §13.5, §14.1, §14.3, §14.4 all real ✓
- No competing voice surface in `apps/web` (no `MediaRecorder`/`getUserMedia`/`SpeechRecognition` references) ✓
- No overlapping open PRs ✓

Changes applied in this pass:
1. Routing-extension story made concrete in new §6.7 (was hand-waved in §2).
2. Confidence normalization formula specified per provider family in §6.5 (was a single 0-1 number — Whisper does not return that).
3. `parsedContent.voice` namespace adopted instead of bare overload (§6.4); typed `voiceMetadata` column deferred to §10 Q9.
4. Docker compose consolidated to one service with `DPF_STT_IMAGE` env var (was `dpf-stt` + `dpf-stt-edge`; §6.6).
5. Bias-prompt data-classification gate added (§6.7 step 4, §7.3) — closes the off-org PII-leak path.
6. Slice 1 DoD now requires an architecture test proving `/api/transcribe` composes the registry adapter (§8 Slice 1).
7. Slice 3 hard dependency on fabric Slice 3 ordering called out explicitly (§8 Slice 3).
8. §5.2 record-type ambiguity (`AgentMessage` vs `WorkItemMessage`) resolved by deferring to the fabric normalizer's existing rules.
9. Tail-word race handling split: one-shot for Slice 1, `eof=true` deferred to Slice 4 (§4.6).
10. Telemetry table picked from three concrete candidates in §10 Q10 (was "existing inference telemetry path").
11. Storage backend explicitly an open question in §10 Q8 (was implicit in `storageKey`).
12. Frontmatter backlog parent flagged for `live-state-over-seed-data` verification (was asserted).

Open architectural decisions for Mark to ratify before Slice 1 code lands: §11 prerequisites 1–4.

**2026-05-16 — Architect pass 2 (clarifying-question follow-ups).** Two questions from Mark, both folded into the spec:
13. New §6.0 "STT engine vs LLM" — disambiguates Whisper-the-ASR from the cleanup-pass LLM. Spells out that Slices 1 and 3 work with **zero LLM calls** and Slice 2 is an opt-in quality lift.
14. New §7.3 "Browser compatibility" (renumbering existing 7.3 → 7.4) — compatibility matrix across Chrome/Edge/Firefox/Safari, the Safari `MediaRecorder` MIME-type interop wrinkle, the `isTypeSupported` probe pattern, and the minimum supported browser baseline.

---

## 1. Goal

DPF needs a governed way for humans to **speak to the platform** — to the AI Coworker panel inside the portal, and to coworkers reachable through external channels (WhatsApp voice notes, Teams audio messages, etc.) — without abandoning the comm fabric, the runtime, or the open-source self-host posture.

The design goal is a **voice input modality**, not a voice product:

- The transcript, not the audio, is the canonical record. Audio is evidence.
- Transcription is a normalization step inside the existing communication fabric, not a new transport.
- The portal mic button writes to the same `AgentMessageInput` users already type into; voice does not branch the messaging surface into a second mode.
- Self-hostable Whisper-derived stack is the default; hosted APIs (Groq, Deepgram, AssemblyAI) are routing destinations, not pins.
- The platform is a conduit: customers bring their own hosted-STT credentials if they want them — DPF never enrolls as a partner.

DPF does **not** build a voice assistant, a wake-word engine, or an always-listening surface in this spec. Push-to-talk dictation is the v1 surface.

---

## 2. Current Repo Grounding

DPF already has the substrate to land voice as a thin modality on top, not as a new vertical.

**Coworker conversation primitives.** `AgentThread` and `AgentMessage` (`packages/db/prisma/schema.prisma`) model the in-portal coworker exchange. The send path is non-blocking SSE (`POST /api/agent/send` + `GET /api/agent/stream`, per `2026-04-03-async-coworker-messaging-design.md`). The user-facing input control is `apps/web/components/agent/AgentMessageInput.tsx` — a textarea + file attachment.

**Communication fabric.** `apps/web/lib/communications/` ships the canonical channel adapter contract (`channel-types.ts`), channel binding store, dispatch policy, delivery evidence, and an in-app adapter. Channels: `in-app | push | email | teams | slack | whatsapp | telegram | webhook`. PRs #619 and #628 landed Slice 0/1; PR #645 reconciled the fabric/runtime/WhatsApp trio. **Inbound channel messages are normalized before agent routing** (fabric §5, §6) — that is the exact seam where voice → text belongs.

**Autonomous Coworker Runtime.** `TaskRun` is the run identity for channel-originated work (fabric §14.1). `tasks/submit` is the inbound→coworker contract (fabric §14.4). Failure taxonomy is closed and runtime-owned (fabric §14.3).

**AI routing.** `apps/web/lib/inference/ai-inference.ts` (re-exported as `@/lib/ai-inference` for legacy callers) routes all model inference through OpenAI-compatible `/v1/chat/completions`. The capability-tier + dynamic-discovery posture (see `2026-03-20-adaptive-model-routing-design.md`) is the right pattern to extend to STT: providers register their STT capability on `ModelProfile` / `EndpointTaskPerformance`, and routing picks per task tier. Concrete extension story is in §6.7.

**Existing transcription execution adapter (substrate to compose, not duplicate).** `apps/web/lib/routing/transcription-adapter.ts` already implements the `EP-INF-009c` audio transcription execution adapter — POSTs multipart audio to OpenAI-compatible `/v1/audio/transcriptions`, registered in the execution adapter registry (`registerExecutionAdapter({ type: "transcription", ... })`). It is provider-agnostic and treats audio as a base64 `type:"audio"` content part on the trailing message of an `AdapterRequest`. **Slice 1's `/api/transcribe` route must compose this adapter via the registry, not introduce a parallel HTTP client and not bypass it for direct multipart POSTs.** Per [verify-substrate-before-proposing-new](../../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md), the user-facing route is a thin wrapper that builds the `AdapterRequest`, invokes the registry's `transcription`-typed handler, and projects the result. A Slice 1 architecture test (see §8 DoD) asserts this composition.

**No existing user-facing voice surface.** Grep confirmed (2026-05-16): no `MediaRecorder`, `getUserMedia`, `SpeechRecognition`, or `<audio>`-capture UI anywhere in `apps/web/components`. The `voice` identifier in the brand layer (`lib/brand/types.ts`) is brand tone-of-voice and unrelated. The `transcription-adapter.ts` mentioned above is a routing-layer primitive with no UI or user-facing route attached to it yet.

**Conclusion.** Voice input slots in as a new modality on the in-app channel and a new capability flag on inbound adapters. It does not require a new transport, a new conversation primitive, or a new identity model.

---

## 3. Decision

DPF should ship voice input in three slices, in this order:

1. **Slice 1 — Push-to-talk voice input on the in-portal AI Coworker panel.** Mic button on `AgentMessageInput`, browser `MediaRecorder` capture, server-side transcription via a self-hosted Whisper sidecar exposing the OpenAI-compatible `/v1/audio/transcriptions` API, transcript drops into the textarea for user review before send. No new Prisma tables.
2. **Slice 2 — Two-pass LLM cleanup + vocabulary biasing.** The raw transcript runs through a small-tier LLM cleanup pass (the Wispr Flow moat — punctuation, filler removal, identifier correction). Org vocabulary (wiki page titles, project names, vendor names) is injected as Whisper `initial_prompt` to bias the first 30s and as a final cleanup hint.
3. **Slice 3 — Inbound voice on the communication fabric.** Extend `CommunicationAdapter` capabilities with `transcribeInboundMedia: boolean`. WhatsApp voice notes, Teams audio messages, Slack voice clips arriving on inbound webhooks get transcribed before the fabric normalizes them into `AgentMessage` / `WorkItemMessage`. The audio is stored as delivery evidence; the transcript is the canonical record.

**Out of scope for this spec (deferred):**
- Streaming partial transcripts (Aqua Voice / Deepgram-style live UX) — defer until Slice 1 traction warrants the complexity.
- Text-to-speech output (read-aloud notifications) — symmetric concern, separate spec.
- Mobile companion mic surface — defer until the mobile companion app from `2026-03-19-mobile-companion-app-design.md` lands.
- Hot-word / wake-word activation, always-listening — explicitly never for an enterprise governance platform.

---

## 4. Research And Benchmarking

Per the [research-and-use-standards](../../founder-kernel/wiki/principles/research-and-use-standards.md) principle, design recommendations cite sources.

### 4.1 Commercial reference: Wispr Flow

Wispr Flow (https://wisprflow.ai/) is a cloud-backed OS overlay bound to a global hotkey. Hold-to-speak, release-to-paste. Whisper-derived ASR plus an LLM cleanup pass (filler removal, punctuation, app-aware style), then OS-level text injection. Distinctive vs OS dictation: the **cleanup pass is the moat**, not the ASR. Pricing $15/mo Pro. No SDK, no offline mode, no browser extension. Adopt: push-to-talk UX, two-pass cleanup pattern, app/context-aware bias prompts. Reject: cloud-only posture, OS keyboard injection (we are a web platform; the textarea is the target).

### 4.2 Open-source reference architectures

| Project | License | Why look at it |
| --- | --- | --- |
| [cjpais/Handy](https://github.com/cjpais/Handy) | MIT | The closest OSS Wispr-Flow clone. Hotkey + Silero VAD + Whisper + paste-into-active-field. Lift the **state machine** and the hotkey-release race-condition handling (flush VAD buffer + send final chunk with `eof=true` so the tail word is not lost). |
| [EpicenterHQ/epicenter](https://github.com/EpicenterHQ/epicenter) | MIT | Active fork after the original `braden-w/whispering` was archived 2026-02. Already integrates Speaches as its STT backend — independent validation of the Speaches choice. |
| [chidiwilliams/buzz](https://github.com/chidiwilliams/buzz) | MIT | Model-selection abstraction across faster-whisper / whisper.cpp / hosted. Useful reference for how the AI routing layer should expose STT provider choice. |
| [collabora/WhisperFusion](https://github.com/collabora/WhisperFusion) | MIT | Whisper + LLM round-trip. Reference for the Slice 2 cleanup-pass wiring. |

**GPL projects (do not lift code):** `savbell/whisper-writer` (GPLv3), `Beingpax/VoiceInk` (GPLv3, Mac-only). Read for UX ideas; do not import into Apache-2.0 DPF.

### 4.3 Open-source STT engines

| Engine | License | Deploy | Why |
| --- | --- | --- | --- |
| [speaches](https://github.com/speaches-ai/speaches) (formerly `fedirz/faster-whisper-server`) | MIT | Docker (CPU + CUDA) | **Recommended default.** OpenAI-compatible `/v1/audio/transcriptions`, streaming, faster-whisper + distil-whisper under the hood. Drop into `docker-compose.yml` and point an OpenAI-format client at it. |
| [whisper.cpp server](https://github.com/ggml-org/whisper.cpp) (`examples/server`) | MIT | Single C++ binary | **Edge-node fallback.** No Python, no GPU required, OpenAI-compatible endpoint. The right choice when an install runs on CPU-only edge hardware. |
| [collabora/WhisperLive](https://github.com/collabora/WhisperLive) | MIT | Docker | WebSocket streaming variant. Reserved for Slice 4 (deferred) if real-time partial transcripts become a requirement. |

**Skipped:** `m-bain/whisperX` (BSD-4 advertising clause + gated pyannote model access) — only if speaker diarization is in scope, which it is not in this spec.

### 4.4 Open-source capture libraries (browser)

| Package | License | Role |
| --- | --- | --- |
| [@huggingface/transformers](https://github.com/huggingface/transformers.js) | Apache-2.0 | Optional in-browser Whisper via WebGPU/WASM for privacy-strict orgs. Audio never leaves the device. Acceptable for short utterances. |
| [@ricky0123/vad-web](https://github.com/ricky0123/vad) | MIT | Silero VAD in browser via ONNX. End-of-utterance detection + silence trimming. |
| [xenova/whisper-web](https://github.com/xenova/whisper-web) | MIT | Working WebGPU demo we can fork for the audio-capture component (not the demo UI). |
| [openai/openai-realtime-console](https://github.com/openai/openai-realtime-console) | MIT | Reference React mic-capture component. Lift the AudioWorklet plumbing; ignore the OpenAI-specific transport. |

**Skipped:** `JamesBrill/react-speech-recognition` — wraps Chrome-only Web Speech API, ~12 months stagnant, sends audio to Google. Not aligned with self-host posture.

### 4.5 Hosted STT providers (escape hatches, routed not pinned)

| Provider | Price (cited) | Latency (cited) | When to route here |
| --- | --- | --- | --- |
| [Groq Whisper-large-v3-turbo](https://groq.com/blog/whisper-large-v3-turbo-now-available-on-groq) | $0.04/hr | 216–228× real-time | When the install has neither GPU nor enough CPU for distil-whisper |
| [Deepgram Nova-3](https://deepgram.com/learn/best-speech-to-text-apis-2026) | $0.0077/min mono | <300ms streaming | Slice 4 streaming partials (deferred) |
| [AssemblyAI Universal-Streaming](https://www.assemblyai.com/blog/introducing-universal-streaming) | $0.15/hr | P50 ~150ms | Slice 4 alternative |

> Prices and latencies above were cited from secondary research (May 2026) and have **not** been fetched directly from each vendor's pricing page. Verify against the live vendor pages before any vendor-selection decision — this table is positioning context only, not a procurement baseline.

Per [no-provider-pinning](../../founder-kernel/wiki/principles/no-provider-pinning.md), STT provider selection is dynamic via capability tier — same routing pattern as LLM selection. Customer brings their own API key; DPF is the conduit.

### 4.6 Patterns adopted

- **Push-to-talk via mic-button click or spacebar hold** is the v1 invocation. Industry default in 2026 (Claude Code voice mode, ChatGPT mobile, Wispr).
- **Silero VAD endpointer** chunks audio and detects end-of-utterance. 4× fewer errors than WebRTC VAD, 0.4% CPU real-time.
- **Two-pass transcribe-then-clean** — raw STT goes through an LLM polish step. This is Wispr's moat; we already have routed LLM access so cleanup is nearly free.
- **Bias prompt from org vocabulary** — Whisper `initial_prompt` field (224-token cap, biases first 30s) populated from wiki page titles, project names, identifiers seen in recent `AgentMessage` history.
- **Transcript is canonical, audio is evidence** — the same posture the fabric already takes for provider payloads (fabric §13.5 retention).
- **Hotkey-release race handling** (Handy, Epicenter pattern): prevent losing the tail word on release.
  - **Slice 1 (one-shot `/v1/audio/transcriptions`)**: await `MediaRecorder.onstop` and the final `dataavailable` event before assembling the request body. Do not POST on the click — POST when the recorder has actually flushed.
  - **Slice 4 (streaming, deferred)**: flush the VAD buffer and send a final chunk with `eof=true` to close the stream. Documented here so the streaming substrate inherits a known pattern, not as a Slice 1 requirement.

### 4.7 Patterns rejected

- **Always-listening / wake-word.** Privacy hostile, battery hostile, maintenance hostile, governance hostile. Not for an enterprise platform.
- **Browser Web Speech API as default.** Chrome-only; audio is silently sent to Google; ~60s silent restart bug; weak on technical vocabulary. Acceptable as an opt-in Chrome fallback for orgs that explicitly decline server-side STT, never the default.
- **A separate "voice mode" UI.** The mic button writes into the same `AgentMessageInput` users already type into. Branching the messaging surface creates two interaction models for one job.
- **Hard-coded STT provider.** Per `no-provider-pinning`, routing picks per capability tier and customer credential.
- **Audio as the canonical record.** Storage cost, retrieval cost, search cost, redaction cost — all worse than text. Text is canonical; audio is opt-in evidence.

---

## 5. User Experience

### 5.1 Portal mic button (Slice 1)

`AgentMessageInput.tsx` gains a mic button to the left of the send button. States:

- **Idle**: `Mic` icon (Lucide, already imported in the codebase). Tooltip: "Hold to speak, or click to start dictating." `aria-label="Start dictation"`.
- **Recording**: filled mic + animated waveform. Click again, release space, or hit Esc to stop. `aria-label="Stop dictation"`. Live elapsed timer.
- **Transcribing**: spinner, "Transcribing…" microcopy. Cannot send during this state. Timeout after 30s with retry option.
- **Result**: transcript text appears in the textarea, cursor at end, user reviews and presses send. Cleanup pass (Slice 2) runs between Transcribing and Result.
- **Error**: inline error chip ("Couldn't transcribe — try again" with retry button). Audio retained in memory until user retries or dismisses.

**Invocation paths:**
1. Click mic button (toggle).
2. Hold spacebar while textarea is empty + focused (Wispr-style push-to-talk).
3. (Future) Configurable global hotkey via browser keyboard shortcut API.

**Permission UX:** first invocation triggers the standard browser `getUserMedia` prompt. If denied, the mic button shows a "Microphone blocked — re-enable in browser settings" state with a tooltip linking to per-browser instructions. The browser's Permissions API surface is the source of truth; the UI re-reads it on each click rather than caching its own copy.

**Privacy indicator:** when recording, a small red dot appears in the panel header and the page `<title>` is prefixed with `🔴`. Closing or backgrounding the tab stops the recording immediately.

### 5.2 Inbound voice on external channels (Slice 3)

The user does not see this surface directly. The change is observable:

- A WhatsApp voice note from a bound employee arrives. The fabric's inbound normalizer transcribes audio to text **before** producing the canonical record. The record type follows existing fabric routing rules: a work-queue origin produces a `WorkItemMessage`, an in-portal-thread origin produces an `AgentMessage`. Voice does not introduce a new record type and does not change which record type is produced — it only ensures the `content` field is populated with transcript text rather than a placeholder.
- Either record carries the audio reference via the existing attachment / evidence pattern (`AgentAttachment` for `AgentMessage`, `CommunicationDeliveryAttempt.providerPayload` evidence for `WorkItemMessage`). UI renders the transcript with a small "🎤 transcribed from voice" affordance; clicking expands to show the source audio player and the normalized confidence score (§6.5).
- The audio is retained per fabric §13.5 retention bands. If normalized transcription confidence is below the per-provider threshold (see §6.5 and §10 Q3), the bubble shows a "Low confidence — review original" hint and the runtime path follows §7.2.

### 5.3 Admin: STT provider readiness

The Platform Tools > Communications hub (fabric §5.2) gains a **Speech-to-text** card:

- Provider readiness: "speaches sidecar (default) — healthy", "Groq STT — not configured", "Deepgram — not configured".
- Per-provider test harness ("Speak a test phrase, see the transcript").
- Toggle: which capability tier maps to which provider (small/fast → speaches; high-accuracy → Deepgram if configured).
- Org-level vocabulary bias list (auto-populated from wiki page titles + project names; admin can add/remove).

This extends the existing native-integration card pattern — not a new admin shell. The underlying state is **existing tables**, not new ones:
- Provider rows in `ModelProvider` with a `supportsTranscription: true` capability flag.
- Tier-to-provider mapping in `EndpointTaskPerformance` for `taskType="transcription"`.
- Vocabulary bias list lives on `Organization.brand` (or a sibling JSON column) — confirm during Slice 2 implementation; do not invent a new table.

### 5.4 What the coworker says

When a coworker receives a voice-originated message, it should plainly say so in audit-relevant responses:

> "I received your message as a voice note through WhatsApp (transcript confidence 0.92). Acting on it now."

Never silently use a low-confidence transcript without surfacing the uncertainty.

---

## 6. Architecture

### 6.0 STT engine vs LLM — what depends on what

A common source of confusion: Whisper is a transformer with ~1.5B parameters but it is **not** a chat LLM. It is a sequence-to-sequence **speech recognition model**. It maps audio frames to text tokens. It does not reason, does not follow instructions, does not need a system prompt. It is the same architectural class as Google's Conformer or Meta's Seamless — an ASR model.

This matters for the deployment story:

| Component | What it is | LLM dependency? |
| --- | --- | --- |
| **Whisper / faster-whisper / distil-whisper** (the ASR) | Audio-to-text transformer, OpenAI-trained | **No.** Runs standalone. The speaches sidecar wraps it; no chat model involved. |
| **Slice 1 `/api/transcribe`** | HTTP wrapper around the ASR | **No.** Audio in, text out. |
| **Slice 2 cleanup pass** | Single small-tier chat-LLM call: "fix punctuation, remove filler, return text only" | **Yes** — but small-tier (gpt-4o-mini, haiku, or whatever the org wires into the small/fast capability tier). One call per dictation, ~200ms, fractions of a cent. |
| **Slice 2 vocabulary bias** | Whisper `initial_prompt` populated from org wiki / project names | **No.** Bias text is a Whisper input parameter; the ASR consumes it directly. |
| **Slice 3 inbound voice on fabric** | Reuses Slice 1's `/api/transcribe`; per-channel toggle for whether to run cleanup | **Optional.** Org can disable cleanup per-channel. Pure-ASR path always works. |

**Implication for air-gapped or LLM-skeptical installs.** An organization that disables Slice 2 (or never enables it) gets a fully functional voice path — Slice 1 portal mic and Slice 3 inbound voice both work without any chat-LLM call at all. The cleanup pass is a quality lift, not a requirement. This is intentional: it preserves the open-source self-host posture for installs that cannot or will not call out to a chat model.

**Implication for routing.** Per §6.7, the STT capability is declared on `ModelProfile` separately from chat capability. A provider can offer ASR without chat, or chat without ASR. Routing picks the right primitive per task type — no provider pinning, no implicit coupling.

### 6.1 Components

```
┌──────────────────────────────┐         ┌─────────────────────────────┐
│ Browser (portal)             │         │ Inbound channel adapter     │
│  AgentMessageInput + Mic     │         │  (WhatsApp / Teams / etc.)  │
│  MediaRecorder + VAD-web     │         │  fabric §6.4 normalization  │
└──────────────┬───────────────┘         └────────────┬────────────────┘
               │ audio/webm                            │ audio/* attachment
               ▼                                       ▼
       ┌──────────────────────────────────────────────────────────────┐
       │  POST /api/transcribe   (Next.js route in apps/web)          │
       │   - validates request                                        │
       │   - resolves STT provider via AI routing (capability tier)   │
       │   - injects org bias prompt                                  │
       │   - proxies multipart to selected provider                   │
       │   - returns { text, confidence, provider, durationMs }       │
       └──────────────────────────┬───────────────────────────────────┘
                                  │ OpenAI-compatible /v1/audio/transcriptions
                                  ▼
                  ┌──────────────────────────────────────┐
                  │  Default: speaches sidecar           │
                  │  Edge fallback: whisper.cpp server   │
                  │  Routed escape: Groq / Deepgram      │
                  └──────────────────────────────────────┘
```

### 6.2 New surface area

| Element | Location | Slice |
| --- | --- | --- |
| Mic button + recording state | `apps/web/components/agent/AgentMessageInput.tsx` | 1 |
| `MediaRecorder` + VAD capture hook | `apps/web/components/agent/hooks/useVoiceCapture.ts` (new) | 1 |
| `POST /api/transcribe` route | `apps/web/app/api/transcribe/route.ts` (new) | 1 |
| STT call site (composes existing `lib/routing/transcription-adapter.ts`) | `apps/web/lib/voice/transcribe.ts` (new — thin wrapper that builds `AdapterRequest` + invokes execution adapter registry) | 1 |
| Cleanup-pass utility | `apps/web/lib/ai-inference/transcript-cleanup.ts` (new) | 2 |
| Org vocabulary bias builder | `apps/web/lib/ai-inference/vocabulary-bias.ts` (new) | 2 |
| `CommunicationAdapter.capabilities.transcribeInboundMedia` flag | `apps/web/lib/communications/channel-types.ts` (extend existing interface) | 3 |
| Inbound-media transcription wiring | **extend** the existing fabric inbound-normalization seam (fabric §6.4) — name and location to be confirmed against the WhatsApp-adapter PR that lands fabric Slice 3 inbound. Voice must not introduce a parallel normalizer. | 3 |
| Audio evidence storage | reuse `CommunicationDeliveryAttempt` / existing attachment evidence pattern (fabric §6.3). Binary lives wherever `AgentAttachment.storageKey` and `CommunicationDeliveryAttempt` evidence already store blobs — point at the existing storage doctrine, do not invent a voice-specific store. Open question if doctrine is silent: §10 Q8. | 3 |
| STT sidecar | `docker-compose.yml` — new `dpf-stt` service (single service, image swapped by deployment target — see §6.6) | 1 |

### 6.3 Capability extension to `CommunicationAdapter`

```typescript
// apps/web/lib/communications/channel-types.ts — extend existing interface
export interface CommunicationAdapter {
  key: string;
  channel: CommunicationChannel;
  capabilities: {
    outbound: boolean;
    inbound: boolean;
    interactive: boolean;
    deliveryReceipts: boolean;
    readReceipts: boolean;
    templatesRequired: boolean;
    transcribeInboundMedia?: boolean;  // NEW (Slice 3) — OPTIONAL; default false at read sites to avoid breaking existing adapters
  };
  send(input: SendCommunicationInput): Promise<CommunicationDeliveryResult>;
  // Slice 3 — only when capabilities.transcribeInboundMedia is true:
  fetchInboundMedia?(providerMediaId: string): Promise<InboundMediaPayload>;
}

export interface InboundMediaPayload {
  mediaType: "audio" | "video";
  mimeType: string;            // e.g. "audio/ogg; codecs=opus" for WhatsApp voice notes
  durationSeconds?: number;
  bytes: Buffer;
}
```

The inbound normalizer (`apps/web/lib/communications/inbound-normalizer.ts`) checks `capabilities.transcribeInboundMedia` and, if true and the inbound payload carries audio, calls `fetchInboundMedia()` → `POST /api/transcribe` → produces the canonical text `AgentMessage` / `WorkItemMessage` with a reference to the stored audio evidence.

### 6.4 Data model

No new Prisma tables for Slices 1–3. Voice integrates by reusing:

- `AgentMessage.content` — the transcript (with cleanup applied) is the message body.
- `AgentMessage.attachments` — the **typed `AgentAttachment[]` relation** (`packages/db/prisma/schema.prisma:3398`), not a JSON column. Voice attachments ride on the existing `AgentAttachment` row: `mimeType="audio/webm"` (or `audio/ogg` from WhatsApp), `storageKey` pointing at the stored blob, and voice-specific metadata `{ audioBlobId, durationMs, normalizedConfidence, providerConfidenceRaw, transcribedBy, providerModel, rawTranscript? }` lives in the existing `parsedContent Json?` column under a `voice` namespace (`parsedContent.voice = {...}`). The namespace keeps `parsedContent`'s original "parsed file content" purpose intact and avoids ambiguous overload at the row level.
- `rawTranscript` is the pre-cleanup text, preserved only when `normalizedConfidence < LOW_CONFIDENCE_THRESHOLD` (default 0.85 after normalization; see §6.5 and §10 Q3) so audit can compare raw vs cleaned without retaining full transcripts for every message.
- `CommunicationDeliveryAttempt` (fabric §6.3) — inbound audio evidence rides on the existing delivery-attempt evidence row; we add `mediaTranscriptId` only if we later need a typed link, which we do not in Slice 3.

**Schema decision (open):** if downstream code begins fanning out `parsedContent.voice` reads across many call sites, promote to a typed `AgentAttachment.voiceMetadata Json?` column in a Slice 2+ migration. Decision deferred — Slice 1 namespaces within `parsedContent` to ship without a migration. See §10 Q9.

This deliberately avoids inventing a new `VoiceMessage` or `Transcript` table. If usage proves we need typed transcript records (separate retention, separate search), Slice 4+ can add them. Per [verify-substrate-before-proposing-new](../../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md), existing primitives stretch this far.

### 6.5 Transcription request shape

```http
POST /api/transcribe
Content-Type: multipart/form-data

audio:           (binary, audio/webm or audio/ogg)
context:         "coworker_panel" | "inbound_channel" | "test_harness"
threadId?:       string                       // for portal use; populates bias context
channelBindingId?: string                     // for inbound use
language?:       string (ISO-639-1, optional, default auto-detect)
tierHint?:       "small" | "high-accuracy"    // ADVISORY only — the canonical contract is taskType="transcription" + capability tier resolved by the routing layer. tierHint biases tie-breaks; it does not pin a provider.
```

Response:

```json
{
  "text": "Schedule the design review with Daisy for Friday.",
  "rawText": "schedule the design review with daisy for friday",
  "confidence": 0.94,
  "confidenceSource": "normalized",
  "language": "en",
  "durationMs": 3120,
  "provider": "speaches",
  "model": "distil-whisper-large-v3",
  "biasUsed": true,
  "biasRedacted": false
}
```

**Confidence normalization.** Whisper-family engines do not return a single 0-1 confidence — they return per-segment `avg_logprob` and `no_speech_prob`. Hosted providers each return a different shape. The route normalizes to a single 0-1 float using this formula, computed in the route handler (not in the execution adapter):

| Provider family | Normalized formula |
| --- | --- |
| Whisper / faster-whisper / speaches / whisper.cpp / Groq Whisper | `clamp(exp(mean(segment.avg_logprob)), 0, 1)` over all returned segments; if no segments, fall back to `1 - no_speech_prob` |
| Deepgram Nova-3 | `channels[0].alternatives[0].confidence` (already 0-1) |
| AssemblyAI | `confidence` (already 0-1) |

`confidenceSource` in the response declares which formula ran (`"normalized"` for Whisper-family math, `"native"` for providers that emit 0-1 directly, `"unavailable"` if neither). Downstream thresholds (§7.2, §10 Q3) operate on the normalized value, not provider-specific raw values.

**Telemetry.** The route writes a per-call event with `{ provider, model, durationMs, audioMs, normalizedConfidence, confidenceSource, biasUsed, biasRedacted, tier, success, errorCode? }` to the **existing** inference telemetry table — Slice 1 implementer to confirm whether that is `RouteDecisionLog`, `AsyncInferenceOp` (sync use-case extension), or `EndpointTaskPerformance`. **Pick one of those; do not introduce a new table.** Open question in §10 Q10.

### 6.6 Docker compose

```yaml
# docker-compose.yml — additive. ONE service. Image is swapped at install-time, not duplicated.
services:
  dpf-stt:
    image: ${DPF_STT_IMAGE:-hwdsl2/whisper-server@sha256:<pinned-digest>}
    # GPU installs override DPF_STT_IMAGE to a CUDA-capable whisper-server variant.
    environment:
      WHISPER_MODEL: "${DPF_STT_MODEL:-base}"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:9000/v1/models"]
    ports:
      - "127.0.0.1:8765:9000"                          # localhost-only by default
```

The provider registry seeds `speaches` as the local STT provider with `baseUrl='http://dpf-stt:9000'`, matching the hwdsl2/whisper-server internal port. The route still speaks the OpenAI-compatible `/v1/audio/transcriptions` contract; the contract is the endpoint, not the image. Per the [edge-node](2026-05-09-dpf-edge-node-design.md) doctrine, the same compose entry serves every deployment target — only the image and model env vars differ.

### 6.7 Routing layer extension for STT capability

The Slice 1 contract — `/api/transcribe` calls the routing layer with `taskType="transcription"` — requires the routing layer to know which providers and endpoints can serve transcription. Concrete steps (Slice 1 prerequisite, not deferred):

1. **`ModelProfile` extension.** Add a transcription capability flag (or surface via existing `capabilities Json`) for any model that exposes `/v1/audio/transcriptions`. Auto-discovery for speaches: probe `/v1/models` and mark any model whose ID matches `*whisper*` as transcription-capable.
2. **Endpoint registration.** A new `ModelProvider` row for `speaches` (and one per hosted STT provider the admin connects) with `baseUrl=STT_BASE_URL`. Per [no-provider-pinning](../../founder-kernel/wiki/principles/no-provider-pinning.md), provider selection at call time is dynamic by capability tier.
3. **Tier mapping.** `EndpointTaskPerformance` rows for `taskType="transcription"`, scoring each registered endpoint. Default tier mapping at first-install: speaches → `small`; if Groq/Deepgram are configured by admin, they slot into `high-accuracy` and `streaming` (deferred) tiers respectively.
4. **Bias prompt classification gate.** The routing layer's pre-dispatch hook receives the bias prompt and, if the resolved endpoint is **off-org** (any hosted provider), strips the bias to the org-vocabulary subset that has been classified `public` or `internal-low` — never `confidential`. Implemented as a single function in `lib/routing/`; called from both the chat and transcription paths.

These changes are concrete enough to implement in Slice 1; they avoid a new "STT routing" subsystem and reuse the same primitives that route chat-completions today.

---

## 7. Integration Contracts

### 7.1 Comm fabric §14 — runtime integration unchanged

Voice does not alter the §14.1–14.4 contracts. Inbound voice notes still escalate via `tasks/submit`; the transcript is what the runtime sees. `TaskRun` parenting, step-up flows, failure taxonomy, and `Principal` resolution are identical to text-inbound.

### 7.2 Failure taxonomy mapping (extends fabric §14.3)

| Voice failure | Runtime `exceptionClass` | Disposition |
| --- | --- | --- |
| STT provider unreachable / timeout | `tool-error` | Retry per AI-routing policy; if exhausted, surface "Couldn't transcribe — try again" to user (Slice 1) or quarantine the message + alert operator (Slice 3). |
| Normalized transcript confidence below per-provider threshold (§6.5, §10 Q3) | `missing-data` | Slice 3: do NOT auto-feed to coworker. Move escalated run to `input-required` ("I received a voice note but I'm not confident in the transcript. Please confirm or retype."). Slice 1: still drop into textarea but flag the low-confidence section. |
| Audio fails server-side validation (corrupt, > max duration, non-audio MIME) | `tool-denied` | Reject at `/api/transcribe`. No retry. |
| Bias prompt triggers leakage suspicion | `prompt-injection-suspected` | Slice 2: cleanup pass detects injection-shaped artifacts → strip + warn. |
| User revokes mic permission mid-record | (local UI only) | No `TaskRun`, no audit. Record the recording is discarded. |

### 7.3 Browser compatibility

The portal mic surface targets every modern evergreen browser. No browser is excluded, but the **server-side path is the universal one** — the in-browser WebGPU Whisper opt-in (§7.3, last bullet) is Chrome/Edge-first.

| Capability | Chrome / Edge | Firefox | Safari | Implementation note |
| --- | --- | --- | --- | --- |
| `getUserMedia` (mic access prompt) | ✓ | ✓ | ✓ | Requires HTTPS or `localhost`. Standard since 2017. |
| `MediaRecorder` (audio capture) | ✓ | ✓ | ✓ (14.1+) | Universal in 2026. |
| `audio/webm; codecs=opus` output | ✓ | ✓ | ✗ | **Safari emits `audio/mp4` (AAC) instead — see "Safari interop" below.** |
| `@ricky0123/vad-web` (Silero VAD via ONNX/WASM) | ✓ | ✓ | ✓ | Standard WASM, no exotic deps. |
| Page Visibility API (auto-stop on background) | ✓ | ✓ | ✓ | Used by §5.1 privacy indicator. |
| WebGPU (privacy-strict in-browser Whisper opt-in) | ✓ 113+ | flag in 2026 | partial 18+ | Opt-in path is **not** universal yet; Safari/Firefox users in privacy-strict mode either wait or fall back to server-side. |
| Web Speech API (rejected fallback) | ✓ | ✗ | partial | Cloud-only, Chrome-Google. Explicitly not in scope (§4.7). |

**Safari interop (required client behaviour).** `MediaRecorder` is universal, but the **output container differs by browser** — Chrome/Firefox produce `audio/webm; codecs=opus`, Safari produces `audio/mp4` (AAC). The client must **not hard-code a MIME type**; the `useVoiceCapture` hook (§6.2) must probe `MediaRecorder.isTypeSupported()` in priority order and select the first supported value:

```typescript
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",                // Safari path
  "",                          // browser default
];
const mimeType = PREFERRED_MIME_TYPES.find(
  (m) => m === "" || MediaRecorder.isTypeSupported(m),
);
```

Server side is unaffected — Whisper (via the FFmpeg shim in speaches and whisper.cpp) accepts virtually any audio container, so `/api/transcribe` does not care which format the browser sent. The Slice 1 architecture test asserts a Safari-shape multipart upload (mp4/AAC) round-trips correctly.

**Minimum supported browsers (2026 baseline).** Chrome / Edge 113+, Firefox 121+, Safari 16.4+. Older versions degrade gracefully — the mic button is hidden via feature detection if `navigator.mediaDevices?.getUserMedia` or `window.MediaRecorder` is missing, and the textarea remains fully usable.

### 7.4 Privacy & consent boundary

- Audio is recorded only while the mic button is active and the page is visible. Backgrounding the tab or navigating away stops recording immediately and discards the buffer.
- Audio is sent to `/api/transcribe`, which **always** routes to a provider configured by the org admin. Default = self-hosted sidecar. Audio is **not** posted to a third party unless the admin has configured a hosted provider and that provider is currently selected for the relevant capability tier.
- **Bias-prompt data classification boundary.** Org vocabulary bias (wiki titles, project names, identifiers from `AgentMessage` history) is the spec's biggest cross-provider data-leak risk: when routing escapes to Groq or Deepgram, the `initial_prompt` field carries org content to that provider. Enforced in §6.7 step 4: the routing layer strips bias to the public/internal-low subset before any off-org dispatch. Confidential identifiers, customer PII, and unclassified strings are never included in bias prompts that leave the install. The response `biasRedacted: true` makes the boundary visible to UI and audit.
- Per [obfuscated-not-anonymous](../../founder-kernel/wiki/principles/obfuscated-not-anonymous.md), inbound voice from external channels carries the originating principal binding — voice does not anonymize the sender.
- Voice introduces no new principal-resolution path: the in-portal mic inherits the current session principal; inbound voice inherits the channel binding's resolved principal — the same path text-inbound takes today.
- The org may opt into **browser-only WebGPU transcription** (`@huggingface/transformers` with Whisper-tiny). In this mode `/api/transcribe` is bypassed; audio never leaves the device. Trade-off: lower accuracy, no inbound-channel voice support.

---

## 8. Implementation Slices

### Slice 1 — Portal push-to-talk (2026-Q2)

**Definition of done:**
- `useVoiceCapture` hook captures audio via `MediaRecorder` + `@ricky0123/vad-web` for endpointing.
- Mic button on `AgentMessageInput` with the state machine in §5.1.
- `POST /api/transcribe` route composes the existing `transcription` execution adapter via `executionAdapterRegistry` — does **not** construct multipart bodies directly and does **not** import `transcription-adapter.ts` internals.
- **Architecture test** asserts the route handler resolves through the registry: e.g., the test substitutes a fake adapter at registry level and verifies the route's response shape matches the adapter's `AdapterResult` projection. Without this, future refactors will silently regress to a parallel HTTP client.
- §6.7 routing-layer wiring landed: a `ModelProvider` row for the speaches sidecar, transcription-capable `ModelProfile`, `EndpointTaskPerformance` for `taskType="transcription"`, and the bias-classification gate function. Seeded via the install seed script (per [fix-the-seed-not-the-runtime](../../professions/data-architect/wiki/fix-the-seed-not-the-runtime.md)).
- `docker-compose.yml` adds `dpf-stt` service under `stt` profile; default `compose up` does not run it (opt-in until graduated). Single service entry; image switched by `DPF_STT_IMAGE` env var.
- Confidence normalization (§6.5) implemented in the route, with unit tests for each provider-family formula.
- Telemetry written to the **already-chosen** inference-telemetry table (§10 Q10 resolved before code lands).
- Vitest coverage for the hook + the route's provider-routing branch + confidence normalization; Playwright spec exercising the mic button end-to-end against a stubbed transcribe endpoint.
- Admin > Platform Tools > Communications shows the new "Speech-to-text" card (provider readiness + test phrase harness), backed by the existing `ModelProvider` / `EndpointTaskPerformance` rows.

**Verification (per [build-gate-mandatory](../../founder-kernel/wiki/principles/build-gate-mandatory.md)):**
- `pnpm --filter web exec vitest run components/agent/hooks app/api/transcribe lib/ai-inference/stt`
- `pnpm --filter web typecheck` + `pnpm --filter web build`
- Browser exercise: record three phrases including a technical term, verify transcript lands in textarea, verify send through SSE flow still works.
- `docker compose --profile stt up` succeeds locally on the developer machine.

### Slice 2 — Two-pass cleanup + vocabulary bias (2026-Q2/Q3)

**Definition of done:**
- `transcript-cleanup.ts` prompt + LLM call (small-tier capability), routed through existing AI routing.
- `vocabulary-bias.ts` builds the `initial_prompt` for the STT call from: org wiki page titles (last N), `Organization.name` and brand voice terms, recent `AgentMessage.content` identifiers seen in the active thread.
- `/api/transcribe` accepts `tierHint` and applies the bias before sending to STT.
- Cleanup pass detects and strips obvious prompt-injection-shaped artifacts; suspicious cleanups emit a `prompt-injection-suspected` audit entry.
- A/B telemetry: log raw vs cleaned word-error-rate proxy (heuristic) to compare quality lift.

### Slice 3 — Inbound voice on the communication fabric (2026-Q3, blocked by fabric Slice 3)

**Hard dependency.** Per fabric §13.1 (resolved decision) the inbound-adapter rollout order is **Teams first, Slack second, WhatsApp later**. Slice 3 of voice cannot land before WhatsApp inbound from the fabric lands. Either:
- **Re-order to Teams audio messages first** (matches fabric Slice 2 order), if Teams audio carries enough usage to be worth shipping first; or
- **Wait for WhatsApp inbound** to land per fabric Slice 3 and ship voice immediately after.

The Chief Architect should pick before Slice 3 starts. Default recommendation: wait for WhatsApp — the voice-note pattern is far more common on WhatsApp than Teams in field workflows, and the WhatsApp adapter's `fetchInboundMedia` is closer to the natural seam than Teams' message-attachment-blob model.

**Definition of done (assuming WhatsApp-first):**
- `CommunicationAdapter.capabilities.transcribeInboundMedia` field added; `in-app-adapter.ts` defaults it to false; first adapter that flips it true is **WhatsApp Business**.
- `fetchInboundMedia()` impl on the WhatsApp adapter (Meta Cloud API media-download flow).
- The fabric's existing inbound normalizer (per fabric §6.4) calls `/api/transcribe` with `context:"inbound_channel"` + `channelBindingId`; produces the canonical record type the fabric already chose for that channel (`WorkItemMessage` for work-queue origin, `AgentMessage` for in-portal binding); stores audio reference on the existing attachment / evidence row.
- Low-confidence path: per §7.2, escalates via the runtime's `input-required` status. Coworker response template (§5.4) lands in `prompts/voice/inbound-low-confidence.prompt.md`.
- Verification: simulated Meta webhook (test fixture) for an audio message → asserts canonical record type + populated transcript text + linked audio evidence + correct confidence handling at both ≥ and < threshold. Also asserts the **bias-redaction path** when the active provider is off-org.

### Slice 4 — DEFERRED — Streaming partials, mobile mic, TTS

Not in this spec. Captured in §13 open questions for future planning.

---

## 9. Telemetry & Evidence

- Every `/api/transcribe` call writes to existing inference telemetry: `{ provider, model, durationMs, audioMs, confidence, biasUsed, tier, success, errorCode? }`. No new telemetry table.
- Audio retention follows fabric §13.5 retention bands: 90 days for normal traffic, indefinite when linked to a `runtime-defect` exception.
- Inbound audio is stored with the same redaction posture as other provider payloads (fabric §13.2).
- The cleanup pass logs `rawText` only when it materially differs from cleaned (Levenshtein > threshold), to support quality regression detection without bloating logs.

---

## 10. Open Questions

1. **Spacebar push-to-talk vs explicit toggle as the default?** Wispr defaults to a global hotkey. Inside a textarea, spacebar conflicts with typing. Recommendation: spacebar only when the textarea is empty and focused; otherwise the mic button is click-toggle. Validate in the Slice 1 UX exercise.
2. **Browser-only WebGPU as opt-in: per-org or per-user?** Per-org is simpler governance and matches the deployment-as-policy posture. Per-user respects individual privacy preference. Recommendation: per-org default, per-user override allowed if the org enables it.
3. **Confidence threshold per provider family.** 0.85 is the starting point for **normalized** confidence per the §6.5 formulas. The Whisper-family `exp(mean(avg_logprob))` distribution skews lower than Deepgram's calibrated `confidence`; same threshold across providers will misfire. Track per-provider distribution telemetry from Slice 1 day 1; tune thresholds per `confidenceSource` value once N ≥ 1000 traces exist. Until then: 0.85 for native, 0.80 for normalized-Whisper.
4. **Should the cleanup pass run for inbound-channel voice as well as portal voice?** Yes, for consistency; but the bias prompt must be channel-aware: an inbound WhatsApp voice from an external customer uses the *channel-binding's* context and is data-class-filtered (§6.7 step 4), not the *operator's* recent thread.
5. **Edge-node story.** Edge installs are CPU-only. distil-whisper-small via whisper.cpp on CPU is ~real-time for short utterances but not for 30s+ clips. Confirm in an edge-lab Slice 1 verification run; if unacceptable, edge installs route to Groq (hosted) by default with a UI badge surfacing the data-egress choice.
6. **Streaming partials in Slice 4 — Deepgram Nova-3 vs collabora/WhisperLive sidecar.** Deferred. Both are MIT-friendly; Deepgram has lower latency but is hosted.
7. **Mobile companion mic surface.** Per `2026-03-19-mobile-companion-app-design.md`, the mobile app is the future "always have the mic on you" surface. Mobile mic + push-to-talk → same `/api/transcribe` endpoint is the obvious extension; defer until that spec lands its own Slice 1.
8. **Audio blob storage backend.** `AgentAttachment.storageKey` is opaque — what storage does it index today (local FS volume, S3-compatible, `DocumentBlob`)? Voice should ride that doctrine, not invent a parallel one. Verify against current `AgentAttachment` write paths before Slice 1 implementation begins; if the doctrine is silent for binary attachments, the deployment-contracts spec needs the addition first, not this spec.
9. **`parsedContent.voice` namespace vs typed `voiceMetadata` column.** §6.4 ships Slice 1 inside `parsedContent.voice` to avoid a migration. Promote to a typed column if call-site fan-out exceeds five sites or if any indexed query needs `voiceMetadata.normalizedConfidence`. Revisit at Slice 2 close.
10. **Inference telemetry table.** §6.5 says "existing inference telemetry path" but DPF currently has three plausible candidates: `RouteDecisionLog`, `AsyncInferenceOp` (extend for sync), `EndpointTaskPerformance`. Pick one before Slice 1 code lands. Recommendation: `EndpointTaskPerformance` for per-endpoint quality scoring (drives the routing decision the next call will make), plus a lightweight `RouteDecisionLog` row for audit. Confirm with the AI-routing owner.
11. **First inbound channel for Slice 3.** Voice on WhatsApp depends on the fabric's WhatsApp Slice 3. Voice on Teams audio messages could ship sooner against fabric Slice 2. Architect decision required before Slice 3 starts (see §8 Slice 3 framing).

---

## 11. Recommendation

Proceed with Slice 1 as the first implementation slice **after the four prerequisites below are resolved**. Slice 1 is a contained, self-hostable, opt-in (`docker compose --profile stt`) addition that:

- Reuses every existing transport (SSE, `/api/agent/send`, `AgentMessage`).
- Adds one new route (`/api/transcribe`), one new component hook, one new sidecar service.
- Has zero Prisma surface area — no migrations.
- Carries no new identity, no new authority resolution, no new failure class.
- Composes the existing `transcription` execution adapter (not a parallel HTTP client).
- Establishes the routing seam for Slices 2 and 3 to extend without rework.

**Prerequisites to resolve before Slice 1 code lands** (each is a §10 open question — resolved into a decision, not a guess):

1. **Q8 — Audio blob storage backend.** Confirm what `AgentAttachment.storageKey` indexes today; commit voice to that doctrine.
2. **Q10 — Inference telemetry table.** Pick one of `EndpointTaskPerformance` / `RouteDecisionLog` / `AsyncInferenceOp` with the AI-routing owner.
3. **Substrate ratification.** Confirm **speaches as the default sidecar, whisper.cpp server as the edge image, hosted providers as routing escape hatches**. Single compose entry, image switched by `DPF_STT_IMAGE`. Alternatives can replace the sidecar without disturbing the `/api/transcribe` contract.
4. **Backlog parent.** Confirm `EP-INT-2E7C1A` (or its successor) is the correct parent epic against live DB state per `list_backlog_items`.

After Slice 1 lands, Slice 2 (cleanup + bias) is the highest-leverage next step — it closes the gap with Wispr Flow's perceived quality moat using infrastructure (routed LLM access) we already own. Slice 3 (inbound voice on the fabric) follows once the chosen inbound channel (§10 Q11) is fabric-ready.
