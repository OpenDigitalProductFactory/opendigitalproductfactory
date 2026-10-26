---
status: active
backlog_item: BI-CD4EB130
workroom: WC-C8326144
---
# Managed Mac runtime delivery plan

Implement [the canonical design](../specs/2026-10-26-mac-inference-runtime-design.md) for BI-CD4EB130. This is one atomic corrected-runtime integration: staging, qualification, activation and rollback are internal sequencing, not separately usable live optimizations. No phase alone closes the item.

## Acceptance contract (verbatim from the live item)

- AC-MRI1: Stage only a source-pinned, file-verified engine/runtime combination into DPF-owned versioned storage without modifying Docker vendor binaries or claiming vendor provenance.
- AC-MRI2: Preserve the configured model, projector, context, tool behavior, thinking policy and management contract; keep unqualified Mac hardware on the existing engine.
- AC-MRI3: Manage startup, identity, health, shutdown and atomic rollback through one explicit native installation lifecycle, with bounded host/container access and no unintended network exposure.
- AC-MRI4: Refuse activation without a current matching qualification, required model identity, admitted GPU/runtime window and complete prior-state rollback record; drain existing work and prevent duplicate model residency.
- AC-MRI5: Prove the actual active engine identity and effective settings, successful DPF chat/tool/embedding workloads, cold/warm timing and under-load behavior; record failures and unrun hardware coverage honestly.
- AC-MRI6: Deliver source tests, required integration checks, DCO protected publication and managed live convergence; update existing AI Ops learning with activation/rollback evidence.

## Backlog coverage

Parent and single delivery: BI-CD4EB130 / WC-C8326144. Decision: atomic. Current governed receipt: cmvpbrkdvbdq901t7ov7s0fdt, bound to published plan 0a23cfc3f7cb1fd981fd920f3cb8c9d46d1dc299 / blob 3c54465176f7bc711bf3f495b34e272da467b817. It supersedes cmvpa9n7malb001t7ll4q898k after the required item research note changed scope. Author research: initiative-2a3b51f3-41ec-4cfc-a698-496af14cf705. Implementation admission: IRD-273B96AAC778 (allowed). No independently shippable children or dependencies; existing BI-86B65F35 is prior delivered package evidence, not delivered again by this plan.

Traceability: AC-MRI1 through AC-MRI6; CONTRACT-MRI-IDENTITY, CONTRACT-MRI-PROVIDER, CONTRACT-MRI-LIFECYCLE, CONTRACT-MRI-ADMISSION, CONTRACT-MRI-ROLLBACK; FLOW-MRI-TRANSITION; VERIFY-MRI-RUNTIME. The design defines each reference.

## Ordered work

1. **Resolve design and impact.** Claim exact paths and consume the Workroom change-impact contract. Resolve the existing native install/convergence entry without adding a general host action. Verify the pinned runner's model-store import and sandbox paths. Keep DI-069E484C9E1E advisory/unresolved; source/empirical qualification is not production architecture approval. Stop activation at a genuinely missing consequential authority, never repeat routine consent.
2. **Reproduce and pin the candidate.** Under `tools/mac-inference/`, write failing tests for the custom upstream binary's misleading disabled-update status, wildcard listener, changed manifest/runner, escaping package paths, missing or changed projector and model identities. Pin the official runner archive and the exact minimal patch. Reuse the verified engine manifest and existing hashing/containment helpers. No GPU or service start for source tests.
3. **Implement candidate build and inspect.** Build a standalone native runner without altering Docker's installation. Record toolchain/source/patch/artifact identities; verify the sandboxed relocated engine and truthful custom runtime status. Test both accepted and rejected profiles, including unsupported Macs and package corruption. Inspection is read-only; it never grants activation.
4. **Implement the managed transition.** Use the resolved native installer/lifecycle owner, DPF-owned versioned storage, restricted listener, current qualification and exact admitted runtime lease. Capture prior state before effects and use conditional/atomic active selection. Meaningful tests inject failed launch, lost lease, changed source/package, busy model, acknowledgement loss and rollback failure. Preserve original histories and never infer provider settlement from process status.
5. **Qualify before activation.** Use the shared governed runtime and host-resource runner. Verify host/container reachability, model/projector/embedding identity, sandbox loading, child cleanup and restart/rollback. Sequentially exercise the existing Docker baseline and corrected managed candidate with matched settings. Record full useful completions, cold/warm input/cache counts, time to first token, generation and queue wait separately. Only M5 physical acceptance is possible here.
6. **Publish and converge.** Run affected source tests and required package typechecks; obtain the canonical shared gate and protected cloud checks. DCO PR through the merge queue, no draft/admin bypass. Use the supported canonical native convergence route and reconcile any existing uncertain upgrade first. Verify actual active engine/settings and DPF chat/tool/embedding/under-load outcomes. Capture rollback and AI Ops evidence in DOC-B39A42F1 / BI-IMP-AE7792A0. Do not mark done while only source or a candidate has passed.

## Verification and rollback

All runtime-bound evidence belongs to the canonical served target or admitted shared lease. Node source tests may run without application dependencies when genuinely independent; source-only status forbids claiming pnpm/typecheck/Vitest passes. The current root index lock is not removed or bypassed. Full build runs in governed/cloud CI.

Reuse the completed engine qualification when its immutable payload/model/profile still match; do not repeat it solely because installer source changed. The new runner/lifecycle/API workflow needs its own actual qualification. Before activation the original Docker runtime remains active. During failure restore only the recorded previous selection, verify model service and retain the failed attempt. Unknown effects remain unknown until reconciled.
