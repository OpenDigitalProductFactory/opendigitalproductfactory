# Plan — Voice Slice 1.5: Default-on CPU sidecar

> Spec: `docs/superpowers/specs/2026-05-17-voice-input-slice-1-5-default-on-cpu.md`
> Branch: `feat/stt-cpu-default-on` (off `origin/main`)
> Kernel: `never-ask-user-to-run-commands` + `structural ≠ functional`

## Pre-Implementation Gate

1. Spec approved.
2. PR target: `main`. DCO `-s`.
3. **Functional verification is the gate, not just CI.** No "Done" until
   an actual mic recording produces a transcript on the live install.
4. PR #747 (inline error banner + commandment-compliant copy) is already
   in flight; this PR is additive and doesn't conflict.

## Reality Check

- The portal already has `/var/run/docker.sock` mounted, so it CAN drive
  docker. But auto-restarting `dpf-stt` from portal code is out of scope
  for this slice — the compose default-on posture is enough.
- Provider `status` is the gate that `endpoint-resolution.ts` enforces.
  Two paths to flip it:
  (a) Seed it as `active` and let healthcheck failures degrade it
  (b) Have a startup probe that pings the sidecar and flips status
  Decision: **(a)** for simplicity. The endpoint resolver also requires
  `modelStatus='active'` and that's already true. If the sidecar is
  down, the route will throw `InferenceError("network")` which is
  surfaced to the user via the Slice 2 inline banner. The same banner
  fires whether status is `unconfigured` or whether the sidecar is
  unreachable.
- The hwdsl2 image takes `WHISPER_MODEL` env (default `base`,
  ~145 MB). For Slice 1.5 we ship `base` — it's the smallest model that
  achieves usable accuracy on English. Faster-whisper `tiny.en` is
  smaller but materially worse quality.

## Scope

In:
- `docker-compose.yml` — drop the `stt` profile gate, swap to
  hwdsl2/whisper-server pinned by digest, add `dpf_stt_models` volume,
  remove the `${DPF_STT_IMAGE:-}` GPU-default default value but keep
  the env hook for future GPU upgrade
- `.env.docker.example` — document `DPF_STT_IMAGE` as the GPU-upgrade
  override (no longer the default-on hook)
- `packages/db/data/providers-registry.json` — flip seeded `speaches`
  provider `status` from `unconfigured` to `active`, rename to
  "Local STT (whisper-server)" for accuracy
- `packages/db/src/seed-provider-registry.ts` (or wherever the provider
  seed lives) — verify the rename propagates idempotently
- Functional smoke test: synthesized 5-second WAV → POST
  `/api/transcribe` → confirm `text` field is populated

Out:
- Enable / Upgrade-to-GPU button in SpeechToTextCard (separate slice)
- Auto-restart of sidecar from portal (separate slice)
- Multi-model UX in admin (separate slice)
- TTS, streaming, mobile mic (Slice 4)

## Chunk 1 — Compose + env

1. Find current pinned digest for `hwdsl2/whisper-server:latest`
   `linux/amd64` and record it in compose file.
2. Update `docker-compose.yml`:
   - Remove `profiles: ["stt"]`
   - Image: `${DPF_STT_IMAGE:-hwdsl2/whisper-server@sha256:<digest>}`
   - Env: `WHISPER_MODEL=${DPF_STT_MODEL:-base}`
   - Volume: `dpf_stt_models` mounted at `/app/models` (or whatever the
     hwdsl2 image documents)
   - Healthcheck: `curl -fsS http://localhost:8000/v1/models`
     (already roughly correct; just confirm path)
   - Port: keep `127.0.0.1:8765:8000`
3. Update `.env.docker.example`:
   - Reframe `DPF_STT_IMAGE` as "override to upgrade to GPU"
   - Add a comment block explaining the 3-tier ladder
4. Verify with `docker compose config` that the rendered config is
   sound.

**Exit:** `docker compose up dpf-stt` (no profile) pulls + starts the
container; healthcheck eventually green.

## Chunk 2 — Provider seed: status=active by default

1. Inspect `packages/db/data/providers-registry.json` (or equivalent
   seed source) to find the `speaches` row.
2. Flip `status` from `unconfigured` to `active`.
3. Rename `name` from "Speaches (local STT sidecar)" to "Local STT
   (whisper-server)" for accuracy.
4. Keep `providerId='speaches'` and `baseUrl='http://dpf-stt:8000'` to
   avoid touching `ModelProfile` / `EndpointTaskPerformance`.
5. Update the live install's existing row via a one-shot SQL command
   to match (idempotent — the next seed run will see no drift).
6. Run the seed and verify the row has `status=active`.

**Exit:** Endpoint resolver returns a `speaches` endpoint on first
call (no admin action required).

## Chunk 3 — Live functional verification

1. Recreate the `dpf-stt` container with the new image and config.
2. Wait for healthcheck green (will include first-time model download
   — could be ~30s).
3. Synthesize a test audio fixture inside the portal container using
   `ffmpeg` or `espeak` + ffmpeg. A 3-second WAV containing "hello
   world testing speech recognition" is enough.
4. POST it to `http://localhost:3000/api/transcribe` with
   `context=test_harness` and verify the response JSON has a non-empty
   `text` field that approximates the spoken phrase.
5. Inspect `AdapterRunTelemetry` for the corresponding row.
6. Drive the **actual mic button** via Chrome MCP if feasible: open
   `http://localhost:3000`, log in, click the mic, record a phrase,
   stop, observe textarea population.
7. Document the verification log in the PR body — paste the actual
   transcript and route response, not just "tests pass."

**Exit:** Six acceptance criteria from spec §4 all observed.

## Chunk 4 — PR

1. Stage compose + env + seed changes.
2. Write a PR description that includes the live verification log.
3. Open PR.

## Tests

- The compose render policy CI will catch any drift in the compose
  block (already exists from the worktree-hygiene work).
- No new unit tests needed — the integration test surface is the
  live install verification.
- The route's architecture test (Slice 1 chunk 2) still passes
  because we haven't changed the route contract.

## What this slice deliberately leaves out

- Auto-detect-and-upgrade-to-GPU flow. Hardware detection ALREADY
  happens at install time (host profile captures `gpuName`); wiring
  the SpeechToTextCard to show a conditional "Upgrade to GPU" button
  is Slice 1.6.
- Restart-on-failure for the sidecar. The compose `restart: unless-stopped`
  policy already handles container crashes; what we don't yet handle
  is the model-download path's transient failures. Tracked as a
  follow-up.
- A nicer first-request experience (currently 10–30s while model
  downloads). Future work could pre-warm via portal-init.

## Recommended execution path

1. Chunk 1 → commit `feat(voice): default-on CPU STT sidecar (drop stt profile, swap image)`
2. Chunk 2 → commit `feat(voice): seed STT provider active by default`
3. Chunk 3 → live verification + push commits + run smoke
4. Chunk 4 → open PR with verification log

Single PR. Single branch. End-to-end functional acceptance.
