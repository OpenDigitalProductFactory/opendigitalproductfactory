# Install and Self-Upgrade Refactor Parity Design

**Date:** 2026-07-18  
**Status:** Design approved in principle; pending document review  
**Scope:** Installation, reinstall, uninstall, diagnostics, release gates, documentation, and governed self-upgrade

## 1. Problem

Two platform refactorings did not propagate completely through the lifecycle surface:

1. Neo4j and Qdrant were removed from the runtime, but active scripts, diagnostics, package commands, release configuration, and operator documentation still describe or probe them.
2. The promoter was consolidated into the portal image, but the running N-1 portal remained responsible for constructing and launching the next promoter. Missing build inputs and missing host-state mounts therefore broke self-upgrade before the new portal could repair the path.

PRs #3270 and #3272 repaired the immediate promoter build-context and state-mount defects. The incident nevertheless exposed a systemic gap: source-local tests validated the new implementation, while no acceptance gate exercised the old running portal upgrading to the candidate. The upgrade path also discovers some readiness defects only after the portal has entered its quiescence sequence.

The desired result is a smaller, accurate lifecycle surface whose architectural claims are executable invariants, and an upgrade pipeline that proves it can cross the N-1 boundary before it risks the running portal.

## 2. Goals

- Remove Neo4j and Qdrant from every active, operator-facing, or executable lifecycle contract.
- Preserve historical evidence and the bounded removal/migration mechanisms that are still intentionally needed.
- Establish one machine-readable definition of active lifecycle surfaces and permitted legacy references.
- Validate promoter image contents, mounts, state, capabilities, and Docker access before portal drain.
- Exercise the actual N-1 portal-to-candidate upgrade boundary for upgrade-sensitive pull requests and nightly.
- Keep Windows PowerShell 5.1+ and macOS/Linux Bash installation paths behaviorally equivalent.
- Fail closed with a precise remediation while leaving the current portal available.

## 3. Non-goals

- Reintroducing Neo4j or Qdrant as optional runtime services.
- Rewriting immutable migrations, historical incident reports, research, or benchmark evidence.
- Adopting the complete TUF signing ecosystem in this change.
- Replacing the current self-hosted promoter with a mandatory public registry artifact.
- Creating per-worktree long-lived DPF runtimes.
- Changing the product data model or introducing a database migration.

## 4. Research and Benchmarking

### 4.1 Open-source leaders

**The Update Framework (TUF).** TUF uses versioned trusted metadata to prevent rollback, freeze, and mix-and-match attacks. DPF should adopt its principle that an updater consumes an explicit, versioned contract rather than inferring compatibility from loose files. Full threshold signing is outside this remediation's scope. Source: [TUF specification](https://theupdateframework.github.io/specification/v1.0.20/).

**Mender Artifact.** Mender artifacts declare identity, compatible device types, checksums, and `Provides`/`Depends` relationships. DPF should similarly declare the portal/promoter contract version and required embedded inputs, then test the consumer/provider pairing across N-1. Source: [Mender Artifact documentation](https://docs.mender.io/overview/artifact).

**RAUC.** RAUC bundles have a manifest, a compatible target, version constraints, and lifecycle hooks. DPF should adopt a manifest-backed compatibility check and explicit pre-install hook semantics, while rejecting hardware-slot concepts that do not fit a containerized portal. Sources: [RAUC basics](https://rauc.readthedocs.io/en/latest/basic.html) and [RAUC reference](https://rauc.readthedocs.io/en/latest/reference.html).

### 4.2 Commercial products

**Octopus Deploy.** Octopus snapshots a release's process and assets, uses ordered deployment steps, and retains previous successful releases for rollback. DPF should make its promoter inputs a versioned release contract and retain explicit recovery evidence. Sources: [Octopus deployments](https://octopus.com/docs/deployments), [deployment processes](https://octopus.com/docs/best-practices/deployments/deployment-and-runbook-processes/), and [rollbacks](https://octopus.com/docs/deployments/patterns/rollbacks).

**AWS CodeDeploy.** CodeDeploy exposes ordered lifecycle hooks, including validation before traffic shifts, and rolls back by deploying the last known-good revision as a new, auditable deployment. DPF should preserve distinct run identity and add a pre-quiescence validation stage. Sources: [CodeDeploy lifecycle hooks](https://docs.aws.amazon.com/codedeploy/latest/userguide/reference-appspec-file-structure-hooks.html) and [rollback behavior](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployments-rollback-and-redeploy.html).

**Azure App Service deployment slots.** Azure supports swap-with-preview: apply production settings to staging, warm it, validate it, then complete or cancel the swap. DPF cannot use slots directly on a single-host Compose install, but should adopt the same ordering—validate the replacement under target configuration before disrupting the current service. Source: [Azure deployment slots](https://learn.microsoft.com/en-us/azure/app-service/deploy-staging-slots).

### 4.3 Adopted and rejected patterns

Adopt:

- explicit compatibility and content manifests;
- readiness checks before quiescence or traffic change;
- previous-version acceptance testing;
- last-known-good recovery evidence and auditable run identity;
- one lifecycle definition consumed by validation and CI.

Reject:

- duplicated hand-maintained file lists;
- optimistic discovery after drain;
- tests that launch the candidate only from candidate code;
- blanket deletion of historical evidence;
- always-running per-worktree integration stacks.

The gap DPF must fill is offline, self-hosted bootstrap compatibility: the old portal is both updater client and builder of the next updater. The test topology must preserve that direction of control.

## 5. Architecture

### 5.1 Canonical lifecycle-surface policy

Add a repository-owned policy module consumed by a fast invariant test. It defines:

- active installation, reinstall, uninstall, diagnostics, release, package-command, and current operator-documentation paths;
- forbidden retired-runtime tokens and operational patterns (`neo4j`, `qdrant`, retired ports, restart commands, credentials, and health probes);
- narrowly scoped legacy exceptions with a reason and an expiry/removal condition;
- promoter contract inputs derived from `Dockerfile.promoter`, never duplicated in an installer comment or array;
- required state-directory wiring from host, through Compose, into the promoter launch.

Exceptions are allowed only for immutable migrations, historical research/incident evidence, decommission tooling, and explicitly temporary transition code. An exception identifies the exact file or bounded line pattern and why runtime removal would be unsafe. Broad directory exclusions are prohibited.

The policy test runs in the standard unit-test lane and release gates. Adding a retired dependency to an active lifecycle path fails with the offending file and rule.

### 5.2 Parity remediation

The implementation updates these active surfaces as one concern:

| Surface | Required result |
|---|---|
| `AGENTS.md` architecture and safety prose | Postgres-only current runtime; Neo4j/Qdrant references clearly historical where retained |
| Windows fresh install/reinstall | `install-dpf.ps1`, `scripts/fresh-install.ps1`, and `dpf-reinstall.ps1` contain no retired credentials, services, volumes, or operator messages; valid lifecycle state is created and validated |
| Windows uninstall | `uninstall-dpf.ps1` preserves or deletes state/backups only according to its explicit operator mode and never broadens its Compose target |
| macOS/Linux fresh install/reinstall | `install-dpf.sh`, `scripts/setup.sh`, and `dpf-reinstall.sh` have the same services and state semantics as Windows |
| macOS/Linux uninstall | `uninstall-dpf.sh` matches Windows preservation/deletion semantics and safety refusals |
| diagnostics preflight | No Qdrant health probe, collection check, or restart advice |
| package commands and release workflow | Remove retired graph commands and environment variables |
| current user/operations documentation | Describe PostgreSQL authority and current memory implementation only |
| decommission/migration paths | Retain only where still required, label legacy intent, and register a policy exception |

Installer completion must prove that the canonical host state directory exists, `install-state.json` parses, required identity/version fields exist, capability projection succeeds, and the portal receives the same host path it will later pass to the promoter. This prevents a successful install from producing a system that cannot self-upgrade.

The shared behavior matrix is:

| Operation | Windows entrypoint | Bash entrypoint | Required behavior |
|---|---|---|---|
| production install | `install-dpf.ps1` | `install-dpf.sh` | Compose project `dpf`; platform-default state directory; Postgres-only stateful service set; create and validate upgrade state |
| contributor setup | `scripts/fresh-install.ps1` | `scripts/setup.sh` | isolated project name when not the canonical root; Postgres-only dependency; no production-data deletion |
| reinstall | `dpf-reinstall.ps1` | `dpf-reinstall.sh` | preserve state and backups by default; destructive reset requires the existing explicit reset mode; regenerate/validate lifecycle state |
| uninstall | `uninstall-dpf.ps1` | `uninstall-dpf.sh` | preserve state/backups by default; remove only explicitly selected DPF data; refuse root/home/unresolved paths and unrelated Compose projects |
| diagnostics | `scripts/verify-install-windows.ps1` and installer library probes | `scripts/verify-install-edge.sh` and `scripts/installer/lib/doctor.sh` | report the same Postgres, portal, state, promoter, and Docker contract |

Windows uses the existing ProgramData/user-scope path resolution owned by `scripts/installer/lib/state.ps1`; Bash uses the XDG/home resolution owned by `scripts/installer/lib/state.sh`. Those modules remain the only platform-specific default owners. Tests compare resolved behavior, not literal platform paths. Platform Compose overlays may change host integration, but not service authority, project identity, preservation policy, or the promoter contract.

### 5.3 Candidate promoter artifact and contract manifest

The forward-compatible bootstrap is a separately identifiable **candidate promoter OCI image**. Candidate CI builds it from the candidate revision and labels it with the candidate source SHA and immutable manifest digest. The old portal does not synthesize candidate behavior from its own baked scripts: after isolated target-source preparation, it resolves the target-SHA image, verifies its labels/digest, and launches that exact digest. The existing local JIT path remains an offline fallback, but it builds `Dockerfile.promoter` from the prepared candidate source, not from files baked into the caller portal.

This introduces a protocol floor. Portals at or after that floor understand target-SHA artifact resolution and schema negotiation. A pre-floor portal can still perform the one transition using its existing legacy promoter path, but cannot itself enforce or claim pre-drain readiness evidence; installers repair/validate its state before that transition. For the protocol-introduction PR only, the N-1 CI bridge independently runs readiness against the candidate digest before it asks the pre-floor portal to upgrade, records and binds that digest/report in harness evidence, then injects the same digest through the already-supported custom promoter-image setting. A readiness failure means the bridge never requests upgrade. This proves the transition without pretending the unmodified baseline owns the check. Production pre-floor transitions remain explicitly `legacy-bootstrap` and rely on the repaired legacy recovery path; the UI/evidence must disclose that readiness was unavailable. After the protocol lands, all baselines must discover the candidate image by target SHA and enforce readiness themselves without bridge injection. Unknown pre-floor callers are never reported as readiness-validated.

The canonical manifest is a checked-in JSON document in the promoter source tree, validated by JSON Schema and embedded unchanged in the image. Build tooling adds OCI labels for `source-sha`, `contract-schema`, and `contract-digest`. Schema version 1 declares:

- contract schema version;
- promoter entrypoint and required embedded files;
- Dockerfile-derived build inputs;
- required mounts and their access modes;
- required environment/state fields;
- minimum and maximum caller protocol versions.

The manifest owns field names and compatibility semantics; `Dockerfile.promoter` remains the source of truth for COPY inputs. A caller accepts only a known schema whose caller-protocol range includes it. Missing manifests, unknown schemas, incompatible ranges, SHA mismatch, or manifest/label digest mismatch fail closed. The portal resolves a tag to a digest once, readiness runs that digest, and promotion launches the same digest. A tag change after readiness is irrelevant; a digest change is rejected. This prevents validating one image and launching another.

### 5.4 Pre-drain readiness contract

The promoter exposes a readiness mode. “Non-mutating” means it cannot modify the running portal, database, canonical install source, or canonical lifecycle state. It may pull/build an image and start an ephemeral container in a uniquely named scratch context; every container and temporary path is deterministically removed, while content-addressed image cache may remain.

The ordered state machine is:

1. resolve the target SHA without changing the install clone;
2. prepare target source in an isolated upgrade workspace;
3. acquire/build the target-SHA promoter artifact and resolve its immutable digest;
4. run the ephemeral readiness container against scratch/read-only projections;
5. merge the readiness report into run evidence;
6. start and await quiescence;
7. create the governed recovery point while writes are drained;
8. launch the already-validated promoter digest for swap;
9. verify health, complete evidence, or execute rollback.

No canonical source/state mutation and no portal/database service disruption are permitted before step 6. If current source-preparation code cannot meet that rule it must be refactored to the existing isolated workspace path before readiness is enabled.

The check returns a structured `PromoterReadinessReport` containing the contract version, image identity, checked capabilities, and bounded failures. Checks include:

1. image exists and its configured entrypoint starts;
2. embedded scripts and manifest are readable;
3. Docker socket/API access is usable for the operations required by promotion;
4. source and state mounts resolve with required read/write modes;
5. `install-state.json` is present, parseable, and compatible;
6. capability catalog projection completes without mutation;
7. required Compose project/install identity is internally consistent;
8. recovery and transition-secret parent locations are accessible as required.

Readiness MUST NOT stop, drain, recreate, or mutate portal/database services. A failure marks the self-upgrade run failed, writes `completionEvidence.readiness.stage = "preflight"`, and leaves the current portal serving traffic. User-facing remediation names the failed contract and action; it does not expose secrets.

Successful readiness is necessary but not sufficient for promotion. Existing recovery point, quiescence, swap, health verification, and rollback behavior remain authoritative.

### 5.5 N-1 acceptance topology

The acceptance harness uses an isolated, uniquely named Compose project and temporary host state. It performs the following causal sequence:

1. select the exact pull request base SHA and verify through the GitHub Checks API that it belongs to `main` and its required build/acceptance checks succeeded;
2. check out that exact SHA, build the baseline portal/promoter inputs, and label the resulting image with the SHA (or pull a SHA-labelled image and verify its digest and source label);
3. install and boot the baseline portal with baseline lifecycle state;
4. expose the candidate as the target revision;
5. for the protocol-introduction case only, have the external CI bridge run candidate readiness, bind its passing report to the candidate digest, and stop without requesting upgrade on failure;
6. request upgrade through the baseline portal API, so baseline code resolves and launches the candidate-SHA promoter digest (the protocol-introduction case injects the already-validated digest through the existing custom-image setting);
7. for post-floor baselines, assert the portal itself runs readiness before drain; for the introduction baseline, assert the bridge completed readiness before the upgrade request and the baseline does not claim it performed the check;
8. wait for the governed swap and candidate health/version evidence;
9. assert state migration, portal availability, and recovery evidence;
10. on injected readiness failure, assert no upgrade request was made and the baseline portal remains healthy and undrained;
11. inspect the launched image labels/evidence to prove candidate promoter bytes—not baseline-baked bytes—performed readiness and promotion;
12. tear down only the uniquely named harness project and temporary data.

The harness may cache SHA-labelled baseline images, but cache absence triggers a source build of the verified SHA and cannot change semantics. The authoritative acceptance fact is the GitHub required-check record for that base SHA; the authoritative bytes are the resulting content-addressed digest carrying the same source label. Required PR CI fails rather than skips when the SHA, check record, source, base image, or digest cannot be verified. Nightly CI reports the same condition as a failed run. CI retains candidate and diagnostic artifacts for 30 days; immutable source remains reproducible from the repository. It must not reuse the root `dpf` Compose project or canonical live volumes.

“N-1” means the pull request's exact, required-check-green main base SHA. This is deterministic and reproduces the portal the candidate must replace; it is not `HEAD^`. If main advances, the PR is updated/rebased and tests the new base. The workflow records both SHAs and image digests.

### 5.6 CI policy

Two lanes balance confidence and cost:

- **Required path-sensitive PR lane:** runs when changes touch promoter Dockerfiles/scripts, self-upgrade code, Compose/state wiring, installers, lifecycle policy, capability catalog/migration, or the N-1 harness itself.
- **Nightly full lane:** runs even without matching changes to detect base-image, Docker, dependency, runner, or environmental drift.

A small classifier test owns the path list, and a workflow test proves every contract-owned path triggers the lane. The required lane cannot be silently skipped by renaming a file because the lifecycle policy inventory and trigger inventory are cross-checked.

Fast invariant and unit tests run on every relevant PR. Runtime-bound N-1 execution uses the governed shared local-CI environment or a uniquely isolated CI Compose project, never the root live portal.

### 5.7 Failure and evidence semantics

Reuse the existing self-upgrade run record. Add no new database table. `completionEvidence.readiness` is the canonical structured location for both success and failure and contains `stage: "preflight"`; `failureLog` contains only bounded, redacted human text. Evidence writes perform a read/merge/write that preserves existing `recoveryPoint`, `rollback`, and future keys. A retry replaces only `readiness` with the new attempt while retaining a bounded `attempts` summary. Each report includes:

- baseline/caller portal SHA when known;
- target SHA;
- promoter image identity and contract version;
- readiness start/end and result;
- failed check codes without secrets;
- whether quiescence began (must be false for readiness failure).

The readiness object has a fixed serialized size cap; individual messages and attempt history are capped before persistence. Logs remain diagnostic detail; the structured report is the stable machine contract.

## 6. Security and Safety

- The readiness report never returns environment values, tokens, Docker credentials, or transition secrets.
- Docker access is tested with the minimum non-mutating API operations needed to establish capability.
- Paths are canonicalized and constrained to the isolated harness or configured DPF state/source roots.
- Cleanup refuses broad, unresolved, root, home, or canonical `dpf` Compose targets.
- Legacy-reference exceptions require reviewable exact scope, rationale, and removal condition.
- The upgrade fails before drain on contract mismatch; it does not attempt an inferred fallback with partial state.

## 7. Test Strategy

Implementation follows test-driven development.

### 7.1 Fast tests

- retired-runtime lifecycle policy initially fails on every audited active reference;
- policy allowlist accepts only exact historical/decommission cases;
- Dockerfile parser and manifest agree on promoter inputs;
- required Compose/state wiring invariant detects a removed mount or environment bridge;
- readiness report schema, redaction, ordering, and failure mapping;
- readiness evidence merge preservation, retry replacement/history bounds, serialized size cap, and secret redaction;
- manifest/image source-SHA and digest binding, unsupported older/newer schemas, incompatible caller ranges, and tag replacement after digest resolution;
- installer state validators use identical fixtures on PowerShell and Bash paths;
- workflow path classifier covers every upgrade-sensitive path.

### 7.2 Integration tests

- promoter readiness succeeds with valid image, Docker access, mounts, state, and capabilities;
- each readiness dependency can fail independently and leaves portal quiescence untouched;
- isolated Windows PowerShell 5.1 and Bash harnesses exercise fresh install, reinstall, uninstall, and diagnostics behavior—not syntax alone—and produce upgrade-ready lifecycle state;
- reinstall preserves state/backups by default, uninstall follows its explicit preservation mode, and destructive fixtures refuse the root `dpf` project, canonical user data, home, root, and unresolved paths;
- protocol-introduction N-1 bridge validates the candidate digest before requesting the pre-floor upgrade, refuses the request on failure, and the pre-floor portal never claims it enforced readiness;
- post-floor N-1 baseline portal enforces readiness before drain, upgrades to candidate, and reports the candidate SHA healthy;
- N-1 evidence proves the launched promoter source label and immutable digest belong to the candidate;
- a deliberately incomplete promoter image fails before drain;
- a missing/invalid state mount fails before drain with actionable evidence;
- manifest/image mismatch, unknown schema, incompatible protocol range, and attempted tag replacement fail before drain;
- rollback/recovery behavior remains green for a failure after quiescence.

### 7.3 Mandatory gates

- targeted unit tests;
- web typecheck and production build;
- PowerShell 5.1 syntax/behavior checks and Bash syntax tests;
- path-sensitive N-1 acceptance;
- installer/reinstall/uninstall parity assertions;
- no migration gate unless implementation unexpectedly changes schema.

## 8. Acceptance Criteria

1. The enumerated active lifecycle surfaces and current operator documentation contain no operational Neo4j/Qdrant dependency; every retained reference there is a precise approved legacy exception. The policy also proves those surfaces cannot invoke remaining legacy Neo4j/Qdrant modules. Other executable consumers discovered during implementation must either be removed in this PR or explicitly classified outside the lifecycle boundary with an owner and separate removal decision—never silently excluded while claiming whole-repository removal.
2. The named Windows and Bash entrypoints install, reinstall, diagnose, and uninstall the same Postgres-only service set, preserve state/backups by default, use platform-owned state defaults, maintain the intended Compose project identity, and refuse destructive cleanup of the root project or canonical user data in isolated tests.
3. A clean install produces lifecycle state that passes promoter readiness without manual reconstruction.
4. Every promoter COPY input is automatically staged and validated without a second hand-maintained list.
5. At and after the protocol floor, missing image contents, Docker access, mounts, state, or capability compatibility fail before portal quiescence. The one pre-floor transition is visibly classified `legacy-bootstrap`; its CI bridge refuses to request upgrade when candidate readiness fails, but the product does not falsely claim the old portal enforced that check.
6. The required PR workflow verifies the exact green main base SHA and exercises that portal upgrading with the immutable candidate promoter digest for every upgrade-sensitive change; candidate image labels/evidence prove candidate bytes ran. The introduction run records bridge-owned readiness, while every later run records portal-owned readiness.
7. A nightly N-1 workflow detects environmental drift.
8. Readiness and upgrade evidence identify baseline, target, promoter contract, and whether drain began.
9. All mandatory build gates pass and the change lands through one signed, pushed, ready-for-review PR.

## 9. Delivery Boundaries

This is one concern: lifecycle parity and upgrade-boundary safety after the two related refactorings. Implementation may be organized into commits for policy/remediation, readiness, and N-1 harness, but ships as one PR so the enforcement cannot land separately from the cleanup it enforces.

No retired reference is removed blindly. If a decommission or migration path is still required for upgrades from an older supported install, it remains executable, explicitly labeled, narrowly allowlisted, and covered by the N-1 fixture until that source version leaves support.

The initial supported-source floor is the main revision immediately preceding this protocol's merge. Each retained compatibility exception records that SHA as its oldest supported source and a removal milestone of “after all supported installs report a successful post-protocol upgrade.” Tightening that floor requires an explicit release decision and corresponding policy update.
