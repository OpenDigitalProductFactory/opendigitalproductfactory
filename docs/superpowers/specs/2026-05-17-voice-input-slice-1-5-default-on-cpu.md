# Voice Input — Slice 1.5: Default-on CPU sidecar + 3-tier hardware ladder

> Status: **APPROVED** — proposed and operator-chosen 2026-05-17
> Amends: `docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md` §8 (slice list), §6.6 (sidecar image)
> Owning kernel principles:
> - `never-ask-user-to-run-commands` (no docker shell in operator copy)
> - `research-before-implementing` (CPU image choice grounded in vendor research)
> - "Structural verification ≠ functional verification" (acceptance includes a real audio round-trip)

## 1. Problem statement

Slice 1 (PRs #686/#692/#696/#700) and Slice 2 (PR #716) shipped the voice
input feature end-to-end on paper. End-to-end live test on the user's
install revealed the feature has **never worked once** for the operator
because:

1. `docker-compose.yml` ships `dpf-stt` under `profiles: ["stt"]`, so
   vanilla `docker compose up` does NOT start it. The mic button renders,
   the user records audio, and the route returns HTTP 503.
2. The default image is `ghcr.io/speaches-ai/speaches:latest-cuda`
   (~9 GB) — requires NVIDIA + CUDA + Docker Desktop with WSL2 GPU
   passthrough on Windows. Excludes the vast majority of likely installs
   (no GPU, AMD GPU, Apple Silicon).
3. The `speaches` `ModelProvider` row is seeded with
   `status='unconfigured'`. The endpoint resolver rejects it. There is
   no admin UX surface that flips it to `active`.
4. The 503 error message told the operator to run a docker command —
   directly violating the `never-ask-user-to-run-commands` commandment.
   The message itself hid in a button tooltip the user never hovered.

The combined effect: on a fresh `docker compose up` install, voice input
is non-functional for ~99% of operators and the failure mode is silent.

Slice 1 + Slice 2's "complete" status was a misclaim grounded in
structural evidence (code in bundle, route responds 4xx, tests pass)
without functional verification (real audio → transcript appears in the
textarea). This slice corrects the gap.

## 2. Goal

**A fresh `docker compose up` on commodity hardware produces a working
mic button within ~60 seconds of startup, without the operator typing a
shell command.**

Concretely:

- CPU sidecar is the default; starts on every install
- Operator clicks the mic in the AI Coworker panel, speaks, clicks
  again, transcript appears in the message textarea
- No `[Enable]` click required for the happy path
- NVIDIA-GPU installs auto-detect at install-time and upgrade to the
  CUDA image; this is opt-in via a one-click admin action (not a default)
- Hosted-provider option (Groq / Deepgram / AssemblyAI) is available
  through the standard provider-add flow but is NOT required for the
  happy path

## 3. Decision

Implement the **3-tier hardware ladder** anchored on a CPU default:

### Tier 1 — Default (CPU)

- Image: `hwdsl2/whisper-server` pinned to a sha256 digest at compose
  time (the digest is updated in the compose file via the deps-current
  practice; `latest` is never trusted unpinned for shipping).
- Size: ~190 MB image + ~145 MB `base` model pulled on first start.
  Models cached in `dpf_stt_models` Docker volume so subsequent restarts
  are warm.
- API: native OpenAI `/v1/audio/transcriptions` (verbose_json with
  segments) and `/v1/models` for healthcheck. Matches what
  `transcription-adapter.ts` already POSTs.
- Multi-arch: `linux/amd64` + `linux/arm64`. Works on Apple Silicon
  dev machines too.
- Compose profile: NONE. Service starts on default `docker compose up`.
- Provider config: `speaches` seed row keeps `providerId` for backward
  compat (no schema change needed) but `name` is updated to "Local STT
  (whisper-server)" and `baseUrl` is `http://dpf-stt:9000`.

### Tier 2 — Upgrade (GPU)

- Same compose service `dpf-stt`, but image swapped to
  `ghcr.io/speaches-ai/speaches:latest-cuda` (or a pinned equivalent)
  via `DPF_STT_IMAGE` env var.
- Activated by **one admin click** in Platform Tools > Communications >
  Speech-to-text → "Upgrade to GPU" button. The button:
  - Confirms NVIDIA is detected via the existing hardware-detection
    snapshot (`Organization.hardwareProfile.gpuName`)
  - Sets `DPF_STT_IMAGE` in a portal-managed `.env` overlay
  - Recreates only the `dpf-stt` container, leaving the rest of the
    stack untouched
  - Surfaces "GPU upgrade complete" + new latency expectation
- If NVIDIA is NOT detected, the button is hidden (not disabled). No
  shell suggestion for installing NVIDIA drivers — that's outside the
  operator's responsibility.

### Tier 3 — Hosted (Groq / Deepgram / AssemblyAI)

- Same provider-add flow as chat LLMs. Admin connects via OAuth or API
  key in Platform Tools > AI Operations > Providers & Routing. No
  voice-specific UX deviation.
- When a hosted transcription provider is connected AND has a higher
  routing score than the local sidecar, transcription requests route to
  it automatically per the existing `EndpointTaskPerformance` ordering.
- The Slice-1 `classifyBiasPrompt` gate already strips off-org-unsafe
  tokens for off-org dispatch. No new gating work.

## 4. Acceptance criteria (functional, not structural)

**The slice is not complete until ALL six are observed on the live
install:**

1. Fresh `docker compose up` (no profile flags) brings up `dpf-stt`
   alongside the other services. Healthcheck goes green within 60 s of
   the first request.
2. `ModelProvider.status` for `speaches` (or the renamed equivalent) is
   `active`, not `unconfigured`, **without any admin action**. The
   portal-init seed or a startup probe is responsible for the flip.
3. Operator opens the AI Coworker panel, clicks the mic, the browser
   prompts for permission (first time only), records "the quick brown
   fox jumps over the lazy dog", and clicks the mic again.
4. The transcript "the quick brown fox jumps over the lazy dog" (or a
   reasonably-close approximation — STT isn't perfect) appears in the
   message textarea within 5 s of clicking stop.
5. The route writes a `BackupRun`-equivalent telemetry signal via the
   existing inference telemetry (Slice 1 invariant). Inspect
   `AdapterRunTelemetry` and find a `transcription` row.
6. If the operator turns off the dpf-stt service (manually, only for
   testing): the mic button shows a red inline error banner with the
   text "Speech-to-text isn't ready. Restart the portal or check the
   service in Platform Tools > Communications" — **no shell command in
   the copy.** (#747 already ships the banner; this slice ensures the
   copy stays commandment-compliant.)

Verification of these criteria is the LAST step before the PR is
opened, run by the agent on the live install. Per the
`structural ≠ functional` memo, the PR description must include the
actual happy-path execution log, not just "tests pass."

## 5. Out of scope

- TTS (text-to-speech). Slice 4 in the parent spec.
- Streaming partial transcripts. Slice 4.
- Mobile mic surface. Slice 4.
- Inbound voice on the communication fabric. Slice 3, fabric-blocked.
- Admin UI for swapping the underlying model (e.g. base → small.en).
  Operator can override via env var; no UX for it yet.
- Restarting `dpf-stt` from the admin UX when it's unhealthy. Out of
  scope; portal-restart sweeps it.

## 6. Open questions

- **What sha256 digest do we pin?** Whatever the latest `linux/amd64`
  manifest digest is at the time of implementation; recorded in a
  comment next to the image line so future bumps are deliberate.
- **What happens on cold-start when the model is downloading?** The
  first request after `docker compose up` takes ~10–30 s while the
  model downloads. The mic button shows "Transcribing…" the whole
  time, then succeeds. Acceptable for v1; revisit if support tickets
  arrive.
- **GPU upgrade reversibility?** One-click downgrade button to flip
  back to CPU. Tracked as Slice 1.6 follow-up; not in this slice.

## 7. Recommendation

Approve and ship as a single PR. The user explicitly chose the CPU
default in the question dialog 2026-05-17 19:00 UTC. Implementation is
small (compose file change + provider status flip + Enable button is
deferred). Functional verification is the long pole — pulling the
image, downloading the model, exercising the end-to-end mic path —
which is exactly the verification posture the `structural ≠ functional`
memo requires.
