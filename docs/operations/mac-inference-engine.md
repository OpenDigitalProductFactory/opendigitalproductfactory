# Maintained Mac inference engine candidate

October 29, 2026 (Chicago), current physical checkpoint: canonical app update
`1f8c111c409a4e8cc3575d118a7a154134791ba9` is healthy with the host action channel
enabled. The supported native installer refreshed the enrolled Mac service and
staged the qualified runtime/report without activating it. The repaired client
certificate is valid, but actual registration returns
`machine_authentication_failed`. BI-2A52F271 repairs both PKI generators: Caddy
2.10.2 applies upstream header insertion before deletion, so combining identity
scrubbing and insertion in one upstream operation removes the verified identity.
Scrubbing belongs in a separate incoming-request middleware before proxy
insertion. Re-enrollment, wider grants and weaker certificate checks do not fix
this defect. Source tests and configuration adaptation remain separate from
successful live registration, engine activation, rollback and useful DPF work.

October 28 live status: PR6612 is merged and its source reached the canonical portal, but the faster native runtime is not active. Docker Model Runner is now1.2.9 while the installed engine executable still hashes to `0e9095b1a9068961682fa60fa101bdcf40e0b1f1e6b0c44c1616c0611c1d4b26`; the portal still routes to `http://model-runner.docker.internal/v1`. BI-CD4EB130 has been reopened for its genuinely unfinished native lifecycle/activation implementation, not for a waived customer acceptance question. The existing design and plan's October 28 amendment records the missing host-control path and the signed-action integration selected in DI-81525BCDC1F7. No live speedup is established by the portal upgrade. AI Ops' existing performance task still reports a required-writer failure; captured learning is not proof that recurring stewardship works.

The native activation path requires a canonical portal release and separate native installer convergence. Its installer opt-in is `DPF_MANAGED_INFERENCE_ENABLED=1`, with an exact published `DPF_MANAGED_INFERENCE_SOURCE_SHA`, `DPF_MANAGED_INFERENCE_RUNTIME_PACKAGE` and `DPF_MANAGED_INFERENCE_RUNTIME_SHA256`, and the retained report path/hash in `DPF_MANAGED_INFERENCE_REPORT` / `DPF_MANAGED_INFERENCE_REPORT_SHA256`. The executing agent supplies these verified artifact bindings through the supported native installer after protected publication and canonical convergence; the operator does not type infrastructure values. The qualification report must retain its producer's private mode (`0600`); staging validates and reads one bounded, no-follow file descriptor before checking its pinned hash. This stages a private controller and a qualification bound to the enrolled host, then replaces the host Edge agent from the same immutable source. It does not activate the engine, edit provider rows or grant the native action automatically. Windows, Linux and unqualified Macs retain their existing path.

The concrete switch/restore control lives in the existing local-provider settings. It requires a current source-owned inference reservation, current global pause ownership, the original model/configuration/profile and an approved human change. Its exact per-node procedure permission is disclosed for either operation when missing; a disabled action channel remains disabled. The signed machine bridge passes the original envelope to the verified controller and refreshes observations of the actual existing reservation, never renewing it by re-signing a proof. Normal local calls resolve the same installer selection for execution and management. Unknown selection or cleanup refuses new requests and another switch.

Keep three identities distinct in evidence: the OCI image/tag digest, the SHA-256 of an executable file, and the inode actually mapped by the serving process. On October 28 the Docker `b9879-metal` OCI digest remained `b70706f473b4043ca3e0c32704a7fda3412b83bceef0564684187b8011230de8`; the file at `/Users/markbodman/.docker/bin/inference/llama-server` hashed to `0e9095b1a9068961682fa60fa101bdcf40e0b1f1e6b0c44c1616c0611c1d4b26`. A fresh file read alone is not fresh mapped-process or performance proof. Retain the historical reports unchanged.

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

The manifest is opened without following its leaf symlink, then checked and read through that same handle. Reads remain bounded to 1 MiB even if the file grows after its size check. Qualification compares Docker's reported model digest to the validated local expectation and records that expectation rather than copying the network response into the report.

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

### Native agent source rollout

The October 28 activation foundations do not register a lifecycle implementation or select the corrected runtime. A portal self-upgrade does not replace a host-native Edge executable. Existing Windows installs receive that executable through the governed native install/repair entry `Install-DPFNativeEdgeNode` in `scripts/installer/native-edge-host.ps1`, called by `install-dpf.ps1`. Existing macOS and Linux installs use `dpf_native_edge_install` in `scripts/installer/native-edge-host.sh`, called by `install-dpf.sh`. These entries stage a replacement and manage the platform's existing supervision; retain enrollment and the previous binary. The executing agent performs the supported repair from verified release source and records its evidence. No operator command is needed to inspect this work.

This is an explicit native install/repair step on Windows, macOS and Linux, rather than automatic portal convergence. Until the complete managed inference procedure is implemented and provisioned, the new action remains unsupported and its node permission remains absent. Keep all three platforms on their current inference selection; only physically qualified Macs may later enter the approved activation procedure. Passing source tests or running the native agent repair alone proves no inference performance gain.

Managed integration is tracked separately by BI-CD4EB130 / WC-C8326144 and its
[runtime design](../superpowers/specs/2026-10-26-mac-inference-runtime-design.md)
and [ordered plan](../superpowers/plans/2026-10-26-mac-inference-runtime-plan.md).
The candidate combines a separately pinned standalone Docker Model Runner with
the unchanged corrected engine. It does not replace Docker's files. The reviewed
runner patch recognizes the upstream binary name, retains the custom engine's
version without advertising a Docker vendor variant, rejects an unavailable
explicit engine, and restricts HTTP and TLS listeners to loopback. Container
reachability, the model-management workflow and supported native convergence
still require actual qualification before activation.

`runtime.lock.json` pins runner source, Go module/sum and patch identities.
`build-runtime.mjs` applies the patch to a fresh verified archive, runs the actual
affected upstream package tests, builds ARM64 without CGO, retains dependency
notices and embeds the verified engine unchanged. Its output remains unqualified.
`verifyRuntimePackage` binds the complete composite payload and refuses altered
or unlisted files and a self-qualified manifest. Neither successful compilation
nor an artifact hash grants activation. Engine evidence can be reused only with
the exact model/device/report and unchanged native bytes; it does not qualify
the new runner or platform workflow.

The stock runner already provides export/load of its OCI model representation;
its own CLI uses that path to materialize a private store. Prefer that supported
path to copying mutable Docker store metadata or downloading/repackaging the
weights under a different identity. Verify the retained OCI digest and tag it
only within the private managed store. Treat export/load and native service
qualification as separately admitted effects, not as a consequence of inspecting
a package.

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

## Managed runner candidate — October 26, 2026

BI-CD4EB130 owns activation and rollback. The standalone runner is pinned to Docker Model Runner 1.2.8 source, with a reviewed custom-engine status/listener patch and a finite native experiment fence. `build-runtime.mjs` produced the 186-file `1.2.8-dpf-metal4.2` candidate; archive SHA256 `1f29d710bb6b7c2ce90b47c7925df4cce74bbe6c748a28c29c5acb4cd9420a32`, manifest SHA256 `b1eabac297026ac07d8a3ebfa9542dcc28e75c49050bc423d5b52215a1d577a8`. The embedded engine files are unchanged. Source tests and a successful build do not qualify this new runner or activate it.

`qualify-runtime.mjs` requires the exact active reserved window, package and baseline identities, prior native engine report and physical GPU match. It stages a private copy under an owned LaunchAgent, transfers existing model artifacts through stock export/load/tag APIs, and copies stored per-model configuration. Model tags retain their case; the model-card capacity and configured runtime context are distinct facts. Here the Qwen model advertises 262144 tokens while its stored runtime context is 131072 tokens.

The qualifier exercises matched arithmetic, tool-call and cold/warm prefix controls through both runners' model APIs, plus a candidate embedding shape/finite-value check. It checkpoints the restoration obligation before unloading Docker, verifies candidate shutdown before restoring Docker, preserves failed reports, and never changes the platform provider. The native daemon independently stops when its projected reservation expires or its finite experiment deadline arrives, even if its client disappears. That private expiry projection contains no credentials and grants no platform authority.

Full DPF workflow/under-load proof, the supported existing-install activation entry, protected source publication and older physical Mac qualification remain unfinished. Keep Docker's installed binaries and provider configuration intact until those delivery conditions are met.


The first admitted runner API test stopped at a real compatibility failure: dyld could not map the packaged libraries through the Mac `/var` to `/private/var` path alias. Its candidate LaunchAgent and child processes stopped, and Docker restoration completed. The runner patch now canonicalizes only the declared binary/library paths; a real compiled dylib regression accepts the relocated package and still refuses an unrelated executable library. The stock configure endpoint also preloads weights in the background, so configuration writes are deferred until Docker is drained.

The rebuilt `1.2.8-dpf-metal4.3` candidate has archive SHA256 `75abe25af4b125c897e91dc2a12b477b1af5aef19b9bed9d5d0f80f3b1544342` and manifest SHA256 `348deaf2e69dc7c98b2f80aec345d8344dda46db06c39acf20cf23fb8e75ddd6`. All three affected Go packages and 63 Node source tests pass. This candidate still requires a successful native API qualification; the failed earlier test is preserved, not promoted to a pass.


## Managed API qualification — October 26, 2026, 15:11 UTC

The admitted `1.2.8-dpf-metal4.3` runner completed all eight chat/tool/prefix controls correctly through the actual model-runner APIs. Both cold requests used 32011 prompt tokens and zero cached tokens. Candidate prefill took 84899.948 ms; the warm continuation reused 32015 tokens and completed in 671.985 ms. The candidate also returned a finite 768-dimensional Nomic embedding. This checks the embedding API shape, not downstream retrieval quality.

The latest Docker baseline prefill took 181016.821 ms. Source guard execution from 15:05:44 through 15:06:52 partly overlapped its startup/cold-read period; do not claim matched host load or treat the 2.132 observed ratio as a guaranteed improvement. The earlier API run's baseline was 160737.112 ms. The candidate's roughly85-second result is about47–53% below those observed baseline times; it still exceeds the video's roughly40-second claim. The earlier controlled native pair remains separate evidence.

Stock export/load/tag preserved the Qwen model/projector artifact and Nomic digest. The saved131072-token context and all other stored model settings matched on readback. A read-only probe from the canonical portal container reached the loopback-only runner's health, version and model-list APIs. Candidate process cleanup was confirmed and Docker restored; its installed binary hash remained unchanged. Report SHA256: `6f6bcd294ff2b5caa58264929f790b9f7bbc09b34959bc5d327ac7ebec9eed56`.

A queued qualification now maintains one fixed reservation and committed source identity, refreshes measured host pressure at a bounded cadence, binds the actual assigned slot and stops on refusal, terminal reservation, cancellation or changed source. A blocked admission is recorded as **unrun**, not a product failure. Experimental daemons retain the independent native expiry fence. This wait handling does not revive an expired reservation or grant permission.

This is **runtime API qualification**, not live activation. The Docker provider configuration remains unchanged. A supported managed native installation/activation path, DPF workflow and under-load acceptance, protected publication and per-target physical qualification are still required. BI-CD4EB130 remains open. Existing AI Ops learning DOC-B39A42F1 references WC-C8326144 for these findings; no duplicate scheduler was created.

### Review correction to the historical API report

Independent review found that the historical report's supervisor event named `released` came from an intentionally empty callback. It is **not** evidence that the platform released the reservation. Actual candidate process shutdown and Docker restoration are separately recorded; the platform's release action has its own outcome. Preserve the original report and hash, and attach this correction rather than editing its history.

The qualifier now records `release-not-attempted` for that callback. It also preserves a definitive fenced verdict after the shared supervisor has settled its final heartbeat/deadline work, even when all model controls finished before a late loss of authority. Injected final-checkpoint, in-flight refusal and in-flight deadline tests cover those paths without loading models. No fence was observed in the historical successful hardware sample; these are source and evidence corrections, not a replacement inference run.

### Qualification profile preservation correction — October 29

The current-profile API report
`36b8a235ea539ebbc9d57a5f4efb88c01ee621519c1f2dfa925535c78ae9fccf`
contains eight correct completion controls and finite 768-dimensional embeddings,
but the later profile verifier failed: the captured Qwen configuration was absent.
The owner's earlier post-verifier PASS was explicitly superseded. Retain that
immutable report and correction; neither a successful chat reload nor its
`baselineRestored` field establishes exact configuration restoration. Source also
did not establish the captured stored profile immediately before baseline controls,
so configuration equivalence for that timing pair remains unproven.

BI-C632CC8E repairs the existing qualifier's profile preservation. Before baseline
controls, it establishes and reads back the captured model identities and settings,
then checks them again after the controls. During cleanup it first confirms owned
candidate shutdown, restores missing captured configuration rows through the same
guarded APIs, reloads Docker and checks the complete profile before reporting
restoration. Matching settings and empty defaults are not rewritten. Conflicting
nonempty settings or model identities refuse before any configuration write.
An uncertain write is not retried automatically or described as zero effects.
An unresolved baseline-stage dispatch also blocks cleanup from repeating it.
If qualification and restoration both fail, the report retains both failures.

These source fixtures require no model run. The repair does not activate an engine,
alter provider configuration or weaken the current qualification verifier. The
existing native owner retains live profile recovery, staging and managed activation,
including their actual authority, current lease and drain obligations. Process
shutdown, persisted lease release, exact-profile restoration and useful DPF
performance remain separately evidenced outcomes.
