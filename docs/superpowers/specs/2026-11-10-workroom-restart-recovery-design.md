---
status: active
---

# Workroom scope enrollment after an ordinary container restart

Implementation item: BI-224F56F1. Design Workroom: WC-228D7A07.
Branch: `codex/workroom-restart-recovery`.
Delivery classification: large design work. The normal same-item claim admitted
this classification on November 14, 2026 (IRD-8265DDFD5FCF). The selected
canonical portal design is submitted for independent review.
Historical contract: `docs/superpowers/specs/2026-10-14-owned-workroom-scope-release-design.md`.
The delivered historical BI-B13239B1 is not reopened. BI-7B1D74B3 owns separate agent cost controls.

## Reproduction and boundaries

At verified main `cc34280ba737347be8b4d9d575f8cdd0b5dc4d19`,
`apps/web/lib/work-capsules/scope-epoch-enrollment.server.ts:110-114` compares
the entire authenticated replacement cohort with a fresh Docker observation.
`StartedAt` changes on ordinary restart even when the container IDs, images,
daemon and project do not change. Live read-only observations found identical
portal/sandbox IDs and daemon, November 6 recorded starts and November 10
04:45:28 current starts. No running service, deployment proof or database row
was changed to reproduce this.

Two added restart regressions failed with `current-cohort-unproven` before the
candidate change; 15 existing/negative cases passed. Candidate source commit
`184bdae2f8b4e54444d8bc766635dc511fb9f37e` on the separate cost-controls branch
passed 32 enrollment/import Vitest tests, 16 authenticated-retirement Node tests
and web typecheck. It is preserved evidence, not an admitted implementation or
independent approval of this workroom. Publication and served validation are unrun.

Later `matching-canonical-run-unproven` and missing final SUR-C457D1F6 evidence
are distinct canonical-runtime recovery work. This correction cannot repair them.
Only the canonical runtime owner may advance that install through its governed path.

## Acceptance contract

**OBJ-CONTINUITY:** Restore fresh scope enrollment after a routine restart of the authenticated replacement containers.

**OBJ-WRITER:** Keep the served writer and canonical transition boundary qualified for the whole claim transaction.

**OBJ-DELIVERY:** Deliver through the existing Workroom and canonical release with independent evidence from the real scope path.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-1 | OBJ-CONTINUITY | Same authenticated replacement IDs with valid non-backward restart times no later than observation can qualify. Hold new IDs, malformed, future or backward times, old-container presence and mismatched source, daemon or project. |
| AC-2 | OBJ-WRITER | Preserve signed retirement authentication, packaged writer and image proof, current ownership and transition admission checks. Retain signed evidence as issued and require existing caller authority. |
| AC-3 | OBJ-WRITER | Independently establish stable loaded writer and process qualification and canonical-transition exclusion through transaction commit or atomic abort. Use real after-qualification mutation, lock-race and crash or rollback evidence on the served claim path. |
| AC-4 | OBJ-DELIVERY | Reconcile one current source carrier and record research and covered-plan admission before repair publication. The canonical owner deploys through protected release and verifies real scope acquisition and refusal of incompatible evidence. |

## November 24 reproduction and runtime design

The operator install completed SUR-F511161C on
`e800eb568713723803e3ed56ac5f8c395652f162`.
The signed receipt records portal start `2026-11-24T15:48:23.148553887Z`.
Docker reports the same full container ID at `2026-11-24T16:21:34.296462753Z`.
The sandbox start still matches and quiescence is normal. BI-224F56F1 activity
`cmwux33hq02lp0ertrenbuzxn` retains the original report. After the executor
takeover, the existing design-file scope refreshed with its original epoch.
A fresh, unforced claim for `scope-epoch-enrollment.server.ts` in WC-228D7A07
returned `scope_claim_precondition_failed/current-cohort-unproven`. Design
admission `IRD-5EDB4EE5CA9B` succeeded. Implementation admission
`IRD-45D712633B32` retained `REVIEW_FAILED` and the design and plan obligations.
The first refusal is a runtime precondition failure. The implementation
refusal still requires resolution through the independent review gates.

### Serve the claim from an immutable canonical portal

Retain the same governed MCP dispatch, `prepareScopeClaim`, `claimWorkCapsuleScope`
and `runReceiptedCommand`. This avoids new credential handoffs, startup per
claim and cross-process replies. The canonical promoter already resolves an
image ID and runs `inspectScopeEpochWriterImage`. Extend that owner to qualify
the **served** standalone program and its launch recipe. The image ID binds
the baked file tree. The recipe must keep the actual Node entrypoint, compiled
Next.js chunks, late imports, native dependencies and loader configuration
immutable for the process lifetime. Mount writable data and caches outside
the code and loader paths. Fail closed on a mismatched launch recipe before
enabling fresh scope enrollment. Exercise the same recipe in local CI with
the admitted image and an isolated database before live verification.

The operator selected this construction for review. The running portal uses
the default root user and capabilities, a writable container root, a raw
Docker socket and writable host install and worktree mounts. `docker diff`
found 23,172 `/tmp` entries and 19 `/root` entries, with zero changes under
`/app`. The current package probe hashes copies in `apps/web-src`. Those
observations do not establish loaded-writer stability.

**Launch policy.** `promote.sh` qualifies an exact image ID using
`promoter-epoch-evidence.mjs`. Extend that existing path to validate the
generated effective Compose recipe before launch and the observed Docker
configuration of the full portal ID before completing promotion. The same
recipe must be selected by source, release and rollback readiness. Retain
the existing signed retirement envelope. The closure attestation belongs to
the existing promoter readiness artifact and binds run, source, resolved
image ID, exact portal ID and canonical recipe digest. A probe report must
identify the baked standalone output, native libraries and Node entrypoint
used by that recipe, not only the copied TypeScript contract. The qualified
portal validates this binding and its live process generation on first use.
The local actuator owns the launch evidence and reads it from host-owned
state. The portal receives its bounded projection over the private socket.
Readiness fields echoed by the caller do not authenticate this proof. Publish
the recipe binding after the promoted full ID has been checked and before
fresh enrollment. A same-ID restart reuses the immutable image and recipe
binding and requalifies the live process generation against Docker's current
start and the process's kernel start identity.

- Run the served portal under a fixed unprivileged UID with `read_only: true`,
  `cap_drop: [ALL]`, `no-new-privileges`, private PID and IPC namespaces and
  enforced seccomp. Prevent ptrace and process-memory writes. Verify the
  packaged Node supports `--disable-sigusr1`; disable inspector activation
  at launch and forbid inspector, arbitrary preload, custom loader,
  `NODE_PATH`, native-loader overrides and writable module search roots.
  Boot the known standalone entrypoint via an exact argument list.
- Keep `/app`, interpreter and library paths image-owned. Mount only bounded
  `noexec,nosuid,nodev` temp and cache paths outside the executable graph.
  Relocate root-user caches to those paths. Expose evidence, the transition
  receipt directory, PKI and signing material as narrow read-only inputs.
  Keep backup, federation, map and sandbox data at their declared destinations
  with no executable use by the writer. Make host source and worktrees
  read-only. Move host worktree maintenance, `.mcp.json` writes and source
  preparation outside the served process to the existing authorized owners.
  The privileged owner must read release inputs from verified immutable
  artifacts or a separately owned staging directory, never from writer-owned
  scratch or a writable source mount.
- Validate actual mount namespace and target ancestry, including symlinks and
  nested mounts, before issuing proof. A `noexec` mount still permits source
  reads by an interpreter. Gate the Next server trace and native dependency
  closure on realpath containment inside immutable image trees, audit runtime
  dynamic loads and place mutable input only in data readers. The in-process
  `gpp/shape-language/resolve-sources.ts` and `build/codebase-tools.ts` dynamic
  load paths need explicit closure checks. A child process accepting arbitrary
  command strings is outside this recipe, even when an admin can request it.

**Docker authority.** Bind a private, install-scoped Unix socket from a
canonical local actuator in the Docker VM. Compose mounts only its dedicated
socket directory, outside the loader graph. Do not publish a TCP listener or
forward raw HTTP, a Docker CLI, Compose arguments or caller-supplied command
lines. Use `platform-runtime/docker-socket.mjs` for the actuator's bounded
daemon client and the existing promoter and runtime capability handlers for
privileged effects. Clients send typed operations with bounded payload and
reply, deadline and correlation ID. The actuator resolves project and daemon
from its installation binding, derives target IDs and recipes server-side,
validates exact fields, and rejects all operations outside this table before
calling Docker. For consequential actions reread current authority through
the existing execution, run or lease owner. Files, socket access, names and
caller parameters cannot stand in for that record.
The actuator alone can create, replace or remove the socket and its directory.
Mount the directory read-only for the portal and give only the portal UID and
actuator access. Compare container identity and project before returning a
qualified generation. A binding missing after reboot leaves new enrollment
held until the actuator reconciles against the current signed run and recipe.

| Operation | Owner and admitted target |
| --- | --- |
| Read runtime, logs and lease facts | `operational-state`, `local-ci-capacity-broker`, `preview-runtime-fence`, `substrate-reconciler`, admin logs and Docker discovery request bounded projections of daemon info, admitted project service identity, image metadata and capped service logs. Construct Engine routes internally. No unrestricted inspect, archive, environment, path or filter output. Preview stop is allowed only for the exact full ID and reconciled lease; service start or restart only for catalog-owned IDs after existing health, ownership and consequence checks. |
| Observe scope and probe a package | `scope-epoch-enrollment` asks for a single bounded snapshot of daemon, exact project service IDs and starts, image, recipe, retired-ID absence and canonical actor absence. Only `inspectScopeEpochWriterImage` may start the existing probe recipe against an already admitted image. Fix the entrypoint and arguments, pin the full image ID, forbid network and mounts, drop all caps, use read-only root and fixed resource ceilings. Track probe ownership by full ID, including cleanup on errors. The snapshot operation never launches a probe. |
| Sandbox and build work | `build/sandbox`, `routing` CLI adapters and `workroom-runtime/sandbox-launcher` invoke fixed operations for the current build or Workroom reservation. Permit interactive exec and data streams solely on the admitted sandbox or owned isolated build container, with bounded input and output and no privileged exec. Validate full container ID, image, lease, labels, network, mounts, and absence of raw Docker, host namespaces, host source and writer credentials. Source sync streams only fixed release assets directly from immutable portal assets into the owned sandbox, replacing `docker exec` against portal. Creation and cleanup accept only existing sandbox recipes with server-derived mount and network IDs. |
| Conversion and image readiness | `documents/conversion` uses the existing `command.ts` converter recipe with byte and time caps and input/output streams. Resolve images for `doctools-release-image`, production release identity and preflight by the existing signed artifact owner. No arbitrary image pulls, builds, bind mounts or converter entrypoint. |
| Promote, reconcile, backup, restore and retire | Retain `self-upgrade/promoter`, `runtime-capability-executor`, backup/restore runners, `teardown/dispatcher` and their existing decision owners. The actuator launches only their exact admitted immutable action. Resolve Compose, image, DB service, backup destination and teardown target from the admitted record and current install. Stream backup and restore bytes only between owned endpoints. Prune jobs can remove exact owned unused artifacts after lease and reference checks. No writer-facing production exec, general compose mutation, or per-caller cleanup selector. |
| Admin diagnostics | Replace `admin_run_command` shell fallback with its existing fixed `parseAdminDiagnostic` forms. Map Docker diagnostics to the explicit read operations above. Route migrations, seed, promotion and restore through their named governed owners. Shell commands forwarded to the sandbox cannot obtain the writer's socket, host mounts, database or loader paths. |

The cutover disables the direct Docker clients after migrating these caller
families. A source guard must follow CLI launchers, child shell scripts,
direct HTTP and literal socket paths, including `packages/db` discovery and
maintenance scripts invoked by jobs. Keep the raw daemon on the actuator and
the existing separately trusted host-side controllers. The writer cannot
connect to a daemon over the network. At deployment, attest that the actual
sockets, mounts and networks match the fixed profile. There is no enabling
fallback to raw Docker in the qualified runtime.

**Authorized source writer.** The qualified portal mounts the install
checkout (`/host-dpf`) and worktree base (`/host-worktrees`) read-only. Today
the portal also writes there. Source-mode self-upgrade clones, fetches,
merges, resets and cleans `.upgrade-workspace`, then pushes a ref into the
install repository. Status reads and the release-batch tally run `git fetch`.
Merge-delivery detection refreshes trunk. Skill-seed write-back writes a seed
file. Under the qualified recipe each of these fails, and source-mode installs
could no longer upgrade.

The owner chose a dedicated source writer (decision `DI-250233FBDD9B`,
resolved 2026-11-25). The platform is meant to code itself, upgrade itself
and contribute source, so source mutation is a first-class governed
capability, not a side effect of the web server. The actuator launches a
short-lived source-writer container from the canonical promoter image. It
uses a fixed entrypoint, a fixed operation set, and the install checkout as
its only writable source mount. Each launch is keyed on an existing owner and
rereads that owner before writing: the admitted self-upgrade run for
workspace preparation and ref publication, a bounded freshness refresh
for remote fetches, and the applied revision of a reviewed skill proposal for
seed write-back. For the seed, the actuator rereads that revision and sends
its body only while it is the skill's latest revision and still equals the
live definition, so the portal never supplies the bytes written. The writer
overwrites an existing seed file and never creates one. The container is named and labeled per owner, like an
admitted promoter, and settles a lost reply by exact readback. Neither the
portal nor the actuator holds a writable source mount. Later owners, such as
Build Studio commits, contribution branches and Hive Mind contributions, are
added as new fixed operations with their own owners, not as general Git
access. The cutover guard must also refuse portal code that writes under a
read-only mount, so `portal-immutable-v1` stays held until these writers move.

### Close the observation window in the claim transaction

At `36187bfbd0a6`, the runtime transition coordinator already shares
`lockRuntimeTransitionAdmission` with its production work producers. A new
epoch should use that owner's table-then-advisory order before the existing
`self-upgrade-admission` lock. Keep the keyed command lock first and the
Workroom row lock last. Keep the accepted scope, activity and receipt in the
same transaction. The unkeyed entry uses the same admission check inside its
scope/activity transaction. An enrolled same-owner refresh adds no runtime
qualification.

Authenticate retirement and do the packaged qualification outside the
transaction. After taking the admission locks and checking active and
recovery-required transitions, take a short closing observation through the
trusted observer. Confirm the same run and immutable writer generation,
exact portal and sandbox IDs, daemon and project, and absence of retired
containers and live canonical actuators. This requires a bounded exception
to the existing DB-only lock prefix. An inconclusive observation aborts before
the room write. Establish the duration limit and measure admission lock hold
time in local CI. Keep the probe launch and receipt import outside the locks.
Reuse a checked proof only within its exact transaction. The actuator's
launch path takes the same admission locks and rechecks the current run or
transition before handing a mutating action to Docker. A run retains its
active or recovery-required hold until its launch reservation is closed and
the owned actuator's closure is proven. This closes the interval between an
admission row becoming terminal and a delayed launcher starting. The closing
observer performs bounded Docker reads without reentering PostgreSQL. In
either lock order the transition waits for the claim to settle, or its row
or actuator is present and the claim refuses. For steady state, reuse the
packaged proof within one qualified portal generation. Keep the live closing
observation for fresh epochs and remove the preliminary duplicate Docker
snapshot. Measure the closing deadline from the first byte of the request.
An expired budget ends the transaction with a retryable, no-write result.
Five read-only host observations of daemon identity, inventory and the two
exact runtime containers took a median 612 ms and a maximum 1,063 ms. These
CLI samples exclude actuator policy and database work. Use a two-second
initial ceiling for the closing observation in qualification and report
lock duration and timeout rates under contention before setting the shipped
budget. Reaching the ceiling cannot extend the transaction budget.

Preserve the timestamp candidate's exact-ID rule. Compare fractional UTC
seconds without truncating Docker's nanosecond precision. The candidate's
`Date.parse` comparator accepted a one-nanosecond reversal at the observed
portal timestamp. Add that regression alongside malformed and future-start
cases. Parse UTC seconds with a real calendar round-trip and pad the accepted
fraction to nine digits before comparing seconds and nanoseconds. Keep the
original signed strings. Compare against the lower bound represented by the
observation clock. If a restart falls into the clock's current millisecond,
defer for a fresh observation instead of rounding the start backwards.

### Prove the served path before delivery

Use real served MCP on the qualified image and the leased test database.
Restart the same container and acquire new scope. Refuse incompatible images,
replacement IDs, unsafe mount/loader configuration, backward times and
reappearing retired containers. After qualification, attempt a mutation of a
late-loaded writer dependency through the served runtime's actual boundaries.
Show launch-policy exclusion or atomic refusal. Race both canonical admission
writers in both lock orders and complete a transition between preliminary
observation and the transaction to test the closing check. Terminate the
actual served writer after qualification, after the room lock and after its
writes before commit. Read scope, activity and keyed receipt from another
database connection. Include an acknowledged commit and a lost reply with
readback of the original command. The earlier marker tests cover PostgreSQL
lock lifetime and process rollback in their fixtures.

### Implementation sequence and backlog coverage

Each phase serves BI-224F56F1 in WC-228D7A07. The actuator migration and
runtime recipe must land together. The timestamp comparison alone cannot
establish safe enrollment. Neither source-only tests nor a deployed proof
without the repair delivers the outcome.

1. **Launch recipe and runtime trust (AC-2, AC-3).** Use `Dockerfile`,
   `docker-compose.yml` and its release overlays, `runtime-secret-bootstrap`,
   `portal-migrate-boot`, `promote.sh` and `promoter-epoch-evidence`. Add
   build and pre-swap checks for mounted paths, launch identity and image
   identity. Boot the same recipe on local CI and prove migrations, startup,
   portal health, native import, caches and ordinary launch behavior.
2. **Constrain actuator operations (AC-2, AC-3).** Move the caller inventory
   above to the install actuator, preserving admission and output contracts.
   Verify each production operation with fixed targets in the leased runtime.
   Test denial of cross-project targets, arbitrary compose and arguments,
   forbidden mounts and loader changes, writes to host source and production
   access from the isolated qualification network and database.
3. **Wire the actual claim (AC-1, AC-2, AC-3).** Use
   `scope-epoch-enrollment.server.ts`, `scope-claim-store.ts`,
   `command-receipts.ts`, `platform-runtime/work-admission.ts` and the
   self-upgrade admission store. Reuse exact prepared transaction ownership
   and existing claim and receipt locks. Add regressions first for time
   precision, both lock orders, delayed launch, changed observations, rollback,
   same-container restart and missing or conflicting receipts. Run affected
   suites, web typecheck, guard obligations from the fresh impact contract
   and the served verification matrix above.
4. **Protected release and acceptance (AC-4).** Submit only exact verified
   source and runtime identities. Preserve DCO, required PR gates and the
   canonical `request_self_upgrade` lane. The installed release must pass
   real restart acquisition and incompatible-identity refusal before closure.
   On regression, use the approved rollback path and keep new enrollment held
   if the prior release cannot prove identity. Preserve scope rows and signed
   retirement evidence. Never restore raw Docker as a qualification fallback.

This sequence is an internal plan while fresh plan-file scope is held by
`current-cohort-unproven`. Publish the covered plan under `docs/superpowers/plans/`
when that path can be admitted. The large-work coverage writer requires the
baseline minted by independent spec approval before plan review. No coverage
receipt or passing review is claimed here. AC-3 remains open pending served
evidence on the approved recipe.

## Review history and verification gates

The November 14 local qualification profile and closed-worker proposal are
historical alternatives. The operator selected the canonical portal with its
existing claim transaction. The [preserved historical draft](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/01d6440e11da37096a9b9fddd538187f16ccd2d5/docs/superpowers/specs/2026-11-10-workroom-restart-recovery-design.md)
records the original failed design and spec approvals, architecture review,
packaging measurements and bounded marker evidence. Their receipts retain
those exact artifacts. The November 24 design-spec failure on `06e8a2535e32`
(`initiative-review-v1-183f13e693f8d34e163fb90afeb20b1984f1d1cdf58d23847cd0e5fbe694797b`)
identified the historical profile's unresolved prerequisites as ambiguities in
that revision. This specification makes the selected proposed construction and
its verification path the review subject.

Design review evaluates the implementation contract and whether its tests
can establish the writer guarantee. A passing independent spec review is
required to mint the baseline. Plan coverage and independent plan review then
admit implementation and qualification through the existing governed runtime.
The actual runtime and transaction evidence required by AC-3 is a delivery
condition. If review requires an executed feasibility proof before admitting
implementation, it must name the required evidence and issue a bounded
qualification route that can run on the actual candidate recipe. Production
fault injection and marker-only substitutes cannot satisfy that requirement.
