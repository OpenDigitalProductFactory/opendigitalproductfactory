---
status: active
---

# Workroom scope recovery after a portal restart

BI-224F56F1 · WC-228D7A07 · `codex/workroom-restart-recovery`

Design and acceptance criteria are in the [restart-recovery design](../specs/2026-11-10-workroom-restart-recovery-design.md). The operator selected the existing in-process claim path under a hardened canonical portal. DPF approved the scope baseline and plan. Fresh implementation edit scope returned `current-cohort-unproven`. The Workroom records the operator-authorized bounded source recovery and the path admission that could not run successfully.

## Phase 1 · Qualify the canonical portal (AC-2, AC-3)

- Define the fixed served recipe in `Dockerfile`, the portal Compose service and its effective overlays. Run the portal as a dedicated non-root identity on a read-only root with no added capabilities, private namespaces, no privilege elevation and an enforced process inspection policy. Put data and bounded caches outside all module resolution, preload and native library paths. Separate host source reads from authorized source writers.
- Extend `scripts/promote.sh` and `scripts/promoter-epoch-evidence.mjs` to attest the exact built image, served dependency closure and effective OCI recipe. Bind evidence to the exact run and full portal ID. Leave the retirement receipt immutable. Use an actuator-owned proof channel so writer-controlled files and the writer's verification inputs cannot mint launch proof.
- Exercise both source and release asset handoff, boot migrations, cache writes, standalone request serving, native loads and rollback through the existing shared integration lease. Refuse shadowed executable paths, unsafe effective overrides, unexpected preload and inspector setup and incompatible rollback recipes. Record proof of the actual loaded program, not source-copy equality alone.

## Phase 2 · Reduce Docker authority (AC-2, AC-3)

- Reuse the bounded `platform-runtime/docker-socket.mjs` daemon client in the canonical actuator. Introduce the private typed transport described in the design. Authorize and bind each mutating operation from its existing run, lease or decision. Preserve the owner and content of a lost reply until exact operation readback settles it.
- Move direct HTTP callers first, then sandbox and CLI streams, converter and release probes, monitoring and admin operations, and promotion, backup and teardown effects. Adopt fixed operation serializers and strict target, image, namespace, mount and network checks. Replace the free-form admin shell fallback and the sandbox source copy that invokes exec in the portal.
- Add the authorized source writer from the design (owner decision `DI-250233FBDD9B`). The actuator launches a short-lived container from the canonical promoter image, with a fixed entrypoint and operation set and the install checkout as its only writable source mount. Each launch is keyed on an admitted owner that is re-read before writing. Start with self-upgrade workspace preparation and ref publication for the running run, then bounded remote freshness fetches. Move `prepare-source.ts`, the status and batch `git fetch` callers, the merge-delivery trunk refresh and skill-seed write-back off the portal. Extend the cutover guard so `portal-immutable-v1` stays held while portal code writes under a read-only mount. Build source-mode candidate promoter images as an admitted `candidate` stage launched by the actuator from the installed promoter image (kernel decision `DI-B3171A8F09DC`), and resolve the built artifact in the actuator.
- Run sandbox commands as a `sandbox-exec` owner on the existing actuator stream transport. The portal keeps its `docker exec` argv, and `spawnSandboxExec` and `execSandboxCommandLine` turn it into a command, environment, working directory and user. A host command line must split into plain words with no host expansion, redirection, pipe or glob, or it is refused. The actuator execs only into the sandbox it observed, bound to the signed retirement's sandbox ID, with values in the child environment and never `--privileged`. Start with the routing CLI adapters, the engine probe and the agent CLI runtime. Build sandbox lifecycle (create, network, remove) and the extra pool slots (`DPF_SANDBOX_POOL_SIZE` above 1) are refused under the recipe until their owned-container operations exist.
- A build's sandbox database steps (readiness and the data-only seed from production) run as an actuator `sandbox-db` operation admitted on the build's in-use sandbox slot, which must be bound to the observed sandbox. The actuator resolves both databases from the bound project's `postgres` and `sandbox-postgres` services. Under the recipe the in-portal ChangePromotion deployer refuses before any effect (WWMD `DI-062828328841`). Delivery goes through the protected PR, merge and canonical self-upgrade, whose promoter owns backup and migrations, while installs without the recipe keep today's path.
- Teardown and preview sign-in refuse before any effect under the recipe, and Docker discovery already reports `docker_unavailable` there because no socket is mounted. Their actuator owners need owner decisions on destructive authority, preview secrets and discovery scope, filed as `BI-155B9FAA`, `BI-69F46345` and `BI-E25BC197`. The cutover guard then holds no pending writer-reachable Docker caller.
- Keep one typed actuator contract and one switch. The socket's reply types live in `scripts/lib/scope-writer-observation.d.mts`, and portal code imports the actuator only through `apps/web/lib/platform-runtime/actuator-client.ts`. `usesPrivateActuator` and `usesPrivateActuatorSync` are the only mount checks, and they fail closed: an unreadable mount table counts as mounted, and only a successful read with no actuator mount selects the legacy path. The client sends only to the canonical actuator socket. Installs without the actuator keep their original promoter launch (`docker run --rm`), promoter sweep and enrollment locks; the durable owned launch, the owner-settled sweep and the canonical lock order apply only on the actuator path.
- In the admitted candidate runtime, exercise each operation family through its normal entry point. Check that restricted operations are refused before Docker dispatch. Verify raw socket removal, daemon network isolation and closure of writable host inputs used by privileged actions. Keep producer and observer in the same runtime recipe exercised by AC-3.

## Phase 3 · Bind restart evidence to the claim transaction (AC-1, AC-2, AC-3)

- Add failing enrollment tests for malformed calendar values, padded Docker fractions, same-ID portal and sandbox restarts, sub-millisecond reversal, future values, mismatched runtime identity and reappearing retired containers. Use an exact UTC fractional comparison for accepted identity. Preserve current authority and signed-run checks.
- In `scope-epoch-enrollment.server.ts` and `scope-claim-store.ts`, use the existing `lockRuntimeTransitionAdmission` and self-upgrade admission lock while holding the real claim transaction. Keep command and room lock ordering. Attach a bounded trusted closing observation to fresh epochs. Reuse per-process package proof and leave existing same-owner refreshes free of qualification I/O. Cover keyed receipt and unkeyed activity paths.
- In the canonical mutation launchers, recheck active admission while holding those same locks. Keep owned action reservations and rows fenced until launch and descendant closure are established. Verify both orders through actual competing producer transactions and the case where preliminary observations precede a complete intervening transition.
- On the isolated served runtime, acquire new scope after a same-container restart and refuse incompatible runtime. Stop the actual writer after qualification, after the room lock and after scope/receipt writes before commit. Read all effects from a separate connection. Include late-load mutation, confirmed commit, lost reply, and same-ID replay. Measure request latency and admission-lock time. A timeout or unknown observation leaves no new epoch.

## Phase 4 · Verify and deliver (AC-4)

- Reconcile exact changed paths and run `gate:context`, resolve related tests and affected guards, then run focused coverage, typecheck and the exact-tree shared gate. Include hashes of the attested image, effective recipe, commit, merged tree and real negative and positive evidence. Keep fixture lock and crash results scoped to the fixture.
- Land through the DCO and protected PR path. Coordinate canonical self-upgrade with the recorded owner, then verify live successful scope enrollment and incompatible-evidence refusal through the normal entry point. Keep the existing signed retirement evidence intact. If an unqualified rollback is necessary, preserve existing epoch records and keep new qualification held.

## Governed review split

Coordinator ruling (2026-11-26, BI-224F56F1 activity cmwxiad8b100n0esexdf52173) keeps the restart repair on this item and the existing objective baseline. The split bounds the review artifact. It does not split runtime acceptance or authorize an intermediate activation.

Keep [PR #7226](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/7226) open with auto-merge off as the tracking PR until every layer has landed. Use a Git-order stack and publish serially to protected `main`. Do not publish PRs with a non-main base. Re-pin each layer on current `main` after its predecessor lands, run the exact-tree shared gate on a coordinator-approved slot, and have the native reviewer assess the full incremental diff with at least 25% context unused. Split a layer again before review if it cannot fit. Use governed `pnpm land` for each admitted layer. Never arm auto-merge by hand.

| Layer | Depends on | Scope | Restart admission |
| --- | --- | --- | --- |
| 1 | Current `main` | First, carry the approved design byte-for-byte and this amended plan in a docs-only commit. After the fresh receipts admit implementation, add the parameterless Docker-prune facade, private socket and actuator ownership. This supplies the receiving seam for BI-CA6F5A93. | Off. No recipe label, no call to the new qualification path. |
| 2a | 1 | Routine operations, typed diagnostics and configured database ownership. | Off. No recipe label, exact-cohort legacy check remains. |
| 2b | 2a | Owned promoter launch and sweep, plus shared admission locks. | Off. Claim dispatcher does not use the new qualification path. |
| 2c | 2b | Shared upgrade source preparation and packaging closure. | Off. No qualified writer or recipe selection. |
| 2d | 2c | Authorized source-writer operation and caller cutover. | Off. No recipe label or mount-based enablement. |
| 2e | 2d | Candidate-stage, release and runtime protocol owners. | Off. No change to ordinary restart admission. |
| 2f | 2e | Sandbox streams, transactional seed and document conversion. Carries both stream fixes and CodeQL #545. | Off. No permissive temporary observer or actuator fallback. |
| 2g | 2f | Hardened OCI recipe, boot packaging and cutover census. | Off. The official image label is absent. Exercise the recipe only on the admitted test target. |
| 3 | 2g | Exact restart qualification, signed identity and closing proof inside the claim transaction. Carries CodeQL #544's descriptor-based fix. The design and plan live in layer 1, not here. | Off. A mounted or unknown candidate cannot call the proof or fall back to raw Docker. |
| 4 | 3 | Official recipe selection and canonical restart dispatch. Prove live fresh acquisition and incompatible-evidence refusal in the governed runtime. | Enables the path only after the existing writer, transition and retirement predicates pass. AC-3 and AC-4 remain atomic. |

For every layer before 4, test the public claim entrypoint against a changed start time for the same container. Assert it refuses and does not persist a new scope or receipt. Also assert the official image label is absent and the canonical promoter cannot select the recipe. Retain the exact legacy verification path. An isolated helper pass is not live acceptance. Preserve #7226's review and CodeQL history, carry the findings with their receiving code, and do not dismiss any alert.

Respect DPF2 quiet windows. A quiet-window lock or announcement holds tests and hooked commits. Run no shared gate until the coordinator grants a slot for the exact layer head.

Reconcile plan/backlog coverage and plan review against the immutable layer-1 amendment through the normal tools. The preceding approval and coverage receipt are historical until they have been verified for the amended artifact.

## Backlog coverage

**Backlog item:** `BI-224F56F1`

- Decision: atomic
- Parent: `BI-224F56F1`
- Receipt: `cmwwp0vfd12hz0eo2hzkgllvs`
- Dependencies: none
- Rationale: The phases are not independently shippable. An upgrade that only changes the timestamp predicate would reopen scope without the reviewed writer guarantee, and the immutable recipe cannot be enabled until the Docker authority migration removes every writer-reachable raw caller.

All four phases implement a single repair on BI-224F56F1. The authority migration, immutable launch recipe, continuity comparison and claim-local proof require coordinated delivery. An upgrade that only changes the timestamp predicate can reopen scope without the reviewed writer guarantee. The separate runtime, PR-automation and cost-control workstreams retain their own carriers.

DPF recorded schema-v2 coverage `cmwuy4nri09780ert8i2jyc5n` against baseline
`baseline-5ae828d5-0109-4427-a8e5-00cfe16cd433` and independently approved the
plan at `d94d7af76f70`. The status and evidence annotations above record that
decision. Keep the receipt bound to its exact provider plan blob and verify
current plan coverage as part of source reconciliation.

| Phase | Objectives | Contract | Flow | Acceptance evidence |
| --- | --- | --- | --- | --- |
| qualify-portal | OBJ-WRITER | Immutable served launch recipe | Resolve image → validate recipe → attest full portal ID | AC-2 and AC-3. Boot and rollback under the leased runtime, with native-load and mutation refusal evidence. |
| constrain-docker | OBJ-WRITER | Typed actuator operation policy | Recheck existing authority → resolve exact target → execute owned operation | AC-2 and AC-3. Positive entry points and negative target, mount, argument and network checks. |
| bind-claim | OBJ-CONTINUITY, OBJ-WRITER | Existing claim, receipt and admission transaction | Acquire locks → observe current cohort → settle effect and receipt | AC-1, AC-2 and AC-3. Real restart, incompatible runtime, lock races, crash, lost reply and rollback. |
| deliver-repair | OBJ-DELIVERY | Protected release and canonical self-upgrade | Review exact source → merge → upgrade → acquire live scope | AC-4. Governed gate evidence and live successful and refused claims. |
