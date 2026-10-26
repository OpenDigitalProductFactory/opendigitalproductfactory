---
status: active
backlog_item: BI-86B65F35
workroom: WC-06E454C7
---
# Corrected Mac Metal engine package

## Objective and authority
The operator selected a maintained corrected engine for DPF Mac installs on 2026-10-26 UTC.
This ordered defect repair delivers one source-pinned engine package and its verifier and qualification tools.
It does not deliver BI-285EF102's interactive-turn feature, settle historical reviews, or claim fleet activation.

**OBJ-MAC1:** Restore the optional tensor compilation path when the selected device supports it, preserving the existing fallback.
**OBJ-MAC2:** Make every candidate's source, patch, toolchain, SDK and shipped bytes independently verifiable.
**OBJ-MAC3:** Qualify actual behavior and performance before installation is recommended.

## Observed cause
DOC-B39A42F1 records the controlled diagnostic. Current Docker b9879-metal server and Metal library report SDK15.5/minimum13.3 and fail the tensor self-test.
The exact installed f16 kernel compiles and creates a pipeline with Metal4.
Changing only a standalone diagnostic's SDK identity27.0 to15.5 selects default Metal3.2 and reproduces failure; explicit Metal4 succeeds in both.
The minimum target stayed13.3. This identifies a shader-language mechanism, not a model speed multiplier or a cause for every failed request.

## Research & Benchmarking
- Upstream llama.cpp b9879 resolves to commit72874f559c598b8f89fbb24864868337cf5afb4c. Its Metal device source SHA256 is f4dcb1141c4ed47e1c8b0dd7e854aed17a87bae3ca954d58ebe7f6886849231e. Both runtime compilation sites construct options without selecting a language. Adopt its existing device capability checks and failure fallback; repair the two options sites.
- Docker Model Runner v1.2.8 pins b9879 and downloads its engine from a fixed Docker repository. Its current Metal artifact is already installed; the mutable latest-metal tag is older. Retain Docker's engine and identities until a qualified integration exists. A DPF archive is never represented as Docker's digest.
- LM Studio issue2040 reports a similar default-language failure and separate model measurements. Use this as corroboration, not this install's benchmark or a dependency.
No new runtime service, provider, scheduler or model is adopted by this package repair.

Sources:
https://raw.githubusercontent.com/ggml-org/llama.cpp/72874f559c598b8f89fbb24864868337cf5afb4c/ggml/src/ggml-metal/ggml-metal-device.m
https://raw.githubusercontent.com/docker/model-runner/v1.2.8/pkg/inference/backends/llamacpp/download.go
https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2040
https://hub.docker.com/v2/repositories/docker/docker-model-backend-llamacpp/tags?page_size=100&name=metal&ordering=last_updated

## Ordered repair
1. Pin the existing upstream source and source archive digest. Apply an exact checked patch that uses Metal4 only when the existing has_tensor capability is true. Do not force that capability or delete failure handling.
2. Build Apple Silicon server and benchmark binaries plus their actual shared-library closure into an isolated candidate directory. Record the host architecture, SDK, compiler, deployment target, build flags, source/patch digests and file manifest. Preserve licenses. Package verification rejects unexpected files, path escape, missing libraries, changed hashes and an unsupported schema.
3. Run source regression controls and the exact installed self-test under modern and legacy SDK identities. Build/verify controls must run without loading model weights or touching installed Docker files.
4. Qualify the candidate with the existing model under governed runtime coordination. Record a complete task result, tool behavior, prefix-cache reuse and matched cold/warm measurements. An incomplete or uncoordinated experiment cannot qualify activation.
5. Record the result and limitations in the existing AI Ops work. Physical older-Mac performance remains unrun unless actual hardware is exercised.

## Acceptance
- AC-MAC1: Build the corrected engine from an immutable upstream commit with verified source and patch identities; explicitly select Metal4 only for the tensor-capable compilation path and preserve the existing fallback.
- AC-MAC2: Produce a versioned Apple Silicon package with a verified file manifest, source/patch/toolchain/SDK/build provenance, licenses and an isolated staging path; never claim Docker’s vendor digest for changed bytes.
- AC-MAC3: Reproduce the SDK-default failure and demonstrate corrected tensor self-test compilation and pipeline creation on this M5 Max; exercise fallback controls and report physical older-Mac coverage as unrun where unavailable.
- AC-MAC4: Qualify the candidate with the existing model’s chat/tool/cache behavior and matched cold/warm measurements under governed runtime coordination before recommending activation; preserve unknown, failed and truncated outcomes.
- AC-MAC5: Record actual package and qualification evidence plus rollback/integration constraints in shared AI Ops learning; distinguish a built candidate, a qualified package and an activated live engine.

## Contracts and traceability
- CONTRACT-MAC-ARTIFACT: the manifest identifies the actual source and every shipped regular file and safe library symlink; changed bytes require new hashes. Unsigned local qualification is distinct from a distributable signed release.
- CONTRACT-MAC-RUNTIME: candidate construction and validation never write into Docker's inference directory, restart services, change LLM_BASE_URL, or select a provider. Deployment contract9 remains the inference interface.
- FLOW-MAC-CANDIDATE: pin → verify source → patch → build → stage → hash → verify → coordinate → qualify → report.
- VERIFY-MAC-PACKAGE: node --test tools/mac-inference/engine-package.test.mjs plus native build, package verification, tensor controls and a governed model qualification record.
These identifiers are the four-way plan coverage references.

## Compatibility, risk and rollback
Apple Silicon is the target architecture. Existing pre-M5 tensor-disable logic remains; old macOS/device self-test refusal remains a fallback, not a forced acceleration claim.
Only the M5 Max is physically available here. Fixture controls cannot establish M1–M4 performance.
No database migration, permissions change, public API change or consumer installation transition is part of this package.
Malformed inputs refuse before executing tools. Source and output paths cannot overlap a Git checkout, installed Docker inference files or an existing nonempty destination.
A failed build leaves an isolated candidate unqualified. Rollback before activation is discarding that candidate; the served Docker engine is unchanged.
Activation needs the canonical installer/runtime path and a qualified package. DPF must not patch a vendor binary header, forge its provenance or rely on an undocumented binary swap.
