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

At the original design capture, root refresh refused an existing index lock. That historical obstacle does not describe current runtime or worktree readiness. Native experiments subsequently passed as recorded in the operations evidence; permanent activation did not.

## Permanent host transition amendment — October 28, 2026

The October 28 live inspection found Docker Model Runner 1.2.9, the original installed engine executable hash `0e9095b1a9068961682fa60fa101bdcf40e0b1f1e6b0c44c1616c0611c1d4b26`, and the portal's `LLM_BASE_URL=http://model-runner.docker.internal/v1`. The corrected managed runtime was not active. PR6612 deployed source and an isolated qualification tool; it did not implement the remaining host transition. The item's deployment closure is not functional proof of AC-MRI3 through AC-MRI6.

The remaining work resumes BI-CD4EB130 on WC-E8C575B4, branch `codex/mac-inference-activation`, using the same sibling worktree. WC-C8326144 and its merged branch remain archived history. The claim refused that archived branch and explicitly offered a different branch; no archived row, historical receipt or source head was rewritten to manufacture resumption. Current design admission is IRD-C50296F4F18D.

### Verified reuse and the missing control

The current source already provides signed, node-bound Edge actions, a durable nonce journal, mTLS pull dispatch, ChangeRequest approval, quiescence, native host installation, package hashing and install-state transactions. Reuse these. `packages/db/src/remote-action-dispatch.ts` and `services/edge-node-go/internal/action/executor.go` allow inventory/diagnostics, organization joining and Docker VM restart; they do not allow inference activation. `apps/web/lib/edge-node/host-upkeep-convergence.ts` adds only Docker restart to its host-upkeep allowlist. Extending a restart request or inventory collection into an inference mutation would violate that scope.

DI-81525BCDC1F7 compared a specific inference action on this existing channel with an installer-only external-client crossing. The recorded recommendation is `typed-native-action`, high confidence, autonomy eligible, no commandment conflict or sensitivity flip. Record this as a source-design choice, not permission to execute a host action. The earlier DI-069E484C9E1E remains historical and unresolved; neither record ratifies a production pilot or settles an unknown task.

### Bounded native procedure

- Add one specific privileged inference-lifecycle action to the existing EdgeAction carrier, with operations `activate` and `rollback`. It is not a shell command, executable path, arbitrary download, package manager or general service endpoint. Keep existing token/coworker/human authority intersection and ChangeRequest checks.
- Resolve package and qualification artifacts by their immutable digests within DPF-owned versioned storage. The host derives paths from its protected installation root; request parameters cannot choose a URL, command, executable or external path. Verify the runner/engine inventory again immediately before launch. Reuse the completed native qualification only when device, model/projector/embedding identities, package bytes and effective settings still match; reject fenced, failed, incomplete or changed reports.
- Require a current matching host, source, qualification, actual shared runtime/GPU admission and safe production drain. Check both daemon-side model activity and DPF's request admission; an idle snapshot alone cannot prevent a new request. Unknown original application/reviewer/upgrade effects remain separate obligations and cannot be replayed as pilot controls.
- Use the existing native installer owner to provision the handler and its package, and one owned launchd service `local.dpf-inference.managed`. Keep package data immutable and model/log/state storage private and separate. Provisioning an updated host handler is a real prerequisite: a portal image upgrade cannot install a host binary or prove that a host advertises this action.
- Do not append the new action to automatic `HOST_UPKEEP_ACTION_TYPES`, re-enable a disabled capability or silently alter a node's scope policy. The exact host procedure needs explicit recorded authorization through the existing action policy before it may execute. If that authorization or the native handler is unavailable, report that concrete prerequisite without substituting a client shell or claiming activation.
- Capture previous runtime/profile, endpoint/configuration, daemon and model identities before the first effect. Use the existing operation lock, nonce consumption and install-state transaction boundaries. Lost acknowledgements trigger observation of the original action and actual owned processes, never another action with a new key. Retain an uncertain lock/transition until owned effects are reconciled.
- Keep model import on stock export/load/tag APIs and preserve projector/configuration identity. Drain and confirm Docker residency is gone before candidate configuration can preload weights. Do not run two writers against Docker's mutable store or let the two chat models remain resident during transition.
- Route all platform chat, tools, embeddings and model-management callers through the same existing local-provider contract. The managed installer and canonical release convergence select the endpoint consistently; no direct provider-row or agent-authored `.env` flip constitutes delivery. Refuse conflicting explicit endpoint overrides. Agents still advance the canonical install through `request_self_upgrade`, not hand-tagging or recreating containers.
- Commit the active selection only after exact served identity, host/container reachability and actual DPF workload controls pass. Rollback is the same signed procedure: stop and confirm owned candidate descendants, restore only the recorded prior selection, and verify service restoration. Failed restoration remains failed/unknown; dispatch counts, HTTP200 and the old synthetic release event do not prove it.

### First pilot and compatibility

The first physical pilot remains this M5 Max. Preserve the actual current Qwen and Nomic artifacts and settings; capture current tags/digests instead of assuming that their spelling still matches October 26. Do not reduce context, output effort, thinking or the model tier to improve the timing. Measure useful completions and required result/tool writes, queue time, cold ingestion, reused prefix, generation and natural overlap separately. The retained 32K samples and their host-load caveat remain comparative evidence, not a guaranteed speedup or a substitute for under-load behavior.

The permanent daemon's lifecycle is distinct from the finite experimental lease fence. Do not turn an expired experiment into a permanent service by omitting its fence. Persistent ownership begins only with the accepted managed active selection and required host/change authority. Failure before that point restores the prior service; client disappearance must not leave an unowned model process.

Physical older Mac and older macOS qualification remains unrun. Existing Docker installations stay the default unless their own matching host/package/model qualification and authorized selection exist. Record actual pilot and rollback results in the existing AI Ops learning; BI-IMP-AE7792A0 retains its monitor ownership, failure history and separate scheduled-writer requirements.


## Qualification profile preservation repair — October 29, 2026

**Owning repair:** BI-C632CC8E / WC-CAC08C96. Reuse
CONTRACT-MRI-PROVIDER, CONTRACT-MRI-ADMISSION and CONTRACT-MRI-ROLLBACK and
AC-MRI2, AC-MRI4 and AC-MRI6. This source repair does not reopen BI-CD4EB130,
replace its operational owner or change any original uncertain request.

**OBJ-QPR1:** Preserve the exact captured model profile before qualification
measurements and after cleanup, with restoration evidence based on actual readback.

At source `4718cd4f1c5418ab2eba819dd47d5cb839f8eca0`, cleanup chat-reloads
Docker and marks `baselineRestored` from completion success without restoring or
reading captured configuration. Baseline controls also begin after unload without
re-establishing the captured profile. Pure source-fragment fixtures reproduced
both missing invariants without a model or host operation. The October 29 report
`36b8a235ea539ebbc9d57a5f4efb88c01ee621519c1f2dfa925535c78ae9fccf`
retains its completed API controls and the owner's superseding failed profile
verification; do not reuse the earlier false post-verifier PASS. This does not
prove historical baseline drift or configuration equivalence for its timing ratio.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-QPR1 | OBJ-QPR1 | Preserve the captured per-model/mode configuration across qualification unloads. Restore and read back the exact captured settings before baseline controls; do not silently benchmark a changed default. |
| AC-QPR2 | OBJ-QPR1 | After owned candidate shutdown, restore and verify the captured Docker profile through existing supported configuration APIs before reporting restoration success. Preserve model identity, settings and current unaffected embedding modes; do not manufacture settings from defaults. |
| AC-QPR3 | OBJ-QPR1 | Meaningful deterministic RED tests reproduce lost completion configuration. GREEN tests cover restoration/readback ordering, baseline-before-control ordering, multiple modes, configuration mismatch, API/cleanup failure and truthful report outcomes. Use source fixtures, not duplicate model inference. |
| AC-QPR4 | OBJ-QPR1 | A failed or unverified readback must remain failed/incomplete; a successful chat response alone is not configuration restoration. Preserve the original qualification failure and evidence; do not overwrite historical hashes or infer lease release. |
| AC-QPR5 | OBJ-QPR1 | Deliver affected source checks, independent complete source assessment, actual canonical integration gate, DCO PR and protected merge. No new paid/provider review without actual funding authority. |

### Ordered fix: FLOW-QPR-RESTORE

1. Bind this exact design, edit scope and research to BI-C632CC8E and its actual
   source Workroom. Obtain current atomic coverage and implementation admission.
2. Add production-helper fixture regressions for AC-QPR1 through AC-QPR4. Observe
   RED when unload drops the completion profile even though owned shutdown and
   chat completion succeed. No actual model or host API is needed.
3. Extend the existing `runtime-model-store.mjs` snapshot/configuration helpers
   with captured-profile restoration and exact readback. Read current model and
   mode identity first, preserve matching configurations and empty defaults, and
   write only captured rows through the existing guarded request callbacks.
   Conflicting or unverified readback fails; never invent settings or delete an
   unowned configuration to make comparison pass.
4. Establish/read back that profile before baseline controls and restore it after
   confirmed candidate shutdown during cleanup. Read it again after the baseline
   reload, then mark and checkpoint restoration success. A successful chat reply
   alone remains insufficient. Preserve lease, deadline, source and authority
   fencing; failed restoration remains failed or unknown.
5. Verify `VERIFY-QPR-UNIT`: colocated profile/model-store fixtures, related engine
   and native-adapter suites and the current impact contract. Cover multiple
   modes, unchanged embedding settings, empty defaults, failed shutdown, API
   errors and final readback drift.
6. Verify `VERIFY-QPR-INTEGRATION`: guard/doc-index obligations, independent full
   immutable-source assessment, canonical shared gate, DCO PR and protected merge.
   Production build keeps its ordinary protected CI lane.

**Backlog coverage:** atomic BI-C632CC8E. Configuration preservation, readback and
truthful report orchestration are not independently useful repair phases.
Map AC-QPR1–AC-QPR5, the three reused CONTRACT-MRI references,
FLOW-QPR-RESTORE, VERIFY-QPR-UNIT and VERIFY-QPR-INTEGRATION to this one deliverable.
Coverage and implementation admission are pending at this design checkpoint.

No schema migration or new runtime/activation carrier is required. The existing
BI-CD4EB130 owner alone handles live profile recovery, staging, activation and
rollback under actual host authority and shared runtime admission. This repair
does not change models, provider settings, permissions or the disabled global
action flag, run duplicate inference, repeat reviews, overwrite historical report
hashes or settle UNKNOWN effects. Keep the immutable qualification verifier strict.
Source rollback restores code only; runtime recovery remains the existing owner's
recorded-profile obligation.


## Standard local endpoint convergence amendment — October 30, 2026

Corrective implementation owner: **BI-CA88DAA7**. The earlier merged source and physical acceptance obligations remain separate. This amendment is source planning; it grants no native activation, provider override, model request, permission expansion or uncertain-task replay.

### Reproduction and selected correction

At immutable served source `1f8c111c409a4e8cc3575d118a7a154134791ba9`, `docker-compose.yml:209` and `docker-compose.local-ci.yml:27` inject `http://host.docker.internal:11434` into `OLLAMA_INTERNAL_URL` while `LLM_BASE_URL` selects Docker Model Runner. Canonical `.env` has no legacy key. Actual pure execution of `managedInferenceProviderDigest` rejects these inherited values, accepts the same standard LLM endpoint without the legacy fallback, and still rejects a genuinely foreign endpoint. `getOllamaBaseUrl` independently enforces the same override veto during managed serving. Removing only admission validation would leave serving broken and weaken configuration protection.

Actual source-path tracing also found `embedding.ts` constructs its own environment-first endpoint. Its transport only owns IO and cancellation; it does not rewrite the selected endpoint. Thus a native selection would leave document/knowledge embedding calls on Docker. This is source-path proof, not a successful live retrieval test.

Use the existing endpoint/selection contract. Desktop and local-CI Compose retain an explicitly supplied `OLLAMA_INTERNAL_URL` but use an empty inherited fallback (`${OLLAMA_INTERNAL_URL:-}`). Keep the standard LLM default. The Linux overlay retains its intentional Ollama endpoint. Reuse `getOllamaBaseUrl` for both embedding requests and availability checks; contain selection-read errors within the existing failed/null/false API. Keep all explicit-configuration vetoes and provider digest fields unchanged. Do not broaden the allowlist, erase explicit operator settings or dispatch to Docker after a corrupt/transitioning selection.

Docker's interpolation standard defines `${VAR:-default}` as the set/nonempty value or its fallback and applies interpolation per file before merge: https://docs.docker.com/reference/compose-file/interpolation/. An empty inherited fallback leaves one standard local inference source while the existing Linux overlay and explicit values retain ownership. Changing the fallback to another nonempty API URL would retain duplicate competing defaults; weakening admission would hide a real conflict. Neither alternative is needed.

**OBJ-EPC1:** Standard Desktop defaults permit the existing managed-engine admission and serving resolver while explicit conflicts, Linux and independently selected providers retain their contracts.
**OBJ-EPC2:** Actual portal embedding consumers follow the committed local selection and rollback, with contained failures and unchanged model, input, retry and timeout behavior.

**CONTRACT-EPC-ENDPOINT:** Reuse CONTRACT-MRI-PROVIDER and the existing strict managed inference provider digest and canonical local resolver. No selection, authority or API format changes.
**FLOW-EPC-CONVERGENCE:** published Compose/application correction → independently admitted canonical update → read back actual defaults → separately admitted native activation → actual useful workload/embedding retrieval → signed rollback/readback → final eligible activation. Source tests alone prove none of these runtime effects.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-EPC1 | OBJ-EPC1 | Render real Desktop/local-CI Compose defaults and prove both admission and managed serving accept them; preserve explicitly supplied legacy values and Linux overlay defaults. |
| AC-EPC2 | OBJ-EPC1 | Genuine foreign environment/provider endpoints remain rejected, digest sensitivity remains intact, and independently selected providers keep their own endpoint. |
| AC-EPC3 | OBJ-EPC2 | The real embedding helper and availability check use the managed endpoint and return to Docker after rollback, retaining the existing Nomic model, truncation/retry and timeout contract. |
| AC-EPC4 | OBJ-EPC2 | Corrupt or transitioning selection and conflicting settings produce contained failed/null/false results without any provider dispatch or silent fallback. |
| AC-EPC5 | OBJ-EPC1, OBJ-EPC2 | Deliver affected tests, typechecks, existing guards, independent immutable-source assessment, canonical integration gate, protected DCO publication and documented existing-install convergence. |

### Ordered atomic fix: FLOW-EPC-SOURCE

1. Publish this design-only amendment and bind its immutable blob, reproduction, source scope and atomic coverage to BI-CA88DAA7. Obtain normal current implementation admission before changing implementation files.
2. Add first-failing tests exercising actual Compose defaults with the production admission and serving helpers; cover explicit overrides and the Linux overlay. Add real embedding-consumer request/availability, rollback and selection-failure regressions. Verify the pre-fix failures rather than counting a fixture's own logic as reproduction.
3. Remove only the inherited Desktop/local-CI Ollama fallback; keep operator values and Linux overlay unchanged. Replace embedding's duplicate endpoint reader with the existing canonical resolver, inside its failure boundary.
4. Verify VERIFY-EPC-UNIT: affected embedding, ollama-url, managed-admission and Compose contracts. Preserve negative provider cases, model/input/retries/deadlines, deferral distinction and no-dispatch on invalid selection. Run affected package typechecks and the Workroom impact contract.
5. Verify VERIFY-EPC-INTEGRATION: applicable source/Compose/docs guards, independent full immutable-source assessment, canonical shared gate, DCO protected publication. Existing live advance is separately admitted through the canonical owner; read back actual serving source/defaults before activation. Do not replay any uncertain prior operation.

**Backlog coverage:** one atomic deliverable BI-CA88DAA7. Default admission and actual embedding-consumer routing together repair the existing single-provider selection contract; neither a ready offer with a stale consumer nor a routed consumer with a refused offer realizes this correction. Map OBJ-EPC1, OBJ-EPC2, CONTRACT-EPC-ENDPOINT, FLOW-EPC-SOURCE, FLOW-EPC-CONVERGENCE, AC-EPC1–AC-EPC5, VERIFY-EPC-UNIT and VERIFY-EPC-INTEGRATION to that deliverable. The preimplementation plan is the published `4cec8b9312e119d90adbbc887df1d028c3c62684` snapshot (blob `791034c7bcd1d692bcf3ce37d61a3d7612da42aa`). Atomic coverage is `cmvuhx4x60jot01ls5bpght3g`, mapping this one deliverable to BI-CA88DAA7 with no independent dependencies. Author research is `initiative-ad297dbf-8e13-471d-a1ab-78579d759413`; implementation admission is `IRD-72B1B90AAD88`, on WC-9B75B557. The server raises the declared small shape to effective medium/elevated for Compose; its required five item-body acceptance criteria quote AC-EPC1–AC-EPC5 verbatim. The first coverage refusal for missing body criteria minted no receipt; the corrected call followed that remediation. These records authorize source implementation, not a live engine transition or historical-task replay.

Source rollback restores prior files through protected delivery. It does not silently erase committed native selection or substitute for signed runtime rollback. No schema migration, provider row change, new API, new scheduler, engine benchmark or hardware-qualification claim is included. Existing native acceptance remains with this chat and its current admitted host procedure; ordinary source delivery does not prove AC-MRI3–AC-MRI6 or healthy recurring AI Ops learning.
