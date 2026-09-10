---
status: active
---

# Speech becomes provider-managed

**OBJ-ID:** BI-F7E9A541
**Date:** 2026-09-09
**Supersedes for STT hosting:** `2026-05-17-voice-input-slice-1-5-default-on-cpu.md` (the default-on CPU sidecar decision)
**Resolves:** BI-E6EF0B2C (the open decision about the vanished third-party digest)

## 1. Problem

`docker-compose.yml` pins `hwdsl2/whisper-server` by digest for the optional `dpf-stt` service. It is the **only** digest-pinned third-party image in shipped Compose, and it is the sole cause of a recurring release failure.

The release manifest guard deliberately covers images behind optional profiles — `scripts/release/verify-compose-image-manifests.mjs` passes `--profile "*"`, with a comment stating verification must include them. When the upstream publisher re-pushes `:latest` and prunes the previous index digest, the guard fails, E2E install verification fails, and `promote-latest` (declared `needs: [verify, gate]`) never runs. The `:latest` pointer stops advancing for every install, and installs then report "you are up to date" while reading a pointer that never moved.

The digest has rotted at least three times: `166a8c04`, `29d01f2e`, and `257302e5` re-pinned on 2026-09-07. BI-A9EAEE2C built a watcher to auto-re-pin it, and a further design was needed for the watcher's own failure path. We are maintaining automation to service a third party's registry housekeeping.

The service has never run on the reference install. It is gated behind the `runtime-local-speech` profile and `dpf-stt` is absent. It costs no runtime and all of the release fragility.

**Adjacent live defect.** The single seeded transcription endpoint resolves to model `base` on provider `speaches`, which is that sidecar. With the sidecar absent, voice input resolves to a dead endpoint on a fresh install. Unnoticed because the feature is opt-in and unused.

## 2. Decision

Speech-to-text moves from a **locally-activated container capability** to the **provider-managed** class the capability architecture already defines.

`docs/architecture/capability-driven-runtime-profiles.md` already distinguishes the two, and describes the target state exactly: *"External — provider managed | Provider configuration and reconciled provider evidence determine availability; it is not treated as a local container."* That is the class `runtime:external-ai` already uses. Speech-to-text joins it.

Founder direction, 2026-09-09: the sidecar "is bloating the server and an interesting feature, but not worth the extra dependency and causes for failure", and enablement should follow configuration — *"when the configuration happens for a provider that supports TTS and STT, then we enable it."*

**DPF stops shipping and redistributing a third party's speech image. The capability survives, driven by provider configuration.**

## 3. Why no new substrate is needed

Per [verify-substrate-before-proposing-new](../../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md), the external path is already built:

- `apps/web/lib/routing/transcription-adapter.ts` is provider-agnostic by construction. It POSTs multipart audio to any OpenAI-compatible `/v1/audio/transcriptions`, is registered through the execution adapter registry, and its own header names `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`.
- `apps/web/lib/voice/endpoint-resolution.ts` carries an explicit instruction that it MUST NOT hardcode `speaches`, citing [no-provider-pinning](../../founder-kernel/wiki/principles/no-provider-pinning.md), because the database row is the source of truth.
- Model profiles already carry the discriminating fields. `packages/db/src/voice-stt-providers.ts` documents `modelClass: "transcription"`, `inputModalities: ["audio"]`, `outputModalities: ["text"]` and `capabilities.transcription` as "the fields downstream code SHOULD look at to identify an STT model."
- The owning spec `2026-05-16-voice-input-and-transcription-design.md` already settled the posture in §4.5: hosted providers are "routing destinations, not pins", and "the platform is a conduit: customers bring their own hosted-STT credentials if they want them."

So this is composition of existing substrate, not new machinery. It is the 80% refactor shape: collapsing a loosely-coupled sidecar seam into the provider layer that already governs every other model capability.

## 4. Research and benchmarking

### 4.1 Options considered for the hosting problem

| Option | Verdict |
| --- | --- |
| **Mirror the third-party image into GHCR** | Rejected as the end state. Fixes fragility but DPF still redistributes a stranger's bytes, still owns a mirrored artifact, and still carries a licence-redistribution question. Kernel scoring (DI-22917B3D2991) ranked it highest of three when removal was not on the table; removal is better. |
| **Build DPF's own image from upstream MIT source** | Viable and was the recommended near-term answer, but it keeps a speech container in shipped Compose and keeps DPF in the model-serving business for an opt-in feature. Retained as the documented self-host path, not as a shipped service. |
| **Absorb a speech engine into DPF source** | Rejected. `whisper.cpp` is a large, actively developed C++/CUDA/Metal codebase with no platform logic to hybridize. Owning it is a permanent maintenance burden for no integration gain — adopting a liability, not absorbing a capability. |
| **Provider-managed (chosen)** | Removes the failure class entirely, needs no new code in the call path, matches an existing architectural class, and preserves self-hosting as an operator choice. |

### 4.2 Speech providers available to an operator

Verified against the shipped provider registry and the adapter's supported wire format.

| Provider | Wire format | Works today | Note |
| --- | --- | --- | --- |
| OpenAI | `/v1/audio/transcriptions` | Yes, no code change | `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` |
| Groq | `/v1/audio/transcriptions` | Yes, no code change | Whisper-large-v3-turbo; already in the registry, unconfigured |
| Self-hosted (speaches, whisper.cpp server) | `/v1/audio/transcriptions` | Yes, operator-supplied base URL | Both MIT; operator runs the container, DPF does not ship it |
| Gemini | `generateContent` with inline audio | Not without work | Different API shape; would need a second transcription adapter. Out of scope. |
| Anthropic | none | No | No audio input block, as noted in `ai-inference.ts`. |

### 4.3 Local-model path, tested and rejected for now

Whether the existing local inference runtime could serve transcription was tested directly rather than assumed. A generated WAV was posted as an `input_audio` block to the local model runner's chat completions endpoint. It returned HTTP 500: `audio input is not supported - hint: if this is unexpected, you may need to provide the mmproj`. The runner serves no `/v1/audio/transcriptions` route at all (404), only two models are installed and neither is audio-capable, and `transcribe()` dispatches exclusively to the multipart adapter, so the `input_audio` chat path is unreachable from voice input regardless.

A code comment in `ai-inference.ts` claiming a local Gemma 4 12B transcribed a wav on 2026-06-15 refers to a model no longer installed. **That comment is corrected in this change**, since it misleads exactly this investigation.

Unifying local audio onto the chat path remains attractive and is filed separately; it is not a precondition for this work.

## 5. Scope

### In scope

1. Remove the `dpf-stt` service block and its digest pin from shipped Compose, and every downstream reference: substrate manifest, generated capability catalog, monitoring scrape configuration, install scripts.
2. Retire the STT digest watcher, its re-resolve script and its test, since there is no pin left to watch.
3. Rebind `runtime:local-speech` so it no longer claims `dpf-stt`.
4. Make voice availability follow provider capability rather than a Compose profile.
5. Seed transcription-capable model profiles for the OpenAI-compatible providers already in the registry, so configuring one lights up voice with no further admin step.
6. Repoint the `speaches` provider entry as an operator-supplied self-host endpoint rather than a DPF-shipped service, and document that path.
7. Fix the dead default transcription endpoint on a fresh install.

### Out of scope, deliberately

- **The `dpf-tts` sidecar stays.** It is pinned by version tag (`travisvn/chatterbox-tts-api:v0.1.0`), not a mutable index digest, so it does not participate in this failure mode. Local zero-shot voice cloning is a differentiated capability no hosted provider replaces cheaply. Only its enablement signal is touched.
- Gemini transcription adapter.
- Unifying local audio onto the chat-completions path.
- Streaming partial transcripts.

## 6. Ordered implementation sequence

This is the plan of record for BI-F7E9A541. Deliverables in order, each independently verifiable.

1. **Compose and manifest.** Delete the `dpf-stt` service block. Remove its entry from `scripts/platform-substrate-manifest.json`. Regenerate `scripts/capability-service-catalog.generated.json` via `scripts/compile-capability-service-catalog.mjs`.
2. **Release machinery.** Delete `.github/workflows/stt-digest-watch.yml`, `scripts/release/re-resolve-stt-digest.mjs` and its test. Confirm `verify-compose-image-manifests.mjs --only digest-pinned` now has no third-party image to check.
3. **Capability binding.** Rebind `runtime:local-speech` to `dpf-tts` only. Update the profile table in `docs/architecture/capability-driven-runtime-profiles.md`.
4. **Provider seed.** Repoint the `speaches` registry entry to an operator-supplied base URL and rename it to reflect that it is self-hosted, not shipped. Add transcription model profiles for the OpenAI-compatible providers. Stop seeding a default endpoint that points at an absent service.
5. **Capability-driven availability.** Voice readiness reports available when a configured, active provider exposes a transcription-capable model; otherwise it reports what the operator must configure, naming no shell command.
6. **Observability and install.** Remove `dpf-stt` scrape targets from `monitoring/prometheus/prometheus.yml` and `monitoring/alloy/config.alloy`. Remove its handling from `install-dpf.sh` and `install-dpf.ps1`.
7. **Docs.** Update install guides, the observability coverage page, and the voice specs to describe the provider-managed shape and the self-host option.
8. **Correction.** Fix the stale local-audio comment in `ai-inference.ts`.

## 7. Acceptance criteria

| # | Criterion | How it is verified |
| --- | --- | --- |
| AC1 | Shipped Compose contains no digest-pinned third-party image | `grep '@sha256:' docker-compose.yml` returns nothing; manifest guard runs clean |
| AC2 | Configuring an active provider that advertises a transcription-capable model makes voice available, with no Compose profile change and no manual endpoint seeding | Unit test over the resolution path with a configured provider and no local sidecar |
| AC3 | A fresh install never resolves transcription to an absent local sidecar | Seed test asserts no endpoint is seeded against a service DPF does not ship |
| AC4 | An operator can point speech at a self-hosted OpenAI-compatible endpoint through provider configuration alone | Documented in the install guide; provider entry accepts an operator base URL |
| AC5 | No stale `dpf-stt` references remain in manifest, generated catalog, monitoring, or install scripts | Repo-wide grep in the guard test |
| AC6 | The STT digest watcher and its script are gone | Files absent; no workflow references the removed script |

## 8. Verification plan

- Unit tests for the resolution and readiness paths, including the no-provider case and the self-hosted-provider case.
- A guard test asserting shipped Compose carries no digest-pinned third-party image, so this failure class cannot silently return. Proved to fail against the unfixed tree before being claimed as a fix, per [structural-verification-is-not-functional](../../founder-kernel/wiki/principles/structural-verification-is-not-functional.md).
- Seed contract test updated for the provider-managed shape.
- Full `pull-request` policy-guard profile and workspace typecheck.
- Local merged-code CI gate before push.

## 9. Risk and rollback

The change is additive-by-removal: it deletes an opt-in service nobody on the reference install runs. An operator who had enabled `runtime-local-speech` for STT keeps their volume and data — the capability architecture states that deactivation never deletes optional volumes — and regains speech by configuring a provider or pointing the self-host entry at their own container. Rollback is a revert; no migration is involved.
