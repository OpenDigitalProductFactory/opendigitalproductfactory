# Voice Input Slice 1 — Portal Push-to-Talk Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship push-to-talk dictation on the AI Coworker panel — mic button on `AgentMessageInput`, browser `MediaRecorder` capture with Silero VAD endpointing, transcription via a self-hosted speaches sidecar composed through the existing `EP-INF-009c` execution adapter, transcript dropped into the textarea for the user to review and send.

**Architecture:** A new `/api/transcribe` route in `apps/web/app/api/transcribe/` builds an `AdapterRequest` and invokes the routing layer (`callProvider`) with `executionAdapter:"transcription"`; the routing layer dispatches to the existing `transcription-adapter.ts` (registered via `registerExecutionAdapter`); the adapter POSTs multipart audio to the speaches sidecar's OpenAI-compatible `/v1/audio/transcriptions`. No new Prisma migrations — voice attachments ride on the existing `AgentAttachment.parsedContent` JSON column. No LLM dependency in Slice 1 (per spec §6.0). One new optional sidecar in `docker-compose.yml` under the `stt` profile; default `compose up` is unaffected.

**Tech Stack:** Next.js 16 App Router in `apps/web`, TypeScript, Prisma 7, Vitest, Docker Compose, `@ricky0123/vad-web` (new dependency), speaches Docker image, existing routing-layer primitives (`callProvider`, execution-adapter registry, `ModelProvider`/`ModelProfile`/`EndpointTaskPerformance`).

**Owning spec:** [`docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md`](../specs/2026-05-16-voice-input-and-transcription-design.md) (merged via PR #668).

**Parent epic:** `EP-INT-2E7C1A` — confirmed against live state on 2026-05-16. Backlog child item to be filed during Task 0.

---

## Pre-Implementation Gate (binding before Task 1)

The owning spec §11 lists four prerequisites that are **open architectural decisions**, not coding tasks. Each must be resolved into a written decision before Task 1 starts. Record the decision, the date, and the signer inline below.

### Prerequisite 1 — Audio blob storage backend (spec §10 Q8)

`AgentAttachment.storageKey` is opaque. Voice must ride the same storage doctrine the existing `AgentAttachment` write paths already use; this slice must not invent a parallel store.

- [ ] **Action.** Inspect every existing write path to `AgentAttachment.storageKey` (`grep -rn "storageKey" apps/web/lib`). Confirm what the value indexes today (local FS volume, S3-compatible object store, `DocumentBlob` row, etc.). Confirm where the binary actually lands at portal-init / runtime.
- [ ] **Decision.** Voice attachments use the **same** backend as documented in the storage doctrine. If the doctrine is silent or contradictory for binary attachments, **halt this plan and escalate to the Chief Architect**; do not pick a backend yourself. The gate stays open until a decision is recorded.
- [ ] **Recorded:** `Decision: ____________________  Date: __________  Signer: __________`

### Prerequisite 2 — Inference telemetry table (spec §10 Q10)

Three plausible candidates exist (`RouteDecisionLog` at `packages/db/prisma/schema.prisma:5684`, `AsyncInferenceOp` at `:6191`, `EndpointTaskPerformance` at `:1447`). Pick one with the AI-routing owner — do not invent a new table.

- [ ] **Recommendation.** Per spec §10 Q10: `EndpointTaskPerformance` for per-endpoint quality scoring (drives the next routing decision) **plus** a lightweight `RouteDecisionLog` row for audit.
- [ ] **Action.** Confirm with AI-routing owner whether the recommendation stands or a single table is preferred.
- [ ] **Recorded:** `Decision: ____________________  Date: __________  Signer: __________`

### Prerequisite 3 — Substrate ratification (spec §11.3)

Default sidecar **speaches** (MIT, OpenAI-compatible), edge image **whisper.cpp server** (MIT, OpenAI-compatible), hosted providers (**Groq Whisper-turbo**, **Deepgram Nova-3**) as routing escape hatches. One compose entry, image switched by `DPF_STT_IMAGE`.

- [ ] **Action.** Chief Architect confirms or substitutes.
- [ ] **Recorded:** `Decision: ____________________  Date: __________  Signer: __________`

### Prerequisite 4 — Backlog parent (spec §11.4)

`EP-INT-2E7C1A` confirmed against live state via `dpf.list_epics` on 2026-05-16 (status `open`, 19 items: 15 open + 4 done).

- [ ] **Action.** Re-run `dpf.list_epics` on the day Task 0 begins. If the epic is still appropriate, proceed; if work has moved under a new epic, retarget.
- [ ] **Recorded:** `Confirmed against live state on: __________  Signer: __________`

### Prerequisite 5 — Playwright substrate (substrate-driven, not in spec)

**Substrate finding (2026-05-16):** the spec §8 Slice 1 DoD lists "Playwright spec exercising the mic button end-to-end against a stubbed transcribe endpoint", but Playwright config and an `e2e/` directory **do not exist on `main`** today. They exist on several open worktree branches (`edge-schema`, `edge-tests`, `pr-492`, `worktree-hygiene`, `a2a-coworker-team-orchestration`) but have not landed. Only `@axe-core/playwright` is a transitive dep, used for accessibility tests, not for app-level e2e.

This is a real gap between spec DoD and substrate. Three resolution paths — pick one and record:

- **Path A (preferred):** wait for one of the in-flight Playwright-config PRs to merge to `main`, then add `apps/web/e2e/voice-mic.spec.ts` as a small follow-up task within Chunk 3. Slice 1 ships with Vitest+Testing-Library integration tests (Task 8/9/10) covering the same surface; the Playwright spec lands within the same release window.
- **Path B (in-slice):** Slice 1 also lands the minimal Playwright config (`playwright.config.ts`, `e2e/` dir, CI job hook). Adds ~1 day of scope; risks colliding with whichever in-flight Playwright PR merges first.
- **Path C (defer):** explicitly defer the Playwright DoD bullet to Slice 2 with a written waiver; Slice 1 ships with Vitest+Testing-Library coverage of the mic→textarea round-trip as the de facto e2e proof.

The Chief Architect picks before Chunk 3 starts. Default recommendation: **Path A** — Vitest+TL covers the same surface for Slice 1 shipping; the Playwright follow-up lands as a 1-task PR once the substrate exists.

- [ ] **Recorded:** `Path: ____  Decision: ____________________  Date: __________  Signer: __________`

---

## Reality Check (binding context for implementers)

This slice's `/api/transcribe` route is **a thin wrapper around an already-existing adapter**, not a new transcription subsystem.

- The `transcription` execution adapter is already implemented at [`apps/web/lib/routing/transcription-adapter.ts`](../../../apps/web/lib/routing/transcription-adapter.ts) and self-registers on import via `registerExecutionAdapter({ type: "transcription", ... })`. It POSTs multipart audio to OpenAI-compatible `/v1/audio/transcriptions` and returns an `AdapterResult` with `text`, `inferenceMs`, and `raw` (the full provider response).
- The route handler **must not** construct multipart bodies, **must not** import the adapter's internals, and **must not** call the speaches sidecar directly. It **must** route through `callProvider` (`apps/web/lib/inference/ai-inference.ts:334`) so that provider selection, baseUrl resolution, auth headers, telemetry, and Prometheus metrics all flow through the canonical path.
- Task 7 below is the **architecture test** that asserts this composition. Without it, future refactors will silently regress to a parallel HTTP client.

This slice introduces **zero** Prisma migrations. Voice attachments ride on the existing `AgentAttachment.parsedContent Json?` column (`packages/db/prisma/schema.prisma:3505`) under a `voice` namespace (`parsedContent.voice = { ... }`), per spec §6.4. If a typed `voiceMetadata` column proves necessary later, Slice 2+ adds the migration.

This slice has **no LLM dependency** (spec §6.0). The cleanup pass is Slice 2. An install that disables Slice 2 still has a working voice path through this slice.

---

## Scope Check

The approved spec covers three slices plus deferred items. This plan covers **only Slice 1**:

- ✓ Portal mic button + `MediaRecorder` capture + Silero VAD endpointing.
- ✓ `/api/transcribe` route composing the existing `transcription` execution adapter.
- ✓ Speaches sidecar in `docker-compose.yml` under opt-in `stt` profile.
- ✓ `ModelProvider`/`ModelProfile`/`EndpointTaskPerformance` seed for the speaches sidecar (per spec §6.7).
- ✓ Bias-prompt classification gate function (per spec §6.7 step 4) — wired into the route but exercised minimally in Slice 1 (the real bias content arrives in Slice 2).
- ✓ Confidence normalization in the route (per spec §6.5).
- ✓ Safari-compatible MIME probing (per spec §7.3).
- ✓ Admin > Platform Tools > Communications "Speech-to-text" provider readiness card.
- ✗ DEFERRED to Slice 2: org vocabulary bias prompt, two-pass LLM cleanup, A/B telemetry.
- ✗ DEFERRED to Slice 3: inbound voice on the communication fabric, `CommunicationAdapter.capabilities.transcribeInboundMedia`, WhatsApp `fetchInboundMedia`.
- ✗ DEFERRED to Slice 4: streaming partials, mobile mic, TTS.

---

## Files And Responsibilities

**New files:**

- `apps/web/lib/voice/transcribe.ts`
  Thin call-site that builds an `AdapterRequest`-shaped call to `callProvider` with `executionAdapter:"transcription"` and `taskType:"transcription"`. Resolves provider+model via the routing layer, never picks them itself.

- `apps/web/lib/voice/confidence-normalize.ts`
  Per-provider-family normalization (spec §6.5 table). Pure function over `AdapterResult.raw`.

- `apps/web/lib/voice/bias-classification-gate.ts`
  Receives a bias prompt + the resolved endpoint; returns the prompt either passed-through (on-org) or stripped to public/internal-low subset (off-org). Slice 1 callers pass an empty bias prompt — the gate is wired so Slice 2 can populate it.

- `apps/web/lib/voice/types.ts`
  `TranscribeContext`, `TranscribeResponse`, `NormalizedConfidence`, `BiasClassification` types.

- `apps/web/app/api/transcribe/route.ts`
  Next.js App Router POST handler. Validates multipart input, base64-encodes audio for the adapter, calls `transcribe()`, normalizes confidence, projects the response shape per spec §6.5, writes telemetry to the table chosen in Prerequisite 2.

- `apps/web/app/api/transcribe/route.architecture.test.ts`
  **The architecture test.** Replaces the `transcription` adapter in the registry with a fake; asserts the route's response shape derives from the adapter's `AdapterResult`, not from a direct HTTP call. Without this test, future refactors silently regress.

- `apps/web/components/agent/hooks/useVoiceCapture.ts`
  Browser hook: `getUserMedia` → `MediaRecorder` (with Safari-aware MIME probing per spec §7.3) → `@ricky0123/vad-web` endpointing → POST `/api/transcribe` → returns `{ state, transcript, error }`.

- `apps/web/components/agent/hooks/useVoiceCapture.test.ts`
  Unit tests for the hook state machine; MIME probe assertion includes a Safari-shape fallback.

- `apps/web/components/agent/MicButton.tsx`
  Compact mic-button component rendered inside `AgentMessageInput`. State machine per spec §5.1 (Idle | Recording | Transcribing | Result | Error).

- `apps/web/components/agent/MicButton.test.tsx`
  Component tests: state transitions, ARIA labels, disabled-during-send.

- `apps/web/components/admin/SpeechToTextCard.tsx`
  Platform Tools > Communications card. Provider-readiness, last-tested timestamp, test-phrase harness.

- `apps/web/components/admin/SpeechToTextCard.test.tsx`
  Component tests; mocks `/api/transcribe` test-harness call.

- `apps/web/app/api/transcribe/__fixtures__/whisper-segments.json`
  Sample speaches/Whisper verbose-json response (with `segments[].avg_logprob` etc.) used by the confidence-normalization unit tests.

- `apps/web/app/api/transcribe/__fixtures__/safari-mp4-audio.bin`
  Tiny (≤4 KB) AAC clip used by the route's Safari round-trip test.

**Modified files:**

- `apps/web/components/agent/AgentMessageInput.tsx`
  Mount `<MicButton>` to the left of the send control. Add `onTranscript(text)` callback that appends transcribed text at the textarea's cursor position. Keyboard handling: spacebar push-to-talk **only when the textarea is empty and focused** (per spec §10 Q1).

- `apps/web/components/agent/AgentMessageInput.test.tsx`
  Add: mic button renders, spacebar-only-on-empty behaviour, transcript appended at cursor, send still works after transcribe.

- `apps/web/components/admin/CommunicationsHub.tsx` (existing — verify path during Task 9)
  Add the `<SpeechToTextCard>` below the existing provider readiness cards.

- `docker-compose.yml`
  Add `dpf-stt` service under `profiles: ["stt"]`, single entry, image switched by `${DPF_STT_IMAGE:-ghcr.io/speaches-ai/speaches:latest-cuda}`.

- `apps/web/package.json`
  Add dependency: `"@ricky0123/vad-web": "^0.0.x"` (pin exact version found via `pnpm view @ricky0123/vad-web version` during Task 1).

- Seed files (location confirmed during Task 8): seed a `ModelProvider` row for `speaches`, a transcription-capable `ModelProfile`, and an `EndpointTaskPerformance` row for `taskType="transcription"`.

- `.env.example` (if present at repo root — verify in Task 11)
  Document `DPF_STT_IMAGE`, `DPF_STT_MODEL`, `STT_BASE_URL` env vars.

---

## Chunk 1 — Dependency + Substrate Seed

### Task 1: Add `@ricky0123/vad-web` Dependency

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Resolve the current published version.**
  ```bash
  pnpm view @ricky0123/vad-web version
  ```
  Expected output: a single version string (e.g. `0.0.24`). Pin this exact version — do not use `^` (per [feedback_update_deps_when_noticed](../../../.claude/projects/D--DPF/memory/feedback_update_deps_when_noticed.md), version pinning is the platform principle; bump cleanly later).

- [ ] **Step 2: License check.** Open the package page; confirm MIT (the spec's OSS-license table claims MIT for `@ricky0123/vad`). If license is anything other than MIT/Apache/BSD-3, halt and escalate — DPF is Apache-2.0.

- [ ] **Step 3: Add to `apps/web/package.json` dependencies.** Use the exact pinned version. Run `pnpm install` from the repo root.

- [ ] **Step 4: Commit.** `git add apps/web/package.json pnpm-lock.yaml && git commit -s -m "feat(voice): add @ricky0123/vad-web dependency for Silero VAD endpointing"`

### Task 2: Seed Speaches as a Transcription-Capable Provider

**Files:**
- Modify: seed files (path resolved in this task; common candidates: `packages/db/prisma/seed.ts`, `apps/web/lib/seeds/model-providers.ts`, or similar)
- Test: `<seed-file>.test.ts` if the existing seed has a test pattern

- [ ] **Step 1: Find existing seed pattern for `ModelProvider`.** Use the Grep tool (literal search, cross-platform safe): pattern `modelProvider\.(upsert|create)`, path `packages/db apps/web/lib`. If zero hits, **halt and escalate to the Chief Architect** rather than inventing a new seed entry point — seeding may live in an init job container or a fixture pipeline whose location is non-obvious. Open the existing seed file. Match its style (upsert by stable key, sign-off-equivalent).

- [ ] **Step 2: Write a failing test for the speaches seed row.** In a test colocated with the seed (or a new `model-providers-speaches.test.ts`):
  ```typescript
  import { describe, it, expect } from "vitest";
  import { prisma } from "@/lib/prisma";
  import { seedSpeachesProvider } from "<path-from-step-1>";
  describe("speaches provider seed", () => {
    it("upserts a ModelProvider keyed by providerId='speaches' pointing at STT_BASE_URL", async () => {
      await seedSpeachesProvider();
      const row = await prisma.modelProvider.findUnique({ where: { providerId: "speaches" } });
      expect(row?.baseUrl).toBeTruthy();
    });
  });
  ```

- [ ] **Step 3: Run the test — verify it fails.** `pnpm --filter web exec vitest run <test-file>` should report "providerId 'speaches' not found".

- [ ] **Step 4: Implement `seedSpeachesProvider()`.** Upsert by `providerId="speaches"`, `baseUrl=process.env.STT_BASE_URL ?? "http://dpf-stt:8000"`, `authMethod="none"` (the sidecar is localhost-only, no auth required by default), `capabilities` JSON includes `transcription: true`.

- [ ] **Step 5: Run the test — verify it passes.**

- [ ] **Step 6: Seed a transcription-capable `ModelProfile`.** Look up the existing pattern for `ModelProfile` upsert; add a row with `providerId="speaches"`, `modelId="Systran/faster-distil-whisper-large-v3"`, `taskTypes` including `"transcription"`. Match the existing capability-declaration shape — do **not** invent a new field.

- [ ] **Step 7: Seed `EndpointTaskPerformance` for `taskType="transcription"`.** Map speaches to the `small` tier per spec §6.7 step 3. Use the existing upsert pattern.

- [ ] **Step 8: Run the seed locally against a throwaway DB.** `pnpm --filter @dpf/db exec prisma migrate deploy && <run-seed>`. Verify the three rows land.

- [ ] **Step 9: Commit.** `git commit -s -m "feat(voice): seed speaches as transcription-capable provider + endpoint performance"`

### Task 3: Add Speaches Sidecar to `docker-compose.yml`

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Verify the additive nature.** `docker compose config` against the current `docker-compose.yml` should produce a clean parse. Document the current top-level service list (used in step 4 to verify nothing else changed).

- [ ] **Step 2: Add the `dpf-stt` service exactly as specified in spec §6.6.**
  ```yaml
  dpf-stt:
    image: ${DPF_STT_IMAGE:-ghcr.io/speaches-ai/speaches:latest-cuda}
    profiles: ["stt"]
    environment:
      WHISPER_MODEL: "${DPF_STT_MODEL:-Systran/faster-distil-whisper-large-v3}"
      ENABLE_UI: "false"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8000/v1/models"]
    ports:
      - "127.0.0.1:8765:8000"
  ```
  Single service entry. Localhost-only port binding. Profile-gated so default `docker compose up` does not start it.

- [ ] **Step 3: Verify default `compose up` is unchanged.** `docker compose config --services` should NOT list `dpf-stt`. `docker compose --profile stt config --services` SHOULD list it.

- [ ] **Step 4: Pull and smoke-test the image locally.**
  ```bash
  docker compose --profile stt up -d dpf-stt
  curl -fsS http://127.0.0.1:8765/v1/models
  docker compose --profile stt down
  ```
  Expected: the curl returns a JSON list of available Whisper models.

- [ ] **Step 5: Commit.** `git commit -s -m "feat(voice): add speaches STT sidecar under docker-compose 'stt' profile"`

---

## Chunk 2 — Routing-Layer Composition

### Task 4: Implement `bias-classification-gate.ts`

**Files:**
- Create: `apps/web/lib/voice/bias-classification-gate.ts`
- Create: `apps/web/lib/voice/bias-classification-gate.test.ts`

Slice 1 callers always pass an empty bias prompt — the gate is wired so Slice 2 can populate it without touching the route. Implementing it now keeps the off-org PII-leak path closed from day one.

- [ ] **Step 1: Write the failing tests.** Cover:
  - Empty bias → returns `{ prompt: "", classification: "empty", redacted: false }`.
  - On-org provider (matches `providerId in ["speaches", "whisper-cpp-local"]`) → returns prompt verbatim with `classification: "on-org"`, `redacted: false`.
  - Off-org provider (e.g. `providerId === "groq"`) → returns the prompt with any token classified as `confidential` stripped; `redacted: true` if any token stripped.

- [ ] **Step 2: Run tests — verify they fail.** `pnpm --filter web exec vitest run lib/voice/bias-classification-gate`

- [ ] **Step 3: Implement.** Pure function, no DB access. Provider-set membership is a small allow-list at the top of the file; Slice 2 may externalize it.

- [ ] **Step 4: Run tests — verify they pass.**

- [ ] **Step 5: Commit.** `git commit -s -m "feat(voice): bias-prompt classification gate for off-org provider safety"`

### Task 5: Implement `confidence-normalize.ts`

**Files:**
- Create: `apps/web/lib/voice/confidence-normalize.ts`
- Create: `apps/web/lib/voice/confidence-normalize.test.ts`
- Create: `apps/web/app/api/transcribe/__fixtures__/whisper-segments.json`

- [ ] **Step 1: Capture a real Whisper verbose-json fixture and commit it to the repo.** Start the speaches sidecar (`docker compose --profile stt up -d dpf-stt`), POST a 3-second test clip with `response_format=verbose_json`, save the response as `apps/web/app/api/transcribe/__fixtures__/whisper-segments.json`. Include `segments[]` with `avg_logprob` and `no_speech_prob`. **Commit the fixture file** — CI must not depend on a live sidecar to run tests. The fixture is the deterministic input every test run reads.

- [ ] **Step 2: Write the failing test.** Cover four cases per spec §6.5:
  - Whisper-family with non-empty `segments` → returns `clamp(exp(mean(avg_logprob)), 0, 1)`, source `"normalized"`.
  - Whisper-family with empty `segments` but a `no_speech_prob` → returns `1 - no_speech_prob`, source `"normalized"`.
  - Deepgram-shape (`channels[0].alternatives[0].confidence`) → returns that value, source `"native"`.
  - Provider returns nothing usable → returns confidence `null`, source `"unavailable"`.

- [ ] **Step 3: Run tests — verify they fail.**

- [ ] **Step 4: Implement.** Signature: `normalizeConfidence(raw: unknown, providerHint: string): { value: number | null; source: "normalized" | "native" | "unavailable" }`. Pure function.

- [ ] **Step 5: Run tests — verify they pass.**

- [ ] **Step 6: Commit.** `git commit -s -m "feat(voice): per-provider transcript confidence normalization"`

### Task 6: Implement `transcribe.ts` Call-Site

**Files:**
- Create: `apps/web/lib/voice/types.ts`
- Create: `apps/web/lib/voice/transcribe.ts`
- Create: `apps/web/lib/voice/transcribe.test.ts`

The call-site builds the `AdapterRequest` for `callProvider`. It does **not** know about HTTP, multipart, or the sidecar. It is the thin wrapper the spec mandates.

- [ ] **Step 0: Read the actual `callProvider` signature.** Before writing any test or implementation, open `apps/web/lib/inference/ai-inference.ts` at line 334 and copy the exact signature (parameter names, types, defaults, return type). Paste it verbatim into a comment at the top of `transcribe.test.ts`. **Do not guess.** If the signature uses an options object or differs from `(providerId, modelId, messages, systemPrompt, tools?, plan?, ...)` as currently asserted in this plan, adjust the test and implementation accordingly. This prevents a Task 12 typecheck failure.

- [ ] **Step 1: Write `types.ts`.**
  ```typescript
  export type TranscribeContext = "coworker_panel" | "inbound_channel" | "test_harness";

  export interface TranscribeInput {
    audioBase64: string;
    mimeType: string;
    context: TranscribeContext;
    threadId?: string;
    channelBindingId?: string;
    language?: string;
    tierHint?: "small" | "high-accuracy";
    biasPrompt?: string;
  }

  export interface TranscribeResult {
    text: string;
    rawText: string;
    confidence: number | null;
    confidenceSource: "normalized" | "native" | "unavailable";
    language?: string;
    durationMs: number;
    provider: string;
    model: string;
    biasUsed: boolean;
    biasRedacted: boolean;
  }
  ```

- [ ] **Step 2: Write the failing test for `transcribe.ts`.** Use the registry test-reset helper to install a fake `transcription` adapter that returns a known `AdapterResult`. Assert that:
  - `transcribe()` calls `callProvider` with `executionAdapter:"transcription"` and `taskType:"transcription"`.
  - The audio is passed as a `{type:"audio", data, mimeType}` content part on a user message.
  - The bias prompt goes through `bias-classification-gate` before being placed in `plan.providerSettings.prompt`.
  - The returned `TranscribeResult` projects the adapter's `AdapterResult` correctly (`text`, `durationMs` from `inferenceMs`, confidence from `normalizeConfidence(raw)`).

- [ ] **Step 3: Run test — verify it fails.**

- [ ] **Step 4: Implement `transcribe.ts`.**
  - Resolve provider/model via the routing layer's task-type selector (call into the existing `routed-inference.ts` if it exposes one; otherwise look up the `EndpointTaskPerformance` row for `taskType="transcription"` and pick the top-scored endpoint at the requested tier).
  - Pass the gated bias into `plan.providerSettings.prompt`.
  - Call `callProvider(providerId, modelId, messages, "" /* no systemPrompt for transcription */, undefined /* no tools */, plan)`.
  - Normalize confidence from `result.raw`.
  - Build the `TranscribeResult`.

- [ ] **Step 5: Run test — verify it passes.**

- [ ] **Step 6: Commit.** `git commit -s -m "feat(voice): transcribe() call-site composing the existing transcription adapter"`

### Task 7: Implement `/api/transcribe` Route + Architecture Test

**Files:**
- Create: `apps/web/app/api/transcribe/route.ts`
- Create: `apps/web/app/api/transcribe/route.test.ts`
- Create: `apps/web/app/api/transcribe/route.architecture.test.ts`
- Create: `apps/web/app/api/transcribe/__fixtures__/safari-mp4-audio.bin`

- [ ] **Step 1: Write the architecture test.** This is the gating test that prevents future regression to a parallel HTTP client.
  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from "vitest";
  import { POST } from "./route";
  import { registerExecutionAdapter, _resetAdaptersForTest, getExecutionAdapter } from "@/lib/routing/execution-adapter-registry";

  describe("architecture: /api/transcribe composes the transcription registry adapter", () => {
    beforeEach(() => {
      _resetAdaptersForTest();
      registerExecutionAdapter({
        type: "transcription",
        async execute(_req) {
          return { text: "FAKE_ADAPTER_OUTPUT", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, inferenceMs: 42, raw: { segments: [] } };
        },
      });
    });
    afterEach(() => _resetAdaptersForTest());
    it("returns text derived from the registered transcription adapter, not a direct HTTP call", async () => {
      const form = new FormData();
      form.append("audio", new Blob([new Uint8Array(16)], { type: "audio/webm" }), "audio.webm");
      form.append("context", "test_harness");
      const req = new Request("http://test/api/transcribe", { method: "POST", body: form });
      const res = await POST(req);
      const body = await res.json();
      expect(body.text).toBe("FAKE_ADAPTER_OUTPUT");
      expect(body.durationMs).toBe(42);
    });
  });
  ```

- [ ] **Step 2: Run the architecture test — verify it fails** (no route exists yet).

- [ ] **Step 3: Write functional tests for the route.** Cover:
  - 400 on missing audio.
  - 400 on missing `context`.
  - 415 on non-audio MIME.
  - 413 on payload > documented max (default 25 MB, configurable later).
  - 200 on valid input — response shape matches spec §6.5.
  - Safari round-trip: posts an `audio/mp4` (AAC) clip from the fixture and asserts a 200 with non-empty `text`.

- [ ] **Step 4: Run functional tests — verify they fail.**

- [ ] **Step 5: Implement the route.**
  - App Router POST handler.
  - Validate multipart fields.
  - Convert audio blob to base64.
  - Build `TranscribeInput` and call `transcribe()`.
  - Project to spec §6.5 response shape.
  - Write the telemetry row to the table chosen in Prerequisite 2 — exactly once per request, before returning the response.
  - On adapter throw, classify per spec §7.2:
    - `InferenceError({code:"network"})` → 503 with `errorClass:"tool-error"`.
    - `InferenceError({code:"provider_error"})` → 502 with `errorClass:"tool-error"`.
    - Validation failures → 4xx with `errorClass:"tool-denied"`.

- [ ] **Step 6: Run all tests — verify they pass.** `pnpm --filter web exec vitest run app/api/transcribe`

- [ ] **Step 7: Commit.** `git commit -s -m "feat(voice): POST /api/transcribe with architecture test asserting registry composition"`

---

## Chunk 3 — Browser Capture Surface

### Task 8: Implement `useVoiceCapture` Hook

**Files:**
- Create: `apps/web/components/agent/hooks/useVoiceCapture.ts`
- Create: `apps/web/components/agent/hooks/useVoiceCapture.test.ts`

- [ ] **Step 1: Write the failing test for the MIME probe (Safari interop, spec §7.3).**
  Stub `MediaRecorder.isTypeSupported` to return `false` for `audio/webm*` and `true` for `audio/mp4`. Assert the hook selects `"audio/mp4"`.

- [ ] **Step 2: Write the failing test for the state machine** (Idle → Recording → Transcribing → Result, plus Error path on permission denial).

- [ ] **Step 3: Write the failing test for the Page Visibility behaviour** — backgrounding the tab during Recording must transition to Idle and discard the buffer.

- [ ] **Step 4: Run tests — verify they fail.**

- [ ] **Step 5: Implement the hook.**
  - `MediaRecorder.isTypeSupported` priority list per spec §7.3.
  - Pull audio chunks; flush to a single `Blob` on stop.
  - Wire `@ricky0123/vad-web` for end-of-utterance detection — silence > 1.2 s ends the recording.
  - Page Visibility listener for auto-stop.
  - POST to `/api/transcribe` with `context:"coworker_panel"` + `threadId`.
  - Returns `{ state, transcript, error, start(), stop() }`.

- [ ] **Step 6: Run tests — verify they pass.**

- [ ] **Step 7: Commit.** `git commit -s -m "feat(voice): useVoiceCapture hook with Safari MIME probe and VAD endpointing"`

### Task 9: Implement `MicButton.tsx`

**Files:**
- Create: `apps/web/components/agent/MicButton.tsx`
- Create: `apps/web/components/agent/MicButton.test.tsx`

- [ ] **Step 1: Write failing tests** covering the state machine (Idle | Recording | Transcribing | Result | Error), ARIA labels per spec §5.1, disabled-during-send, the red privacy-indicator dot when Recording, and a **"Disabled — STT not configured"** state with tooltip "Speech-to-text not configured — see Platform Tools > Communications" (per Task 13 Step 6 decision).

- [ ] **Step 2: Run tests — verify they fail.**

- [ ] **Step 3: Implement.** Lucide `Mic` / `MicOff` icons (already imported elsewhere in the codebase — confirm via `grep -n "from \"lucide-react\"" apps/web/components/agent/AgentMessageInput.tsx`). Animated waveform optional in Slice 1; can be a CSS-only pulsing dot.

- [ ] **Step 4: Run tests — verify they pass.**

- [ ] **Step 5: Commit.** `git commit -s -m "feat(voice): MicButton component with state machine + privacy indicator"`

### Task 10: Wire `MicButton` Into `AgentMessageInput`

**Files:**
- Modify: `apps/web/components/agent/AgentMessageInput.tsx`
- Modify: `apps/web/components/agent/AgentMessageInput.test.tsx`

- [ ] **Step 1: Re-read the current file** (`apps/web/components/agent/AgentMessageInput.tsx`) to confirm the existing prop surface (`onSend`, `disabled`, `busy`, `threadId`, `pendingFile`, `onFileUploaded`, `onFileClear`). The mic feature does not introduce a new prop — the transcript is appended into the existing local `value` state.

- [ ] **Step 2: Add failing tests** to `AgentMessageInput.test.tsx`:
  - Mic button renders.
  - Clicking mic triggers the hook (mock the hook).
  - Transcript text is appended at the textarea cursor (use a known cursor position).
  - Spacebar push-to-talk fires only when the textarea is empty and focused.
  - Send still works after transcribe.

- [ ] **Step 3: Run tests — verify they fail.**

- [ ] **Step 4: Implement.** Mount `<MicButton>` to the left of the send control. The button passes an `onTranscript(text)` callback that splices `text` into `value` at the textarea selection point.

- [ ] **Step 5: Run tests — verify they pass.**

- [ ] **Step 6: Commit.** `git commit -s -m "feat(voice): wire MicButton into AgentMessageInput with spacebar push-to-talk"`

---

## Chunk 4 — Admin Surface + Manual Verification

### Task 11: Implement `SpeechToTextCard` and Mount in Communications Hub

**Files:**
- Create: `apps/web/components/admin/SpeechToTextCard.tsx`
- Create: `apps/web/components/admin/SpeechToTextCard.test.tsx`
- Modify: existing communications hub page (path confirmed in Step 1)

- [ ] **Step 1: Find the existing Communications hub page.** Use the Grep tool with pattern `Communications` and path `apps/web/app` (parens in the route group are filesystem-literal; the Grep tool handles them — do not shell-escape). Confirm the file path (likely `apps/web/app/(shell)/platform/tools/integrations/communications/page.tsx` from the comm fabric Slice 0/1 work).

- [ ] **Step 2: Write failing tests.**
  - Card renders provider readiness ("speaches sidecar — healthy" / "unhealthy" / "not configured").
  - Test-phrase button fires `POST /api/transcribe` with `context:"test_harness"`.
  - Last-tested timestamp updates on successful test.

- [ ] **Step 3: Run tests — verify they fail.**

- [ ] **Step 4: Implement the card.** Server component for the readiness data fetch (queries the `ModelProvider` row); client component for the test-phrase button.

- [ ] **Step 5: Mount in the communications hub.** Add the card below existing provider readiness cards.

- [ ] **Step 6: Run tests — verify they pass.**

- [ ] **Step 7: Commit.** `git commit -s -m "feat(voice): admin Speech-to-text readiness card in Platform Tools > Communications"`

### Task 12: Build Gate

Per [build-gate-mandatory](../../founder-kernel/wiki/principles/build-gate-mandatory.md).

- [ ] **Step 1: Unit tests.**
  ```bash
  pnpm --filter web exec vitest run lib/voice components/agent/hooks components/agent/MicButton components/agent/AgentMessageInput app/api/transcribe components/admin/SpeechToTextCard
  ```
  Expected: all green. No skipped tests. No pre-existing failures introduced.

- [ ] **Step 2: Typecheck.** `pnpm --filter web typecheck` — must pass with zero errors.

- [ ] **Step 3: Production build.** `cd apps/web && npx next build` — must pass with zero errors. Watch for TypeScript errors that only surface here.

- [ ] **Step 4: Migration check.** Slice 1 has no migrations. Run `pnpm --filter @dpf/db exec prisma migrate status` to confirm parity. If `prisma migrate diff` shows any drift, halt and investigate — this slice must not introduce one.

### Task 13: Manual UX Verification

- [ ] **Step 1: Start full local stack with STT profile.**
  ```bash
  docker compose --profile stt up -d
  pnpm --filter web dev
  ```

- [ ] **Step 2: Browser exercise — Chrome.** Open the AI Coworker panel on `https://localhost:<port>/storefront` (HTTPS required for `getUserMedia`). Click mic, say three phrases including a technical term ("repository", "Whisper", "Kubernetes"). Confirm:
  - Browser permission prompt appears once.
  - Recording state shows pulsing red dot.
  - Background the tab — recording stops, no transcript appears.
  - Re-record, let it complete — transcript lands in the textarea at the cursor position.
  - Press send — the SSE flow still works (per `2026-04-03-async-coworker-messaging-design.md`).
  - Verify the `AgentAttachment` row in the DB has `parsedContent.voice = { audioBlobId, durationMs, normalizedConfidence, providerConfidenceRaw, transcribedBy, providerModel }`.

- [ ] **Step 3: Browser exercise — Safari.** Repeat the above on Safari 16.4+. Confirm the `audio/mp4` MIME path round-trips correctly. The architecture test asserts this at unit level; this is the live confirmation.

- [ ] **Step 4: Admin card exercise.** Navigate to Platform Tools > Communications. Confirm the Speech-to-text card shows "speaches sidecar — healthy". Click "Test phrase"; confirm round-trip succeeds.

- [ ] **Step 5: Permission denial path.** In Chrome, deny mic permission. Confirm the button shows the "Microphone blocked" state with the re-enable hint, and clicking it does not crash.

- [ ] **Step 6: Default-compose exercise.** Stop the stack. Run `docker compose up -d` (no `--profile stt`). Confirm `dpf-stt` is NOT running. Open the coworker panel; confirm the mic button is **disabled** with the tooltip "Speech-to-text not configured — see Platform Tools > Communications". (Pre-decided per advisory: disabled-with-tooltip is more discoverable than hidden, which would leave admins wondering where the mic went.)

### Task 14: Commit the Architect-Ratification Updates

Record the four Pre-Implementation Gate decisions inline at the top of this plan with date + signer. Commit and push.

- [ ] **Step 1: Edit the four "Recorded:" lines** at the top of this plan with the actual decisions.
- [ ] **Step 2: Commit.** `git commit -s -m "doc(voice): record Slice 1 pre-implementation gate decisions"`

---

## Open Questions Carried Forward (do not block Slice 1)

These were not resolved during Slice 1 planning and are deferred. None block Slice 1 shipping — they shape Slices 2+.

- **Q1 (spec §10 Q1) — Spacebar default.** Slice 1 implements "spacebar-only-when-textarea-is-empty-and-focused". Validate in Task 13 manual UX; revisit if it conflicts with any other binding.
- **Q3 (spec §10 Q3) — Confidence threshold tuning.** Slice 1 hard-codes 0.85 (native) / 0.80 (normalized-Whisper). Telemetry from Slice 1 day 1 feeds the tuning in Slice 2.
- **Q5 (spec §10 Q5) — Edge-node CPU performance.** Tested in Task 13 only on the developer's machine. An edge-lab run is a follow-up.

---

## Recommended Execution Path

1. **Pre-Implementation Gate** — resolve all four prerequisites and record decisions inline above.
2. **Chunk 1 (Tasks 1–3)** in sequence. Each lands as its own commit; the chunk pushes as a single PR for review of substrate decisions before any application code lands.
3. **Chunk 2 (Tasks 4–7)** as a second PR. The architecture test in Task 7 is the gating evidence.
4. **Chunk 3 (Tasks 8–10)** as a third PR — the user-visible mic surface.
5. **Chunk 4 (Tasks 11–13)** as the final PR with the admin surface and manual verification.
6. **Task 14** lands as part of PR 4 or as a tiny docs follow-up.

Each PR is small enough to review in one sitting, each leaves the build green, and the slice is shippable end-to-end only after PR 4. Per AGENTS.md "PR creation means ready to merge" — open each PR only when its build gate is green.

## What Slice 1 Deliberately Leaves Out

- No vocabulary bias prompt content (Slice 2 populates the gate).
- No LLM cleanup pass (Slice 2).
- No mobile companion mic (Slice 4).
- No streaming partial transcripts (Slice 4).
- No outbound TTS (Slice 4).
- No inbound channel voice (Slice 3, hard-blocked by fabric Slice 3 per spec §8).
- No `CommunicationAdapter.capabilities.transcribeInboundMedia` flag (Slice 3).
- No typed `AgentAttachment.voiceMetadata` column (deferred per spec §10 Q9; Slice 1 namespaces inside `parsedContent.voice`).
