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
