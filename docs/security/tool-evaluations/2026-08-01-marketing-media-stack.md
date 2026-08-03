# Marketing media stack — candidate evaluation

**Backlog:** `BI-0C891AC7`
**Evaluation date:** 2026-08-01
**Decision state:** Preliminary recommendations; final `ToolEvaluation` approval gates remain open

## Executive disposition

| Candidate | Exact candidate | Pipeline record | Recommendation | Intended role |
| --- | --- | --- | --- | --- |
| HyperFrames | `0.7.87` | `cmsb7dhyr06z601tcngsqzwyg` | **Conditional experiment; deterministic condition failed** | Sandboxed asynchronous composition with mandatory human preview |
| FFmpeg | `8.1.2` upstream source; deployed build must be fingerprinted separately | Existing platform substrate; no duplicate proposal | **Conditional substrate; probed distribution rejected** | Encode, mux, probe, normalize, captions burn-in |
| Remotion | `4.0.477` | `cmsb7di0k06z801tchoxt09nr` | **Reject as DPF default; conditional alternative** | Optional operator-licensed React renderer only |
| Gemini 3.1 Flash TTS Preview | `gemini-3.1-flash-tts-preview` | `cmsb7di2h06za01tcrkp1q1jz` | **Conditional cloud candidate** | Expressive narration when local TTS does not meet the quality bar |

These are recommendations for the pipeline reviewers, not approval substitutions. No candidate from this evaluation may enter `packages/db/data/approved_tools_registry.json` until the existing human approval gate records an approved or conditional verdict.

## Selection architecture

DPF should use a composable stack rather than one vendor suite:

1. A marketing asset task supplies approved copy, brand tokens, source media, and accessibility requirements.
2. The vendor-neutral media contract selects only a provider with active evaluation posture, an approved environment, and every required capability.
3. An approved renderer performs composition in a sandbox. Determinism is a separately proven capability of an exact stack, never inferred from the renderer name.
4. Local TTS is preferred; an evaluated cloud TTS conduit may supply narration when quality or language coverage requires it.
5. FFmpeg performs the exact pinned encode/probe step.
6. Captions and provenance are policy requirements, not best-effort decorations. A provider that cannot supply them returns `UNSUPPORTED_OPERATION`; callers either compose an approved secondary step or refuse publication.

This keeps generated-media providers replaceable and prevents a video vendor from becoming the marketing system of record.

## Evaluation criteria

Each candidate was assessed for commercial licensing, version pinning, supply chain, arbitrary-code execution, privacy and retention, data egress, determinism, offline operation, cost/latency, captions/accessibility, safety/moderation, provenance/watermarking, and rollback.

### HyperFrames 0.7.87 — conditional

**Evidence**

- The project describes HTML/CSS/media-to-video rendering through headless Chrome and FFmpeg, with frame seeking intended to make the same input produce the same frames/output: <https://github.com/heygen-com/hyperframes/blob/main/README.md>.
- Release `0.7.87` is signed and was published 2026-07-31. It bounds website-capture stages and preserves sanitized failure diagnostics: <https://github.com/heygen-com/hyperframes/releases/tag/v0.7.87>.
- The repository is Apache-2.0 with no per-render or company-size threshold: <https://github.com/heygen-com/hyperframes/blob/main/LICENSE>.
- The security policy supports all `0.x` versions, asks for private advisory reports, acknowledges within 48 hours, and targets a mitigation plan within seven days: <https://github.com/heygen-com/hyperframes/blob/main/SECURITY.md>.
- Its own authoring guidance forbids wall-clock and unseeded-random behavior for deterministic compositions: <https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/SKILL.md>.

**Findings**

- `architecture / low` — The HTML-first, non-interactive CLI is a good fit for agent-authored branded templates and keeps the composition inspectable.
- `security / high, mitigatable` — Rendering arbitrary HTML in Chromium executes code. The renderer must run in a container with a read-only composition input, bounded output directory, no host credentials, no Docker socket, no portal network, and explicit network denial unless a reviewed asset fetch is required.
- `supply_chain / medium` — `0.x` signals API churn despite active releases. Pin the exact CLI/packages and resolved FFmpeg/Chromium artifacts; do not use `latest` or runtime `npx`.
- `integration / high` — The deterministic claim must be verified on DPF hardware for the exact Node/browser/renderer stack. MP4 container timestamps can differ even when frames/audio are identical, so the receipt records both byte hashes and normalized media hashes.
- `compliance / medium` — HyperFrames does not advertise C2PA signing as a native capability. Treat provenance as unsupported until a probe proves otherwise; compose a separate approved signing step when required.
- `privacy / low` — Local rendering can avoid provider data egress. Remote website capture and remote asset URLs are separate capabilities and remain disabled by default.

**Conditions**

- sandbox-only execution; no broad host filesystem or credential mounts;
- exact `0.7.87` pin and dependency lock/digest;
- local assets only for the approval probe;
- captions included and contrast/readability inspected;
- advertise deterministic rendering as unsupported and require human preview until a repeatable exact-stack probe passes across independent runs;
- provenance advertised as unsupported until a C2PA step is approved;
- re-evaluate within 30 days while the project remains `0.x`, or immediately on a security advisory/version change.

**DPF probe result**

- The repository-compliant governed probe rendered the same 50-second 1920×1080 composition twice with Node `24`, HyperFrames `0.7.87`, Chrome Headless Shell `152.0.7928.2`, one worker, four CPUs, an 8 GiB limit, vendored locked runtime assets, and no container network. The MP4 and decoded-frame SHA-256 values differed.
- The exact image identity is `sha256:b68dca5087b59fb2b9008d5e2826976eda37218fcb61c246ab45c7dade888bef`; the machine-readable receipt is [`scripts/probes/marketing-media/local-render-receipt.json`](../../../scripts/probes/marketing-media/local-render-receipt.json).
- Each render took about 4.2 minutes. This is an asynchronous job profile, not an interactive portal request path.
- A Node `22` offline evaluation happened to produce identical outputs once, while an earlier network-enabled run and the Node `24` policy-compliant run did not. One passing pair is therefore insufficient evidence of repeatability. Remote runtime loading remains prohibited, but offline assets alone do not establish determinism.
- HyperFrames remains useful for inspectable, human-reviewed marketing compositions. It must not be selected for a request that requires deterministic output until a future exact-stack evaluation proves repeatability across independent runs.

### FFmpeg — conditional existing substrate

**Evidence**

- FFmpeg `8.1.2` is the latest stable 8.1 release (2026-06-17): <https://ffmpeg.org/download.html>.
- FFmpeg is LGPL-2.1-or-later by default; enabling GPL components changes the effective license, and other optional/nonfree components add obligations: <https://ffmpeg.org/legal.html> and <https://ffmpeg.org/doxygen/trunk/md_LICENSE.html>.
- DPF already references FFmpeg for browser/audio-container handling and native-host TTS setup. The Windows host used for this evaluation does not expose `ffmpeg` on `PATH`, so the governed renderer must provide its own pinned binary rather than relying on an ambient host install.

**Findings and conditions**

- Do not add a second wrapper or provider model. FFmpeg is a build/runtime component behind the renderer.
- Record `ffmpeg -version`, the configure string, binary/source origin, and digest in every approval probe.
- Approve only the codecs/options DPF actually needs. Unknown, GPL, or nonfree configure posture is a failed licensing check, not an advisory.
- Treat output metadata normalization separately from frame/audio determinism.
- Re-evaluate the exact distribution, not only the upstream version number.

**DPF probe result**

The evaluation image resolved `ffmpeg-static@5.3.0` to FFmpeg `7.0.2-static` with `--enable-gpl`, `--enable-libx264`, and `--enable-libx265`; the binary SHA-256 and full configure string are captured in the render receipt. That exact distribution fails the proposed licensing condition and must not become the DPF default. It is retained only as a reproducible evaluation component. Approval requires a separately fingerprinted LGPL-compatible distribution with only the reviewed codec surface.

### Remotion 4.0.477 — reject as default; conditional alternative

**Evidence**

- The official repository identifies `4.0.477` as the current release and describes a React-based programmatic renderer: <https://github.com/remotion-dev/remotion>.
- The license is free for individuals and companies up to three people. Companies of four or more require a company license; automated rendering is priced per render with a monthly minimum: <https://www.remotion.dev/docs/license/pricing>.

**Findings**

- `architecture / medium` — Remotion is mature and production-proven, but React/bundler authoring adds machinery when DPF already produces HTML/CSS and needs a small-business install path.
- `compliance / high, mitigatable` — DPF cannot represent Remotion as an unrestricted open-source platform dependency. Team size, automation mode, and commercial terms must be checked per install/use.
- `integration / medium` — It remains a viable operator-selected alternative where an organization already licenses it and needs its ecosystem/Lambda maturity.

**Disposition boundary**

Reject Remotion as the default DPF dependency and do not add it to the community approved-tool registry under a blanket commercial condition. A future organization-scoped integration may receive a conditional verdict with proof of license and the same sandbox/provenance requirements.

### Gemini 3.1 Flash TTS Preview — conditional cloud candidate

**Evidence**

- Google documents Gemini 3.1 Flash TTS Preview for single- and multi-speaker, controllable speech generation. TTS is explicitly a preview capability: <https://ai.google.dev/gemini-api/docs/speech-generation>.
- Gemini API unpaid services may use submitted/generated content for product improvement and human review; paid services do not use prompts/responses for product improvement and are covered by the data-processing terms, though safety logging and global transient processing remain: <https://ai.google.dev/gemini-api/terms>.
- Google states that its Gemini audio model outputs carry SynthID watermarks: <https://deepmind.google/models/gemini-audio/>.
- The model card documents intended usage, limitations, and safety evaluation for Gemini 3.1 Flash Audio: <https://deepmind.google/models/model-cards/gemini-3-1-flash-audio/>.

**Findings**

- `integration / medium` — Expressive direction, audio tags, and multi-speaker output are valuable for ads, explainers, and short-form narration.
- `privacy / high, mitigatable` — Only a paid, billed project is acceptable for business inputs. No customer PII, confidential strategy, voice-cloning source, or unpublished regulated content enters the probe.
- `architecture / medium` — Generated speech is stochastic. Cache approved output as a governed asset; never promise byte-identical replay from the same prompt.
- `provenance / medium` — SynthID is a valuable invisible watermark but is not a C2PA Content Credential and does not replace signed edit history.
- `operational / high, mitigatable` — Preview aliases, limits, pricing, and behavior may change. Capability discovery must fail closed and the model id must be recorded with each receipt.

**Conditions**

- paid-tier project only; synthetic/non-sensitive approval copy;
- explicit consent and separate evaluation before any cloned or person-imitating voice use;
- cache the selected WAV and preserve prompt/model/request hashes;
- captions are generated from the approved script and verified against final audio;
- mark output as AI-generated and retain SynthID; add C2PA separately when policy requires signed provenance;
- bounded timeout/retry/cost ceiling; no silent fallback to unpaid quota;
- re-evaluate in 30 days or when the preview model alias changes.

## Provenance baseline

C2PA 2.4 is the current Content Credentials specification family and defines interoperable signed provenance for media: <https://spec.c2pa.org/specifications/>. Watermarks and C2PA solve different problems. Provider watermarks may help identify generation origin; Content Credentials record signed creation/edit history. DPF's contract therefore exposes `provenance` independently and must not infer it from a watermark claim.

## Discovery-channel note

The local Smithery CLI was not installed, so registry discovery could not be performed through that channel. No CLI or MCP server was installed as a workaround because discovery tooling itself must be evaluated. Official repositories and vendor documentation were used for this pass.

## Approval and probe work still required

- Run the six-perspective Tool Evaluation workflow and record findings/verdicts in the three live records.
- Resolve or explicitly accept HyperFrames timeline nondeterminism before advertising deterministic rendering support.
- Replace the GPL-enabled evaluation FFmpeg distribution with a separately reviewed LGPL-compatible build before any production approval.
- Produce the paid-tier, non-sensitive Gemini TTS receipt or an honest `blocked_external_configuration` receipt.
- Update the approved-tools registry only for candidates that clear the approval gate.
