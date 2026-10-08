# Tool Evaluation: travisvn/chatterbox-tts-api v1.0.1 (dpf-tts re-pin)

**Backlog item:** `BI-E2763038`
**Decision:** conditional approval
**Risk:** medium
**Confidence:** 0.7. The API contract was read from upstream source. Synthesis has not been run against the new image on a Linux NVIDIA host.
**Re-evaluate after:** 2027-04-07, when upstream publishes a new image (Chatterbox Turbo support has been "coming soon" on upstream `main` since 2025-12-23), when a pinned digest stops resolving, or after any security advisory against FastAPI, python-multipart or PyTorch in the image.

`dpf-tts` is the self-hosted voice-cloning sidecar under `runtime:local-speech`. Compose pinned it to `travisvn/chatterbox-tts-api:v0.1.0`, and the publisher has deleted that tag (`docker buildx imagetools inspect` returns `not found`, 2026-10-07). As a result, no install can create `dpf-tts`. This evaluation covers the move to the only images still published.

## What is evaluated

The following was inspected on 2026-10-07 with `docker buildx imagetools inspect`. All variants carry `org.opencontainers.image.revision=13611fd4047284607fb8a636340f5714cbad8b41`, the upstream `v1.0.1` tag (2025-06-03), and `org.opencontainers.image.licenses=AGPL-3.0`.

| Tag(s) | Index digest | Platforms | Compressed size | Build |
|---|---|---|---|---|
| `gpu`, `latest` | `sha256:8c0b379172d48b49d59d8f29a35fa23c0dc27955dba4d3ab41a77b2d71b4711f` | linux/amd64 only | ~8.25 GB | `docker/Dockerfile.dockerhub`: `nvidia/cuda:12.4.1-runtime-ubuntu20.04`, torch 2.6.0+cu124, `DEVICE=auto` |
| `1.0.1`, `cpu` | `sha256:900e5ae19e69e8dcce9e1f97b2f047b6a6e9190cd653c1c3c907de2113d8c494` | linux/amd64 (~1.28 GB), linux/arm64 (~1.08 GB) | see platforms | `docker/Dockerfile.dockerhub.cpu`: `python:3.11-slim`, torch 2.6.0 CPU, `DEVICE=cpu` |

No GPU build carries a version tag. The upstream publish workflow (`.github/workflows/docker-hub.yml` at `v1.0.1`) tags the CUDA build only `latest` and `gpu`, and tags the CPU build `cpu` plus the semver tags.

**Chosen pin:** `travisvn/chatterbox-tts-api:gpu@sha256:8c0b3791…` (the tag names the variant and the digest carries identity). The compose service keeps its NVIDIA device reservation, and both installers start `dpf-tts` only after detecting an NVIDIA GPU with at least 6 GB of VRAM (`install-dpf.sh` step 10b, `install-dpf.ps1`). The default therefore has to be the CUDA build. The CPU build, pinned as `1.0.1@sha256:900e5ae1…`, is the documented Tier 1 override, and an operator using it must also drop the reservation.

## API compatibility (source read at upstream tag `v1.0.1`)

| DPF caller | Upstream at v1.0.1 | Result |
|---|---|---|
| `adapters/chatterbox.ts` with a reference clip: `POST /v1/audio/speech/upload`, multipart `input`, `response_format=wav`, `voice_file` named `reference.wav` | `app/api/endpoints/speech.py`: `@router.post("/v1/audio/speech/upload")`, `input: Form(min_length=1, max_length=3000)`, `voice_file: UploadFile`, extensions `{.mp3,.wav,.flac,.m4a,.ogg}`, 10 MB limit, temp file removed in `finally`, returns `audio/wav` | Compatible |
| `adapters/chatterbox.ts` without a clip: `POST /v1/audio/speech` JSON `{model, input, voice, response_format, speed}` | `TTSRequest` (`app/models/requests.py`) accepts `input` (1..3000), `voice`, `response_format`, `speed`. `model` is not declared, and Pydantic's default `extra="ignore"` drops it | Compatible. `voice` and `speed` are ignored upstream ("uses voice sample") |
| `service-status.ts` probe: `GET {DPF_TTS_URL}/health`, which reads `model_loaded` | `app/api/endpoints/health.py`: `GET /health` → `{status, model_loaded, device, config, memory_info}` and no prefix | Compatible |
| Compose healthcheck `curl -fsS http://localhost:8000/health` | Both builds install `curl`. The route is the same | Compatible |
| Compose `PORT: "8000"` | `app/config.py` `PORT = int(os.getenv('PORT', 5123))`, used by `main.py` `uvicorn.run(port=Config.PORT)` | Compatible |
| Compose `TTS_MODEL: ${TTS_CHATTERBOX_MODEL:-turbo}` | Nothing in v1.0.1 reads `TTS_MODEL`. `app/core/tts_model.py` always loads `ChatterboxTTS.from_pretrained` (the original ~500M model) | **No-op, now removed.** The old comment's Turbo/VRAM figures did not describe this image |
| Volume `dpf_tts_voices:/app/voices` | v1.0.1 has no voice library. The volume is unused and harmless, and was kept so existing installs do not lose data if a later version adds one | No effect |

## CoSAI security findings

| # | Category | Severity | Finding | Mitigatable? |
|---|---|---|---|---|
| 1 | Authentication | medium | The API has no authentication. | Yes, already mitigated. The port is bound to `127.0.0.1:8766` on the host and reached as `dpf-tts:8000` only on the compose network. |
| 2 | Access control | low | `POST /memory/reset` and `GET /config` are open to anything that can reach the port. | Yes. Same network boundary as #1. |
| 3 | Input validation | low | Text is capped at 3000 characters (HTTP 4xx above that). Uploads are checked by extension and capped at 10 MB. DPF's `/api/voice/synthesize` does not bound text length, so longer narration fails with a provider error instead of chunking. | Yes. Follow-up candidate, not a blocker. |
| 4 | Data/control boundary | info | The service generates audio only. It has no tool calls and no LLM steering. | N/A |
| 5 | Data protection | low | Uploaded reference clips are written to a temp file and unlinked in `finally`. Filenames and byte counts are printed to stdout. | Yes. Logs stay in the install's own logging pipeline. |
| 6 | Integrity controls | medium | The CUDA build has no versioned tag, and the publisher has deleted a tag before. | Yes. The pin includes the digest, and `verify-compose-image-manifests.mjs --only third-party` checks it on every release. |
| 7 | Session/transport | low | Plain HTTP inside the compose network. | Accepted, as for other sidecars. |
| 8 | Network isolation | low | First start downloads the model weights from Hugging Face (`ResembleAI/chatterbox`: `t3_cfg.safetensors` 2.13 GB plus `s3gen.safetensors` 1.06 GB). The cache is not on a volume, so a recreated container downloads them again. | Partly. This was true before the re-pin as well. |
| 9 | Trust boundary | info | No LLM judgment is involved. The portal decides what text is spoken. | N/A |
| 10 | Resource management | **medium** | The compose `memory: 2g` limit is below the ~3.2 GB of fp32 weights that `from_pretrained` loads (sizes from the Hugging Face API). The risk is an OOM kill at model load. This is unverified: synthesis was not run (see below). The limit is unchanged from the v0.1.0 era. | Condition 2. |
| 11 | Operational security | low | Health is `/health` only, with no `/metrics`. Upstream health reports `unhealthy` until the model loads. | Yes. `service-status.ts` bridges it into `dpf_voice_tts_*` gauges. |
| 12 | Supply chain | medium | The images were built 2025-06-03 with an unpinned `chatterbox-tts` (`uv pip install chatterbox-tts`) and `uv:latest`. The repo was last pushed 2025-12-23, which is within the 12-month abandonment threshold but slowing. 686 stars, one maintainer. | Partly. The digest freezes the bytes, and re-evaluation is scheduled. |

No early-termination trigger fired. There are no hardcoded credentials, no known CVSS ≥ 9 issue was found in what was read, the licence is compatible (see below), and the repo has not been abandoned for 12 months.

## Compliance

- **Licence:** the API wrapper is **AGPL-3.0** (repo `LICENSE`, image label). The model package `chatterbox-tts` is MIT (PyPI 0.1.7 metadata). DPF (Apache-2.0) runs the wrapper **unmodified** as a separate container and talks to it over HTTP, so DPF's own code does not become a derivative work. AGPL §13 obligations arise only if DPF modifies the wrapper and offers it over a network. Condition 3 keeps it unmodified. The previous compose comment described the sidecar as "MIT", which was true of the model only.
- **Data residency:** text and reference audio stay on the compose network. The only outbound traffic is the one-time weight download from Hugging Face.
- **Regulatory:** this is voice cloning. Generated speech carries Resemble's Perth watermark (`resemble-perth` is installed in both builds). DPF's existing voice-consent flow for reference clips is unchanged.

## Architecture fit

This is a drop-in replacement. The adapter, health probe, port mapping, healthcheck and capability/profile wiring all keep working. Only the image reference and the no-op `TTS_MODEL` env change. Coupling stays at the OpenAI-compatible `/v1/audio/speech` surface plus the upstream-specific `/upload` multipart route. Moving to another Chatterbox server would mean changing that one adapter.

**macOS requiredServices decision (AC-3):** `dpf-tts` is **not** required on macOS. The catalog already scopes it to `hostPlatforms: [linux, windows]`, and the promoter honours that. The portal's operational projection passed no host, so it listed `dpf-tts` (and the Linux-only `cadvisor`, `node-exporter` and `ollama`) as required on macOS and reported them degraded. That was fixed in the same change: the portal now reads `platform` from `install-state.json`.

## Integration test results

- **Manifest resolution:** both index digests resolve. The `gpu` digest serves linux/amd64 only. The `1.0.1`/`cpu` digest serves linux/amd64 and linux/arm64. `node scripts/release/verify-compose-image-manifests.mjs --only third-party` passes (13 images) with no exception.
- **Synthesis and health against the running image: NOT RUN.** This host is an Apple Silicon Mac without NVIDIA. It is CPU-constrained and runs the live install, and the CUDA image is 8.25 GB. AC-2 therefore remains open until someone exercises it on a Linux NVIDIA host (or the CPU build on any Linux host): `GET /health` → `model_loaded: true`, `POST /v1/audio/speech` and `POST /v1/audio/speech/upload` with a WAV clip → `audio/wav`.

## Conditions

1. Keep the tag+digest pin. Change it only through a new evaluation.
2. Before a Linux GPU install relies on it, run the AC-2 smoke test and measure peak RSS at model load. If it exceeds the 2 GB limit, raise `deploy.resources.limits.memory` and `config/install-resource-budgets.json` together.
3. Run the wrapper unmodified (AGPL-3.0).
4. Do not rely on `TTS_MODEL`/Turbo until upstream ships it in a published image.

## Re-evaluation

- Schedule: 2027-04-07.
- Triggers: a new upstream image or tag; either pinned digest failing the release guard; a CVE against FastAPI, python-multipart, PyTorch or the CUDA base image; upstream licence change.
