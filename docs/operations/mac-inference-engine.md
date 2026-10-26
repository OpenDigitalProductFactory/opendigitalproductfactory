# Maintained Mac inference engine candidate

BI-86B65F35 / WC-06E454C7 owns this package repair. The [design](../superpowers/specs/2026-10-26-mac-metal-engine-package-design.md) and [plan](../superpowers/plans/2026-10-26-mac-metal-engine-package-plan.md) define its acceptance.

## Why this package exists

Docker's installed b9879 Metal engine can select Metal 3.2 when its executable was linked against an older SDK. On the observed M5 Max, its optional tensor self-test fails even though the same kernel compiles and creates a pipeline when Metal 4 is explicitly selected. This package applies that language selection at both upstream runtime compilation sites, only when the existing device capability is true. It retains upstream capability detection and failure fallback.

A successful shader control establishes the acceleration path, not a workload speedup. The current video transcript's results are external measurements. Compare this install only with matched model, context, cache state, settings and completed outputs.

## Build and provenance

The source lock is `tools/mac-inference/engine.lock.json`. It pins llama.cpp commit `72874f559c598b8f89fbb24864868337cf5afb4c`, the archive, the original Metal source and the checked patch. The builder refuses changed hashes, occupied destinations, protected installation paths and output inside a Git checkout. It builds ARM64 with a macOS 13.3 minimum, portable CPU selection, Metal and embedded shader source. Both UI build and prebuilt UI download are disabled; it does not fetch mutable UI assets.

An agent runs the native build under the existing governed host-resource runner. The operator does not run commands. Example for an admitted build, using verified local paths:

```sh
node scripts/host-resource-runner.mjs --class docker-build -- \
  node tools/mac-inference/build-engine.mjs \
  --archive /absolute/path/to/pinned-source.tar.gz \
  --cmake /absolute/path/to/cmake \
  --sdk /absolute/path/to/MacOSX.sdk \
  --out /absolute/path/outside-git/dpf-engine-candidate --jobs 4
```

The output contains server, benchmark, their built libraries, license notices and a file manifest. Embedded vendor header notices are retained alongside standalone license files; the bundled JSON library's SPDX copyright and complete MIT permission text are included explicitly. Staged library search paths are relocated to the package. Local binaries receive ad hoc signatures. The separate archive hash identifies its actual bytes; it is never Docker's vendor digest.

The builder records compiler, SDK, minimum OS, CMake and flags. The initial qualification build used AppleClang 21, SDK 15.4 and CMake 4.4.4. CMake's downloaded vendor archive was checked against its published digest before use. Reproducible source inputs and a file manifest do not establish byte-for-byte reproducible builds, distributor identity, notarization or a trusted source-to-binary attestation. A maintained distribution must provide those release assurances before fleet adoption.

Run the inexpensive source checks and file verifier:

```sh
node --test tools/mac-inference/engine-package.test.mjs
node tools/mac-inference/verify-package.mjs /absolute/path/to/candidate
```

Verification rejects corrupted or extra payloads, unsupported identities, path escape, unsafe links, missing executables, the pinned 26 required runtime-library files and link names (including Metal and server/benchmark implementations), and a manifest that self-asserts model qualification. Required libraries must resolve to safe in-package ARM64 payloads, even if someone removes both a library and its manifest row. File/header checks remain distinct from actual native loading and model qualification. Verification proves self-consistency against the pinned package contract; obtain release artifacts through an authenticated distribution channel.

## Qualification and maintenance window

The qualifier requires the exact active, canonically bound `local-integration-ci` lease owned by this chat and branch. The server grants a short renewable hold even when a longer duration was requested. The existing shared lease supervisor renews on the granted schedule and fences owned test execution on lost authority; an overall nine-minute experiment bound remains. Cleanup/restoration precedes the owning agent's visible release. A queued reservation is not permission to start inference. Supply the canonical host-pressure measurement when requesting admission; missing measurements deliberately fail closed. Never open another claim to work around a queued one. Cancel an obsolete wait through its exact lease identifier and respect any approval boundary.

During the active reservation DPF defers new local-provider dispatch. Existing inference must drain according to Docker's actual activity response before the comparison. Docker Model Runner v1.2.8 declares both `in_use` and `loading` as Go booleans with `omitempty` in `pkg/inference/scheduling/api.go`: false fields are absent on idle rows. The qualifier decodes that verified contract only for identified backend/model/mode status rows and records which fields were omitted. Malformed or busy activity capture does not authorize unloading. Unknown objects never become idle merely because fields are absent.

The qualifier first builds the standalone f16 tensor control with the selected older SDK and checks explicit Metal 4 pipeline creation and unchanged fallback language. It then runs the actual built engine's version/device controls and initializes the package's actual Metal library through the pinned public backend API. This exercises that library's f16/bfloat self-tests without model weights and captures its tensor-capability result directly. Server argument/log initialization can hide early device INFO messages; the absence of a server log line is insufficient evidence of disabled tensor support. An explicit loaded-server rejection still fails qualification. Physical M1–M4 and older macOS runs remain separate required compatibility evidence before those targets are recommended.

For model qualification, provide the actual GGUF and OCI manifest paths, Docker model reference and OCI digest, any required projector path, candidate package, selected SDK, management endpoint, active lease and a new report path. The tool validates the raw OCI manifest digest and binds the actual GGUF hash and size to its single supported GGUF layer. If the model has a projector, its hash and size must match the OCI projector layer too; the candidate receives that same projector. A matching alias or tokenizer is insufficient. It runs arithmetic, forced tool-call formatting, approximately 32K-token cold input and a faithful warm continuation. Diagnostic thinking is disabled only for these controls; live provider settings are untouched. Metadata includes completion/format correctness, token counts, cache observation and timing. Prompts, reasoning and raw model responses are not saved.

Only after existing Docker requests complete and activity is idle does the qualifier unload the model through Docker's supported command. It records the restoration obligation before unload, because acknowledgement can fail after the command takes effect. It then starts Docker's supplied engine binary as an owned isolated process on the reserved loopback port, completes the baseline controls and stops that process. The corrected engine follows sequentially on the same port.

Both engines receive identical explicit arguments: context 131072, four unified-KV slots, GPU layers 999, nine generation and batch threads, batch and microbatch 512, flash attention on, f16 K/V caches, no mmap, the same model/projector and Jinja processing. The baseline binary's independently measured SHA256 is required. Each engine's actual properties must confirm the effective context, slots and model path. A current Docker-service request cannot silently serve as this controlled baseline; its own settings are unchanged and its workflow qualification remains separate.

The tool stops only its owned test process, then restores Docker with a bounded synthetic completion and reports restoration failures explicitly. An error after unloading also attempts restoration while the same lease is valid. Release the exact reservation after verification or a blocked attempt.

`model-smoke-qualified` requires eight correct completed controls, observed cache reuse on both engines, matching cold prompt counts and confirmed Docker restoration. It is not a fleet-performance or full-platform-workflow qualification. The recorded prefill ratio is comparable only when controlled runtime properties, cold prompt counts, observed cold-cache counts and positive timings match the comparison contract. An optional baseline report may reuse completed, restored baseline controls from the same device/package/model/binary/profile within one hour. Its report hash and separate-window limitation are recorded. A versioned workload record binds the specification, exact context construction and cold-message content hash; the candidate reconstructs those exact messages before using old timing data. Legacy reports missing workload identity are refused. Mismatched, malformed, incomplete or stale evidence is refused before unloading. Candidate token counts/cache/timings still have to match the comparison contract. One cold sample per engine is an initial observation, not a statistical performance guarantee. An incomplete run, missing timings, truncated output or unmatched input cannot establish a speedup.

## Activation, rollback and AI Ops

The package is an isolated candidate, not an installed Docker replacement. Do not overwrite `~/.docker/bin/inference`, modify vendor executable headers, reuse vendor digests, change provider routing or manually build a DPF live image. Integration needs an explicit supported installer/runtime contract, authenticated release artifacts, compatibility evidence and canonical release controls. DPF live advances use `request_self_upgrade`; a package build does not authorize a live advance.

Before activation, rollback consists of stopping the owned test candidate, restoring Docker if the test unloaded it, releasing the test reservation and keeping the package marked unqualified. Preserve failed/incomplete reports. After a future supported activation, rollback must select the previously verified package through the same supported integration path.

AI Ops' existing learning is DOC-B39A42F1, linked to BI-IMP-AE7792A0 / IP-89CEE. Append actual package identities, native controls, matched results and compatibility limits there. Keep built, model-qualified, distributed and activated states distinct. Monitor tensor fallback recurrence and completed-request evidence; do not infer success from dispatch counts or old retained logs. No duplicate scheduler or improvement item is required.

## Recorded initial candidate

The initial native build succeeded on October 25, 2026 Chicago time, using SDK 15.4 to retain the affected default-language conditions. Its package version is `b9879-dpf-metal4.1`, with 30 verified files. Archive SHA256: `c0372bbaff1979aba6d1951d3614134d5aa375d07e28521024ba013b714d414d`. Manifest SHA256: `ffea216438963f5c3d8ec19a220fe81c8d08b3903ab1c8d137b3b7fa6136f2c8`.

At this checkpoint the built candidate has not been executed or installed. Native engine controls, model performance comparison, older physical Mac coverage, protected source delivery and fleet activation are unrun. The first build attempt failed because disabling UI compilation alone still permitted a mutable UI download; disabling the prebuilt UI download resolved that build failure. Source regression tests are separate from runtime acceptance.

## Qualification progress on October 25, 2026 (Chicago)

Two coordinated baseline runs completed all four correctness/format/cache controls. The traced run processed 32011 cold prompt tokens in 171665.562 ms; the warm follow-up reused 32015 tokens and finished in 623.132 ms. The earlier cold run took 173119.09 ms. These are baseline observations, not a corrected-engine speedup. Docker restoration was confirmed after both runs.

The candidate's early tensor INFO output was not captured by the server-level log checks, so those comparisons remained incomplete. A direct packaged-library initializer subsequently reported f16/bfloat tests and tensor support, but that short diagnostic was mistakenly launched after a refused renewal. It is uncoordinated evidence and cannot qualify the package. It exited without loading model weights or changing Docker files/configuration. Repeat that control under genuine admission before accepting candidate performance. Never launch a dependent native operation unless the preceding admission/renewal succeeded; an expired reservation may already belong to another worker.

The operator-supplied [video transcript](https://www.youtube.com/watch?v=x_qmqqp6d7s) cites roughly 40 seconds for a 32K cold read on an M5 Max/27B setup. That is an external workload claim, not this installation's result. Current measured baseline is about 172 seconds; the gap remains until the corrected package completes its matched controls. Full-platform request correctness, physical older-Mac coverage, protected publication and activation remain separate unfinished outcomes.

## Fresh model control result — 2026-10-26 03:26 UTC

The admitted, supervised workload-v1 run completed all eight model controls correctly and restored Docker. The package's actual public Metal backend initializer reported successful f16/bfloat tests and tensor capability. The matched 32011-token cold input took 173016.605 ms in Docker's supplied engine and 91380.104 ms in the corrected candidate: an observed 1.893x prefill ratio (about47% less prefill time). Both warm continuations reused32015tokens and finished in about0.7seconds. Short arithmetic latency was higher on the candidate; decode throughput was similar. This is one completed sample per engine under the declared native profile, not a general latency or fleet guarantee.

The current candidate is model-smoke-qualified on this M5 Max. It is not installed, authenticated for distribution or physically qualified on older Macs. The video transcript's approximately40second cold-read claim is still faster than this observed91second result; that remaining gap is not closed by this package test. The subsequent source-only required-library completeness fix does not change any native package bytes, model inputs or measured configuration. Re-verify the same manifest against the stronger file contract and reuse the recorded native run rather than repeat identical inference solely for that verifier change.
