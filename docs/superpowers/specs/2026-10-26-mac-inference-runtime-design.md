---
status: draft
backlog_item: BI-CD4EB130
workroom: WC-C8326144
---
# Managed corrected Mac inference runtime

## Objective and authorization

The operator requested completing the managed Mac integration and live validation on October 26, 2026. BI-86B65F35 delivered the engine package, not activation. This successor repairs that missing delivery path. Preserve BI-285EF102, its frozen 95d6 source and uncertain original reviews. The separate review/upgrade recovery has its own owners; never submit another uncertain upgrade to unblock this work.

**OBJ-MRI1:** Make the qualified corrected engine usable through the existing local model-provider contract.
**OBJ-MRI2:** Preserve model quality, installation identity and a working rollback across native service changes.
**OBJ-MRI3:** Prove actual live behavior and measured performance before calling the optimization delivered.

The target is Apple Silicon, initially the physically qualified M5 Max. Keep other Mac hardware on its existing engine until matching qualification exists. Do not change the model tier, thinking policy or context to manufacture a latency improvement.

## Evidence and substrate

- PR6594 merged the source-pinned engine builder/verifier/qualifier in `tools/mac-inference/`. One admitted matched run passed eight controls and measured 32011 cold input tokens at 173016.605 ms baseline versus 91380.104 ms corrected. This is one sample, not a fleet guarantee. The corrected engine remains inactive.
- `docs/operations/mac-inference-engine.md` explicitly requires a supported integration, authenticated artifact identity and rollback before activation. Reuse its package verifier and the existing lease supervisor rather than inventing another ledger.
- Deployment contract 9 in `2026-05-09-deployment-contracts.md` owns local OpenAI-compatible HTTP semantics and the existing provider/model environment contract. Preserve chat, tools, embeddings and DMR model management; no new provider semantics or database model.
- `scripts/installer/native-edge-host.sh` and the native TTS installers establish the host-native, launchd-supervised lifecycle precedent. Their services remain independently owned. Do not repurpose the Edge node's restricted host-upkeep action as a generic shell or silently add grants.
- Existing host-resource admission and `scripts/lib/lease-supervisor.mjs` own native experiment coordination. A queued/expired lease cannot start a daemon or unload a model.

## Research and options

Pinned Docker Model Runner v1.2.8 source is commit `5a3112fdc10bcfe236a7450fcfa7e83ed3c0209e`:

1. Docker Desktop distribution pins a backend from a fixed Docker namespace. Its version selector changes a tag, not an arbitrary package path. Reject overwriting vendor files, inventing vendor digests or claiming a portal upgrade installed this package.
2. The official standalone `dmr serve` uses the same server, scheduler, model manager and OpenAI API. `LLAMA_SERVER_PATH` and `DISABLE_SERVER_UPDATE` are documented source configuration points. This is the candidate for concrete integration qualification. Reuse the server rather than implementing DMR's API around a raw llama-server.
3. Raw llama.cpp server preserves the engine but loses DMR management/lifecycle compatibility. Reimplementing that surface is a larger change; retain it as an evaluated alternative, not an assumed drop-in replacement.
4. Waiting for a corrected vendor artifact leaves regular requests unchanged with no verified delivery date. The operator explicitly requested continued delivery without waiting.

Two concrete standalone limitations must be resolved before recommending activation: `server.go` constructs a wildcard TCP listener, and the disabled-update path in `download.go` only marks the Docker-convention filename as installed even though execution accepts upstream `llama-server`. A maintained candidate must have an explicit restricted listener and honest custom-engine status. Do not add misleading vendor metadata to satisfy that check.

The Mac sandbox permits the engine binary directory, sibling library directory and bounded working/model paths. Test the actual relocated library closure, model/projector access and child termination inside that sandbox. Do not disable it. Use a separate model store or supported immutable materialization; never run two writers against Docker Desktop's mutable model metadata. Preserve the exact OCI manifest and GGUF/projector identities.

DI-069E484C9E1E compared managed standalone DMR, direct-server compatibility and waiting. It returned low-confidence, sensitivity-unstable advice (margin 0.049, autonomyEligible=false); outcome is recorded unresolved. This design proposes a concrete candidate for source and empirical qualification, not an approved production architecture selection. Do not interpret the advisory as authority to wait indefinitely or to activate a runtime. If the choice still requires ratification after qualification, present the concrete verified transition and rollback once, using the existing operator authorization wherever it already applies.

Primary sources read:

- https://github.com/docker/model-runner/blob/5a3112fdc10bcfe236a7450fcfa7e83ed3c0209e/cmd/dmr/README.md
- https://github.com/docker/model-runner/blob/5a3112fdc10bcfe236a7450fcfa7e83ed3c0209e/pkg/envconfig/envconfig.go
- https://github.com/docker/model-runner/blob/5a3112fdc10bcfe236a7450fcfa7e83ed3c0209e/pkg/inference/backends/llamacpp/llamacpp.go
- https://github.com/docker/model-runner/blob/5a3112fdc10bcfe236a7450fcfa7e83ed3c0209e/pkg/inference/backends/llamacpp/download.go
- https://github.com/docker/model-runner/blob/5a3112fdc10bcfe236a7450fcfa7e83ed3c0209e/pkg/server/server.go
- https://github.com/docker/model-runner/blob/5a3112fdc10bcfe236a7450fcfa7e83ed3c0209e/pkg/sandbox/sandbox_darwin.go
- https://github.com/ggml-org/llama.cpp/tree/72874f559c598b8f89fbb24864868337cf5afb4c/tools/server
- https://docs.docker.com/desktop/features/networking/

Docker documents the container network proxy, not proof that this particular loopback service is reachable. Prove host-to-container access in the admitted target. Never widen to an unauthenticated wildcard listener merely to make connectivity pass.

## Proposed lifecycle and contracts

**CONTRACT-MRI-IDENTITY:** Pin runner source/archive, reviewed patch, compiler and dependency identities. Verify the existing engine package unchanged. A composite runtime manifest identifies every actual runner/engine byte and qualification report. A DPF candidate is never reported as a Docker vendor artifact. Authenticated distribution and local source-build provenance are separate assurances; neither is fabricated from an ad hoc signature.

**CONTRACT-MRI-PROVIDER:** Keep existing model reference, OCI digest, projector, embeddings, context, cache and tool/thinking settings. Resolve all local API and management callers through the same canonical profile. Refuse inconsistent provider overrides. No ad hoc direct DB or environment edit constitutes activation.

**CONTRACT-MRI-LIFECYCLE:** DPF owns versioned native runtime storage, one launchd service identity, logs, health and the active/previous selection. Verify the candidate while the existing runtime is intact. A restricted listener, package hashes and model access must pass before admission to activation. Source changes land through protected DCO PR; canonical convergence is distinct from running a worktree candidate.

**CONTRACT-MRI-ADMISSION:** Native qualification and transition require an exact current runtime/GPU lease, matching source, owner and package. Drain existing requests through supported DMR state, preserve the restoration obligation before unloading, and prevent duplicate model residency. Lost authority fences new effects; an aborted request is not execution settlement.

**CONTRACT-MRI-ROLLBACK:** Capture the prior service/profile/engine identity before the first effect. Stop only the owned candidate, restore the previous provider/service selection through the same managed lifecycle, verify actual model service and record failures. Do not overwrite Docker files, silently broaden access or delete failed evidence. Rollback after an uncertain acknowledgement first reconciles actual state.

**FLOW-MRI-TRANSITION:** source-pin → build → verify → stage → admitted isolated qualification → current release/authority check → drain → checkpoint previous → activate → exact runtime/DPF verification → commit active selection; failure → supported rollback → verify restoration.

**VERIFY-MRI-RUNTIME:** source behavioral tests plus admitted native lifecycle, exact engine/settings evidence, DPF chat/tool/embedding completion, cold/warm timing and under-load checks. No active status, dispatch count or HTTP200 alone proves useful completion.

## Acceptance

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-MRI1 | OBJ-MRI1, OBJ-MRI2 | Stage only a source-pinned, file-verified engine/runtime combination into DPF-owned versioned storage without modifying Docker vendor binaries or claiming vendor provenance. |
| AC-MRI2 | OBJ-MRI1, OBJ-MRI2 | Preserve the configured model, projector, context, tool behavior, thinking policy and management contract; keep unqualified Mac hardware on the existing engine. |
| AC-MRI3 | OBJ-MRI2 | Manage startup, identity, health, shutdown and atomic rollback through one explicit native installation lifecycle, with bounded host/container access and no unintended network exposure. |
| AC-MRI4 | OBJ-MRI2 | Refuse activation without a current matching qualification, required model identity, admitted GPU/runtime window and complete prior-state rollback record; drain existing work and prevent duplicate model residency. |
| AC-MRI5 | OBJ-MRI3 | Prove the actual active engine identity and effective settings, successful DPF chat/tool/embedding workloads, cold/warm timing and under-load behavior; record failures and unrun hardware coverage honestly. |
| AC-MRI6 | OBJ-MRI1, OBJ-MRI2, OBJ-MRI3 | Deliver source tests, required integration checks, DCO protected publication and managed live convergence; update existing AI Ops learning with activation/rollback evidence. |

## Scope, risks and convergence

No schema migration, new model, paid provider, review replay, general command endpoint, permission expansion or duplicate scheduler. Existing Docker-managed installs remain the default until a complete supported profile is explicitly activated. Only the qualified M5 host is initially eligible. Physical M1–M4/macOS coverage remains unrun, not simulated by a capability fixture.

Initial source scope is `tools/mac-inference/` builder, manifest/controller and behavior tests; the existing native installer owner only where the verified activation entry is integrated; relevant operations/watchlist docs and the existing source-policy test job. Do not extend the promoter/host-action protocol speculatively. Resolve the supported existing-install convergence entry before implementation of any activation effect; a missing authorized host control is an explicit boundary, not permission to use shell as a substitute.

Root clone refresh currently refuses because its existing index lock is present. Leave it untouched. The active source worktree is isolated at fresh f5492f83e1fbddc43ffa9e88d9b1ca6abd04d114. It is source-only until the managed dependency probe reports otherwise. Native experiments and full platform verification are unrun at design capture.
