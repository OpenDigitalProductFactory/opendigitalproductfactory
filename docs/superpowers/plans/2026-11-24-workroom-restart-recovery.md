# Workroom scope recovery after a portal restart

BI-224F56F1 · WC-228D7A07 · `codex/workroom-restart-recovery`

Design and acceptance criteria are in the [restart-recovery design](../specs/2026-11-10-workroom-restart-recovery-design.md). The operator selected the existing in-process claim path under a hardened canonical portal. This draft is prepared for independent review. Fresh scope enrollment for the plan path returned `current-cohort-unproven`. The Workroom retains the existing design admission. Implementation needs fresh edit admission and a reviewed scope baseline and plan.

## Phase 1 · Qualify the canonical portal (AC-2, AC-3)

- Define the fixed served recipe in `Dockerfile`, the portal Compose service and its effective overlays. Run the portal as a dedicated non-root identity on a read-only root with no added capabilities, private namespaces, no privilege elevation and an enforced process inspection policy. Put data and bounded caches outside all module resolution, preload and native library paths. Separate host source reads from authorized source writers.
- Extend `scripts/promote.sh` and `scripts/promoter-epoch-evidence.mjs` to attest the exact built image, served dependency closure and effective OCI recipe. Bind evidence to the exact run and full portal ID. Leave the retirement receipt immutable. Use an actuator-owned proof channel so writer-controlled files and the writer's verification inputs cannot mint launch proof.
- Exercise both source and release asset handoff, boot migrations, cache writes, standalone request serving, native loads and rollback through the existing shared integration lease. Refuse shadowed executable paths, unsafe effective overrides, unexpected preload and inspector setup and incompatible rollback recipes. Record proof of the actual loaded program, not source-copy equality alone.

## Phase 2 · Reduce Docker authority (AC-2, AC-3)

- Reuse the bounded `platform-runtime/docker-socket.mjs` daemon client in the canonical actuator. Introduce the private typed transport described in the design. Authorize and bind each mutating operation from its existing run, lease or decision. Preserve the owner and content of a lost reply until exact operation readback settles it.
- Move direct HTTP callers first, then sandbox and CLI streams, converter and release probes, monitoring and admin operations, and promotion, backup and teardown effects. Adopt fixed operation serializers and strict target, image, namespace, mount and network checks. Replace the free-form admin shell fallback and the sandbox source copy that invokes exec in the portal.
- In the admitted candidate runtime, exercise each operation family through its normal entry point. Check that restricted operations are refused before Docker dispatch. Verify raw socket removal, daemon network isolation and closure of writable host inputs used by privileged actions. Keep producer and observer in the same runtime recipe exercised by AC-3.

## Phase 3 · Bind restart evidence to the claim transaction (AC-1, AC-2, AC-3)

- Add failing enrollment tests for malformed calendar values, padded Docker fractions, same-ID portal and sandbox restarts, sub-millisecond reversal, future values, mismatched runtime identity and reappearing retired containers. Use an exact UTC fractional comparison for accepted identity. Preserve current authority and signed-run checks.
- In `scope-epoch-enrollment.server.ts` and `scope-claim-store.ts`, use the existing `lockRuntimeTransitionAdmission` and self-upgrade admission lock while holding the real claim transaction. Keep command and room lock ordering. Attach a bounded trusted closing observation to fresh epochs. Reuse per-process package proof and leave existing same-owner refreshes free of qualification I/O. Cover keyed receipt and unkeyed activity paths.
- In the canonical mutation launchers, recheck active admission while holding those same locks. Keep owned action reservations and rows fenced until launch and descendant closure are established. Verify both orders through actual competing producer transactions and the case where preliminary observations precede a complete intervening transition.
- On the isolated served runtime, acquire new scope after a same-container restart and refuse incompatible runtime. Stop the actual writer after qualification, after the room lock and after scope/receipt writes before commit. Read all effects from a separate connection. Include late-load mutation, confirmed commit, lost reply, and same-ID replay. Measure request latency and admission-lock time. A timeout or unknown observation leaves no new epoch.

## Phase 4 · Verify and deliver (AC-4)

- Reconcile exact changed paths and run `gate:context`, resolve related tests and affected guards, then run focused coverage, typecheck and the exact-tree shared gate. Include hashes of the attested image, effective recipe, commit, merged tree and real negative and positive evidence. Keep fixture lock and crash results scoped to the fixture.
- Land through the DCO and protected PR path. Coordinate canonical self-upgrade with the recorded owner, then verify live successful scope enrollment and incompatible-evidence refusal through the normal entry point. Keep the existing signed retirement evidence intact. If an unqualified rollback is necessary, preserve existing epoch records and keep new qualification held.

## Backlog coverage

All four phases implement a single repair on BI-224F56F1. The authority migration, immutable launch recipe, continuity comparison and claim-local proof require coordinated delivery. An upgrade that only changes the timestamp predicate can reopen scope without the reviewed writer guarantee. The separate runtime, PR-automation and cost-control workstreams retain their own carriers.

The schema-v2 plan coverage receipt needs the baseline minted by independent spec approval and an immutable plan artifact. No receipt or plan-review result exists yet. On admission, bind AC-1 through AC-4 and the phase contracts, flows and verification to the exact provider plan blob before requesting plan review.

| Phase | Objectives | Contract | Flow | Acceptance evidence |
| --- | --- | --- | --- | --- |
| qualify-portal | OBJ-WRITER | Immutable served launch recipe | Resolve image → validate recipe → attest full portal ID | AC-2 and AC-3. Boot and rollback under the leased runtime, with native-load and mutation refusal evidence. |
| constrain-docker | OBJ-WRITER | Typed actuator operation policy | Recheck existing authority → resolve exact target → execute owned operation | AC-2 and AC-3. Positive entry points and negative target, mount, argument and network checks. |
| bind-claim | OBJ-CONTINUITY, OBJ-WRITER | Existing claim, receipt and admission transaction | Acquire locks → observe current cohort → settle effect and receipt | AC-1, AC-2 and AC-3. Real restart, incompatible runtime, lock races, crash, lost reply and rollback. |
| deliver-repair | OBJ-DELIVERY | Protected release and canonical self-upgrade | Review exact source → merge → upgrade → acquire live scope | AC-4. Governed gate evidence and live successful and refused claims. |
