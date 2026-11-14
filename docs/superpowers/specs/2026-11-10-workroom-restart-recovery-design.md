---
status: draft
---

# Workroom scope enrollment after an ordinary container restart

Implementation item: BI-224F56F1. Design Workroom: WC-228D7A07.
Branch: `codex/workroom-restart-recovery`.
Delivery classification: large design work. The normal same-item claim admitted
this classification on November 14, 2026 (IRD-8265DDFD5FCF); it does not admit
implementation of the qualification execution-contract extension.
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

- AC-1: Same authenticated replacement IDs with valid non-backward restart times no later than observation can qualify; new IDs, malformed/future/backward times, old-container presence and mismatched source/daemon/project remain held.
- AC-2: Signed retirement authentication, packaged writer/image proof, current ownership and transition admission checks retain precedence; no evidence rewriting or authorization bypass.
- AC-3: Independently establish stable loaded writer/process qualification and canonical-transition exclusion through transaction commit, or atomic abort, with meaningful after-qualification mutation, lock-race and crash/rollback evidence. Do not substitute mocked Docker or timestamp tests for that proof.
- AC-4: Reconcile one current source carrier and record research/plan admission before publication; canonical owner deploys through protected release and verifies real scope acquisition plus refusal of incompatible evidence.

## Ordered atomic delivery

1. **R1 / V1 — reproduce and bind.** Use this implementation item's current
   workroom and immutable design as the ordered fix plan. Record actual red/green
   research. Reconcile source identity and covered plan through governed writers.
2. **R3 / C2 / F2 / V3 — resolve qualification before ordinary implementation.**
   The selected evidence strategy is a bounded qualification experiment using
   the existing current-process proof and transaction-scoped canonical admission
   locks, not a new timestamp-derived authority. It must establish the complete
   lifetime described below before admitting the ordinary correction. If that
   mechanism cannot satisfy AC-3, retain the hold and obtain scoped correction
   admission; the candidate is not a substitute for that decision.
3. **R2 / C1 / F1 / V2 — qualify restart continuity.** Extend the existing
   `scope-epoch-enrollment.server.ts` predicate and its colocated tests. Exact
   authenticated IDs must remain equal; accept only finite, non-backward starts
   no later than observation. Preserve receipt verification, image/writer checks,
   absence of retired IDs and canonical admission serialization. No migration,
   new persistence concept, dependency or runtime service is proposed.
4. **R4 / C3 / F3 / V4 — deliver and observe.** Run affected tests/typecheck,
   deterministic guards and the exact-tree shared gate; obtain independent
   review against immutable source. Publish DCO-signed through protected PR.
   The sole canonical owner deploys. Verify real successful acquisition and
   incompatible-evidence refusal before recording delivery.

One atomic implementation item owns this sequence: reproducing, correcting,
proving and deploying the same enrollment defect are not independently useful
deliverables. No separate cost-control feature or stale-proof recovery is included.
Rollback reverts this source correction through protected release; it does not
rewrite signed proof or reset protected claims. Unknown lifetime evidence holds
acceptance and is never recorded as a passing check.

## Selected qualification mechanism and falsification plan

The generation under test is the actual production Node process and its loaded
writer closure, not the mutable Docker start timestamp. Candidate qualification
retains a frozen process-bound proof; acquisition and receipt publication must
remain inside the same database transaction holding both canonical admission
locks. Test the claim/receipt path from qualification through the transaction's
actual commit or rollback. The image identity and packaged source comparison
alone do not prove loaded-code immutability: live read-only inspection found a
writable container root filesystem. Enumerate writable overlays, mounts, dynamic
loads and admitted production code-changing writers; prove they cannot change
the qualified writer closure during that lifetime, or require a scoped correction.
Do not describe this unresolved guarantee as already enforced.

Source anchors below are immutable blobs at main
`4fff0a44d8b957e479a1d17379eab3041c2e2432`:

| Path | Blob | Obligation |
|---|---|---|
| `apps/web/lib/work-capsules/scope-epoch-enrollment.server.ts` | `788135e546588b9255a4cb13dcc81f68e0a54427` | Current process proof, packaged bytes and admission locks |
| `apps/web/lib/work-capsules/scope-claim-store.ts` | `7e9ff5a98791a4692d38f6f50ee7e14aaae374bc` | Qualification before receipt transaction; same transaction retained through effect |
| `apps/web/lib/work-capsules/command-receipts.ts` | `2bdda63a729f82f7bd6abe391a1875cc7433cea3` | Actual commit/rollback and no partial effect/activity/receipt |
| `apps/web/lib/work-capsules/scope-epoch.pg.test.ts` | `534170053590cb481fad2ea80fe80191f05b6432` | Both lock orders and real database barriers; qualifier remains mocked |
| `Dockerfile` | `1ae237f2282e36f31361f8ae247a6d9655b8f667` | Production standalone process and packaged writer generation |
| `docker-compose.yml` | `007b9d4790b78240ab61eb5c9cdcc2f3cca4411b` | Sandbox database isolation and actual mounts; dev-preview services are distinct |

Use a governed nonproduction target and real isolated database for a child writer
bound to the exact candidate. Terminate it after qualification, after the room
lock and before commit; independently observe complete commit or complete abort.
Force a generation/cohort change after qualification and demonstrate actual
exclusion or refusal. Predicate mocks and PG fixture locks are separate evidence
layers, never proof of production process/image isolation. Current sandbox
inspection confirmed no `PRODUCTION_DATABASE_URL` variable, but that observation
alone is not complete network, credential or writer isolation proof. No ad hoc
runtime, production crash injection or manual retirement-proof change is allowed.

## Admission and evidence status

The original research attempt was rejected for missing immutable provenance;
subsequent published research receipt initiative-90b04b96-df68-48f2-8fa2-b62421e9851d
records reproduction only. Exact source 1b700d9a093095c34b19d4abb3bede0a9a97972b
passed its 15-test integration gate and independent code review as detailed below.
Those results do not approve this later design amendment. The same-item large
design claim is allowed; amended baseline, architecture review and covered plan
are required before implementing the qualification contract change. No completed
AC-3 proof, live repair or original cost-control delivery is claimed.
Reviewer context lives in archived WC-495809CB sequence 11;
that archived room supplies historical requirements, not current source authority.

## Local qualification-contract correction — proposed, not implemented

Kernel decision DI-7E9EC89A4A86 recommends extending existing qualification
bindings rather than adding a controller or treating lab evidence as production
qualification. Its usable, autonomy-eligible recommendation authorizes following
the normal design process; it is neither a protocol approval nor execution grant.

The owning canonical admission design remains
`2026-10-28-qualification-research-admission-design.md` (BI-2664971A).
That peer-owned Windows repair is not reopened or modified by this local work.
Installed source 62368996af69704f838614314126e0059bb0e595, issuer blob
0ffa6566615fe70bfadb4133182805315da3f3dd, accepts a script writer and script test
only. Extending it to a TypeScript claim/receipt writer changes its source and
execution trust contract. Merely widening those path regular expressions is
explicitly insufficient.

**OBJ-R1:** Preserve restart continuity only for authenticated replacement IDs,
while rejecting incompatible identity, source, time and retirement evidence.
**OBJ-R2:** Establish the real claim/receipt writer's qualified lifetime through
commit or atomic abort, including meaningful mutation and crash observations.
**OBJ-R3:** Extend the existing two-phase qualification substrate only through a
versioned, independently reviewed local runtime profile and machine-owned result.
**OBJ-R4:** Deliver the complete correction and its live verification atomically;
retain incomplete, negative and historical evidence without false closure.

| Acceptance | Objectives | Retained requirement |
|---|---|---|
| AC-1 | OBJ-R1 | Existing exact identity and valid restart-time criteria above remain unchanged. |
| AC-2 | OBJ-R1, OBJ-R3 | Existing signature, packaged writer, ownership and transition checks above remain authoritative. |
| AC-3 | OBJ-R2, OBJ-R3 | Existing independently established loaded-writer/process and through-commit or atomic-abort requirement above remains unchanged. |
| AC-4 | OBJ-R3, OBJ-R4 | Existing single carrier, research/plan admission, protected delivery and real claim/refusal verification above remain unchanged. |

### Proposed binding and producer contract

Research references for this amendment:
[OCI content descriptors](https://github.com/opencontainers/image-spec/blob/main/descriptor.md)
bind bytes by digest and size; this is artifact identity, not a claim about a
running process. [SLSA v1.2 provenance](https://slsa.dev/spec/v1.2/provenance)
separates build/source provenance; this design extends the existing artifact
evidence rather than treating an author's source list as producer attestation.
[PostgreSQL advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
release transaction-level locks at transaction end and require application
cooperation. Consequently every admitted competing writer and the real commit
boundary must be covered; the database lock alone does not immobilize code.

Extend `qualification-research-admission.ts`, its issuer and the existing remote
action producer/result owners. Add no grant class, table or generic shell tool.
Preserve the Windows profile and its historical tokens/results without interpreting
them as the proposed local profile. An unknown profile must fail closed.

The local profile must bind the same installation, accountable principal, item,
Workroom, stage, protocol and candidate review identities already required. It
must additionally bind the canonical candidate image digest, source tree and
compiler/lockfile/runtime identities; the production entrypoint and transitive
loaded writer/module inventory; the actual claim and command-receipt transaction
entrypoints; the isolated database reservation; and the permitted fault/barrier
set. The inventory must come from a checked, bounded build artifact, not an
author-supplied path list or a filesystem scan presented as loaded-code proof.
An incomplete or dynamic/unresolved dependency inventory holds qualification.

Prepare retains test/helper-only edits. Verify requires independent approval of
the exact candidate, unchanged target production blobs and typed result semantics.
It permits one start with an immutable command class, timeout and resource bounds.
It cannot acquire production scope, create a replacement review, change research
to PASS, or grant the caller additional authority. The normal grant intersection
and current source/lease checks remain in force at each effect.

Use only an admitted nonproduction runtime with the exact canonical candidate
image and an isolated test database. A source worktree, arbitrary Docker command
or hand-built image does not establish that runtime. The trusted producer must
prove that test resources and credentials cannot reach the production datastore
or production scope/receipt records. Missing runtime reservation or isolation
proof refuses Verify; do not silently fall back to the live portal or host.

The machine-authenticated Edge action is a closed local qualification procedure,
not a caller-authored command. Host platform and qualified Linux runtime platform
are separate evidence fields. Require a current trusted same-installation node
advertising that exact procedure and its allowed action type; do not infer support
from `action.execute`, host OS or an unattested peer. A stale, absent or ambiguous
producer is unavailable, not permission to use a user-authored execution receipt.

### Producer contract and implementation prerequisites

Owning scale/architecture boundary: EP-B9DD37C7, with this local change retained
under BI-224F56F1. The following table describes required amendments, not existing
capabilities. Every absent component is a prerequisite to Verify, not work to be
discovered after starting the experiment.

| Contract | Existing owner and current capability | Required local amendment / admission prerequisite |
|---|---|---|
| Protocol and single-start admission | `qualification-terminal-admission.ts` / `qualification-research-admission.ts`: reviewed script protocol, signed Prepare/Verify bindings | Versioned local TypeScript profile with exact production and transitive loaded-generation identities. Legacy parsing cannot issue it. |
| Canonical image acquisition | Existing canonical build/release artifact owners; no candidate-image producer is established for this experiment | Resolve an already governed candidate artifact and its verified OCI descriptor through an admitted build. The protocol cannot build/tag an image or turn a source checkout into runtime evidence. No token if this artifact/reservation is absent. |
| Runtime and database reservation | Existing nonproduction lease service and `scripts/lib/local-ci-slot-manifest.mjs` / `local-ci-slot-substrate.mjs`: owned slot resources and isolated test database | Bind the exact reservation and a closed runtime layout for the candidate writer, observer and fault actions. Ordinary CI's successful slot reservation alone does not attest that layout or loaded closure. |
| Production exclusion | Existing slot isolation checks in `scripts/lib/local-ci-slot-isolation.test.mjs`; no complete real-writer qualification isolation attestation yet | Producer verifies database identity/role, dedicated test schema, credential origin and network destination allowlist before launch; denies production datastore/receipt endpoints and production secrets. Credentials remain machine-local and are never copied into caller evidence. |
| Action dispatch | `remote-action/qualification-windows-action.ts` and `services/edge-node-go/internal/action/qualification_windows_action.go`: closed Windows action, trusted node and exact source resolution | Independently reviewed local typed action/profile in these existing action/producer registries; current same-installation capability advertisement, policy intersection and source/runtime binding. No generic-command delegation or inferred Windows support. |
| Loaded writer and fault execution | Production claim/receipt transaction owners exist; current child lab invokes only admission locks | Candidate entrypoint must invoke the actual claim and receipt writers and emit independently observable transaction barriers. Producer proves its complete loaded-module inventory and code-changing-writer exclusions before faults. This component is not implemented. |
| Machine result verification | Existing `remote-action/qualification-windows-result.ts` and Edge action-result route verify producer-owned Windows output | Extend existing result verification with the reviewed local profile's process/runtime/transaction identities, bounded artifacts and cleanup attestations; a host-authored test log or marker cannot settle it. |

The local profile must have a concrete reviewed implementation for each row before
Verify is issuable. Missing image production, isolated runtime layout, loaded-code
attestation or typed producer/verifier returns a named unavailable prerequisite.
It never substitutes an existing Windows action, live production container,
ordinary sandbox command, or the already passing marker suite.

### Initial profile limits and overflow semantics

These are proposed hard ceilings, requiring independent review and an observed
whole-closure fit before issuance; they are not claims that today's Next.js writer
fits them. No caller may increase them through protocol prose or command flags.

| Resource / evidence | Ceiling | Overflow or missing proof |
|---|---|---|
| Protocol bytes | 32 KiB UTF-8 | Refuse issuance; no Prepare/Verify start. |
| Transitive module inventory | 512 distinct entries, dependency depth 32, 64 MiB total application code bytes | Refuse issuance on overflow, unresolved dynamic dependency, missing native-module identity or incomplete closure. Cycles require finite visited-node accounting, not silent truncation. Runtime/base-image bytes are separately bound by descriptor/digest, not excluded from identity. |
| Inventory/result artifact | 8 MiB per complete artifact; envelope 64 KiB; sanitized error detail 2 KiB | Reject oversize input before start. Overflow/truncation after start is inconclusive, never positive. Detail can live only in digest-bound artifacts within this ceiling. |
| Preparation / verification | Prepare 15 minutes; Verify 10 minutes; measurement 30 seconds; cleanup 2 minutes | Expired admission cannot start. Post-start timeout aborts owned work and records inconclusive/unrun as appropriate; failed cleanup retains a recovery-required hold. |
| Runtime child / database | At most 2 writer/fault children plus 1 observer, 6 database sessions, 2 CPUs and 4 GiB child memory | Normal environment/resource admission must reserve the full envelope before start. Exhaustion aborts the experiment without changing host floors or taking unrelated processes' resources. |
| Results / cases | One start and the fixed reviewed fault set; 128 barrier observations and 64 evidence references maximum | No continuation run or omitted case can be relabelled complete. An incomplete case set or observation overflow is inconclusive and requires normal recovery, not a new key. |

The source manifest resolver must enforce count, depth and byte limits before
materializing the complete closure, and the producer must stream bounded output
without retaining unbounded logs. A larger target requires a reviewed profile
revision owned by EP-B9DD37C7 and fresh source/scope admission; it cannot raise a
limit mid-experiment or borrow the Windows profile's authority.

### Experiment and acceptance of its evidence

The producer must invoke the actual claim and command-receipt path against its
isolated resources. Bind the loaded process generation before qualification;
hold the canonical admission locks and actual receipt transaction through commit
or rollback. Enumerate writable code overlays/mounts, preloads, dynamic loads and
all admitted code-changing writers. Either demonstrate their exclusion for that
entire lifetime or observe an atomic abort. A frozen proof object, source hash,
read-only probe container or test marker alone cannot establish this guarantee.

The exact fault set includes child termination after qualification, after the
room lock, and after scope/activity/receipt writes before commit; both competing
canonical transition lock orders; and writer-generation/cohort mutation after
qualification. Independently observe a complete successful commit or the complete
absence of claim/activity/receipt effects after abort. Record process identity,
barrier sequence, reservation and transaction observation references, source/image
and binding digests, owned resource cleanup and typed positive/negative/inconclusive
or unrun status. Never return secrets or raw private tool results as shared proof.

Current evidence at 1b700d9a093095c34b19d4abb3bede0a9a97972b is narrower:
12 real claim-writer PostgreSQL tests plus three real child-process admission-lock
tests passed in cmwgpmgat1aqv0eqqhqii0lp0; native code review
cmwgptmws1djj0eqq1i0zrc1e passed. The child tests use lab markers, so they do not
settle actual claim/receipt process atomicity, loaded production code or Docker
qualification. Preserve those results and this distinction after any source change.

### Scope admission, compatibility and rollback

This amendment requires large-scope independent design/architecture approval and
covered implementation planning before issuer/Edge changes. Review must resolve
how the proposed producer establishes an isolated real writer and transitive
loaded-code lifetime, not approve a promise to discover that during execution.
If no existing admitted runtime can supply it, return that exact missing capability
and retain AC-3; no fabricated protocol, signing material or substitute marker.
Do not widen the peer-owned Windows protocol or write to an unattested peer.

Rollback disables issuance of the local profile, settles or preserves its existing
single-start action through the producer's normal cleanup, and retains all audit
and negative evidence. Old Windows tokens must keep their old interpretation.
No completed test slice, code-review receipt or kernel decision closes the atomic
repair or the separate TokenEconomizer feature.

## November 14 review findings and construction feasibility

The immutable spec-approval of head `6e2a6e81c8de3cd5c6e8b070c5fed207e6ebe76d`
failed in receipt
`initiative-review-v1-c51e34cbbf55cb360464efc713599546ae5459df6a4ce359c439214f1a5d7e67`.
That decision remains in force. The architecture pass
`initiative-review-v1-b211bef56c63852475ef599f4160f8484ec0acddb70f987e93203d3c0843d667`
does not supersede it. This section records source investigation and unresolved
construction questions; it neither requests reassessment nor declares readiness.
The original canonical design-spec task also settled as fail in receipt
`initiative-review-v1-430b0a0e3f56763799d6c4467a0d1e5853bdbcccccc9a9a7da2af37d6bb18717`.
Its instruction to complete AC-3 with real production evidence before resubmission
is retained as the reviewer's disposition, not permission to inject faults into
production or skip the preimplementation design gate.

| Recorded review premise | Applicable obligation | Disposition |
|---|---|---|
| Document is draft | Independent approval of a proposed design | Retain draft status until approval; changing its label supplies no evidence. |
| Approval and covered planning precede issuer/Edge changes | Preimplementation admission | Retain the required order. No code admission is inferred from this document. |
| Seven producer prerequisites are unimplemented | A credible construction must precede approval; implementation must precede Verify | Valid design gap: the earlier owner table is not an implementation algorithm. Resolve the interfaces and lifetime construction below before another review request. |
| AC-3 has no completed proof | Verify and delivery acceptance | Retain the hold. The lifecycle places spec approval before implementation, but that ordering cannot excuse an infeasible design. A rubric clarification cannot supply the missing construction. |
| Passing tests use lab markers | Evidence scope | Retain their narrow interpretation. No production atomicity, loaded-code stability or Docker isolation follows from the marker tests. |

### Existing candidate artifact construction

`scripts/local-ci-bounded-build.mjs` already owns a governed production build
with a durable `production-build` stage receipt. Its identity includes
`candidateSha`, `integrationTreeSha` and `imageTag`; a passed receipt carries
`artifact.imageId`. `canReuseBuildReceipt` checks the complete build identity and
reinspects the image ID. `scripts/local-ci-bounded-build.test.mjs` covers changed
tree identity, missing artifacts and a tag resolving to different bytes.

The local qualification resolver must consume that existing owner's passed
receipt through the existing governed gate, rather than build or tag an image
itself. Resolve the candidate commit to the recorded integration tree; validate
the corresponding gate/lease identity and completed build stage; resolve the
recorded image to exactly `artifact.imageId`; then bind that immutable identity
and the runtime recipe digest in the signed admission. A missing stage, stale
lease, different tree, moved image or incomplete provenance refuses issuance.
The build's local image ID is not a registry distribution manifest digest: the
resolver must retain that distinction and must not invent an OCI descriptor.
If a remote producer needs transport, its existing artifact owner must supply
verified transport provenance before that producer becomes eligible.

`scripts/lib/local-ci-slot-manifest.mjs` supplies an admitted slot's compose
project, PostgreSQL container/database/volume, scratch boundary and evidence
paths. Reuse the existing lease rather than accepting a caller-supplied database
URL. The producer must verify the lease still owns these exact resources before
launch and before settling results. This source contract establishes resource
identities; it does not yet implement isolated real-writer qualification.

### Exact remaining lifetime and isolation gaps

The actual `prepareScopeClaim` in `scope-claim-store.ts` qualifies before the
receipt transaction and retains the proof through its `beforeRoomLock` callback.
The claim invokes `enrollment.assertCurrent(tx)` before its room lock, writes
scope and activity inside that transaction, and uses the bound transaction when
called through the receipt owner. The production proof currently brands and
freezes an object and checks PID/hostname before acquiring the two admission
locks. Those facts identify existing insertion points; they do not establish
the identity of every loaded function or exclude subsequent code changes.

Two concrete counterexamples constrain any proposed producer:

1. The canonical `portal` service currently has a writable root and a Docker
   socket. Running an isolated candidate with a read-only root and no socket
   does not prove the canonical writer has those properties. Production
   acceptance requires the same established lifetime invariant, not a stronger
   experimental recipe silently substituted for the deployed recipe.
2. The real enrollment qualifier invokes Docker inspection and a packaged-image
   probe through its production Docker port. Giving an isolated writer the
   unrestricted production socket defeats the proposed production exclusion;
   removing it makes the real default qualification path unavailable. Merely
   injecting successful mocked port responses would repeat the rejected proof.

Before implementing the local profile, its existing runtime/Edge owners must
therefore specify both (a) a loaded-closure lifetime mechanism valid for the
canonical writer and (b) a bounded real Docker observation/probe transport that
cannot mutate production resources from the experiment. The mechanism must name
all late-load and code-changing paths, the enforcement boundary, and what aborts
the receipt transaction when that boundary changes. Static imports, PID checks,
source hashes, chmod, a read-only socket bind, or an independent probe container
are individually insufficient. This investigation has not established an
existing admitted implementation of both contracts.

Kernel decision `DI-35264B27B0BC` selects concrete source/design feasibility under
the existing profile and runtime owners, with that runtime precondition retained.
The supplied feature scores are qualitative engineering judgments, not measured
results. The earlier unscored call `DI-AB9AEA0D18AE` was unusable and supplies no
decision authority. Neither decision authorizes implementation or reassessment.

The supported next action is to resolve these two construction contracts in this
same design scope, reconcile the original design-spec task, and obtain the normal
reviewer's disposition of substantive corrections. Until then the original
approval failure and AC-3 hold remain; no new assessment key, replacement review,
test-only merge or live upgrade can stand in for them.
