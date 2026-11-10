---
title: Independently authorized offline service recovery
status: draft
backlogItem: BI-7A4E70E9
---

# Independently authorized offline service recovery

## Ownership and design grounding

BI-7A4E70E9 owns this independently shippable part of the original recovery
request. This document refines the offline portion of
[the original design](2026-10-02-integration-and-offline-recovery-design.md).
It leaves integration execution under BI-02E5CE5A. Neither draft has independent
approval. This design's proposed protections are implementation obligations,
not claims about present behavior or permission to operate production.

Source inspected: `84cbedd9d53c3aea8e6786d14007dc37f7f72e33`.
Two isolated executions of `scripts/redeploy-portal.sh` with a non-mutating
Docker stub confirmed refusal when PostgreSQL discovery or SelfUpgradeRun
query fails. No live Docker call, override, container change or credential
was used. Research receipt: initiative-755f8055-7728-45cd-9e58-c14b2af9d759.
This is failure reproduction, not restoration acceptance.

Existing owners to extend:

- `scripts/installer/install-state-transaction.mjs`: validated state bytes,
  CAS, shared state lock, flushed recovery copy and exact-byte restoration.
- `scripts/runtime-transition-authority.mjs` and
  `scripts/apply-runtime-capability-transition.mjs`: exclusive transition
  marker, apply lock, signed envelope, resumable journal and receipt. Their
  current shared secret is not an independent verifier's signature. Startup
  reconciliation depends on a database cross-check and is not offline authority.
- `scripts/promote.sh`: canonical service swap, image identity, mounts and
  existing rollback. Its state lock alone does not serialize an entire swap.
- Existing `SelfUpgradeRun` completion evidence: restored online projection,
  never the authorization dependency of offline execution.

No alternate live upgrade service, new approval database or business-data
restore is proposed. Extend installer/bootstrap execution with a bounded
recovery mode and teach existing runtime writers the same exclusive boundary.

## Objectives and acceptance

**OBJ-OR-1:** Restore a failed service without depending on the failed control plane.

**OBJ-OR-2:** Enforce scoped operator authority and independent verification offline.

**OBJ-OR-3:** Preserve data and exact rollback identity through crashes and failure.

**OBJ-OR-4:** Retain verifiable audit evidence and reconcile it once after restoration.

| ID | Objectives | Acceptance statement |
| --- | --- | --- |
| AC-OR-1 | OBJ-OR-1 | Restoration authorization and execution work with portal, MCP, queue and approval store unavailable, including a broken self-upgrade. |
| AC-OR-2 | OBJ-OR-2 | Bind scoped operator authorization to installation, immutable recovery inputs, allowed operations and expiry; never treat unavailable gates as passed. |
| AC-OR-3 | OBJ-OR-2, OBJ-OR-3 | Preserve independent verification, audit evidence outside the failed platform, data protection, immutable image identity and tested rollback. |
| AC-OR-4 | OBJ-OR-4 | Reconcile local evidence idempotently through existing evidence contracts after recovery. |
| AC-OR-5 | OBJ-OR-1, OBJ-OR-3 | Exercise outages on an isolated target and prove recovery without operator cleanup or failed-platform authorization. |

## Contracts

CON-OR-1: A versioned recovery envelope is a transport artifact of the existing
installer lifecycle. It contains run ID, installation ID, host/daemon identity,
canonical state path, Compose project, allowed service names, exact current and
target image digests, configuration and Compose hashes, mount identities,
rollback image/state hashes, allowed action enum, issued/expiry times and a
maximum execution deadline. Arbitrary shell text, new volumes, database
migrations, image builds/retagging, credential edits and dependency recreation
are rejected. First implementation restores only already installed compatible
service images; broader schema-changing recovery requires a new reviewed scope.

CON-OR-2: Operator and independent verifier sign the same exact envelope bytes
with distinct pre-enrolled keys. The executor cannot supply its own trust root.
An installation administrator enrolls public-key fingerprints locally while
healthy, with the independent verifier witnessing and signing the manifest.
Private keys remain with their owners; the agent and kit never receive them.
The manifest binds installation, roles, validity, revocations and monotonic
epoch. Rotation requires the existing two signers; loss of both requires a new
witnessed enrollment, never automatic recovery. The kit carries public trust
material and a second independently retained copy outside the installation.
The local protected epoch high-water mark rejects downgrade; missing or corrupt
trust state stops before mutation. Offline revocation freshness is bounded by
manifest expiry: offline execution cannot claim to know later revocations.

Signed bytes use an explicit UTF-8 versioned encoding and SHA-256; verify exact
bytes before parsing them. Reject duplicate keys, unknown fields/versions,
unsafe paths, symlinks at mutable targets, noncanonical numbers and oversized
input. Use existing cryptographic primitives, never a handwritten signature
algorithm. RFC 8785 supplies canonical JSON interoperability test vectors where
the existing stable serializer is reused; conformance must be tested rather
than asserted. A release publisher's signature proves artifact provenance,
not the operator's authority or independent approval of this recovery action.

CON-OR-3: All runtime writers must honor the existing apply-lock boundary for
the entire consequential operation, not only state-file writes. Extend the
promoter and offline adapter together before enabling recovery mode. Acquire
apply lock then state lock in that fixed order; refactor state transaction
helpers to accept a verified held lock rather than deadlocking on reacquisition.
Bind lock owner to process-start identity, host and token. A stale timestamp,
failed database probe or unreadable PID identity never authorizes takeover.
Prove the previous executor and its owned descendants have settled; otherwise
report intervention. Legacy writers without this protocol make offline apply
unavailable until drained under the ordinary install rollout. This boundary
must also fence a control plane that recovers mid-operation.

CON-OR-4: Before mutation, verify the complete recovery kit, signatures,
expiry, current image/configuration/mount fingerprints and exclusive ownership.
Preserve exact prior state and image locally, with restrictive permissions and
flushed files. Journal intent before each effect and observed result after it;
entries contain sequence, previous digest, operation, expected/observed hashes
and outcome, not configuration values or secrets. The terminal report is signed
by the existing execution receipt mechanism, with the original two approvals
retained. A hash chain detects accidental corruption but alone does not prove
authorship; reconciliation verifies signatures and envelope binding as well.

FLOW-OR-1: inspect -> validate kit and approvals -> acquire exclusive ownership
-> revalidate inputs -> preserve recovery point -> apply enumerated service
replacement -> verify image, mounts and health -> restored or rollback -> export
report -> reconcile online. Read-only inspection never grants apply authority.
Resume reads the journal and actual runtime; it never blindly repeats a swap.
Ambiguous effects or journal corruption stop mutation and retain diagnostics.

Rollback restores only the enumerated prior service image and exact state/config
bytes, preserving all existing mounts. It does not run old migrations or restore
a database snapshot. Target and rollback compatibility must be independently
verified before apply. Failed rollback remains intervention with both identities
and evidence retained; it cannot be recorded as restored. Expiry prohibits new
forward steps; the already authorized bounded rollback remains available until
the envelope's separate rollback deadline. No unbounded renewal is permitted.

CON-OR-5: After recovery, an authenticated existing self-upgrade evidence writer
validates the envelope, signer identities, complete report chain and actual
served identity before projecting one SelfUpgradeRun recovery result. Run ID
plus report digest is idempotent; same ID with different digest conflicts.
Preserve predecessor and completed evidence. An unavailable imported check is
stored as unrun with its reason. Import cannot authorize another execution or
manufacture passing runtime verification.

## Ordered fix and verification

The implementation parent and atomic delivery owner is BI-7A4E70E9. Trust,
exclusive apply, restoration and reconciliation are internal sequencing of one
recovery path: shipping an executable swap without the other controls is not a
safe independently usable deliverable. All contracts CON-OR-1 through CON-OR-5,
FLOW-OR-1 and AC-OR-1 through AC-OR-5 remain mandatory.

1. Add versioned envelope/trust validation beside the existing installer
   transaction modules and negative tests, then kit preparation and read-only
   inspection. VER-OR-1 rejects forged/same-key/expired/cross-install approval,
   altered image/action/config/mount, trust downgrade, unsafe paths and malformed
   encoding before any mutation. Synthetic keys are test fixtures only.
2. Extend the existing apply-lock protocol across promoter and installer adapter.
   VER-OR-2 starts competing ordinary/offline writers, expires heartbeats while
   owners remain live, reuses PID identities and injects death at lock/state
   boundaries. Assert one mutator and no successor deletion or termination.
3. Add bounded restore/resume/rollback and the journal. VER-OR-3 injects death
   before and after every journal write, state replacement and service swap;
   verifies exact image/state recovery and unchanged business data/mounts.
   Successful resume and failure-to-intervention are distinct assertions.
4. Add import through the existing evidence owner with schema validation and
   idempotency tests. VER-OR-4 checks duplicate report, conflicting digest,
   forged report, interrupted import and unavailable checks. No direct database
   repair or online permission bypass is part of this adapter.
5. VER-OR-5 runs the complete path in the canonical leased isolated target,
   blocking portal, MCP, queue and approval storage, and breaking the ordinary
   self-upgrade entry point. Preposition approved fixture authority and immutable
   image assets before isolation. Restore, verify health/data, reconnect and
   import once without operator cleanup. Repeat with failed target health to
   prove rollback. Record actual source/image/lease and complete logs.
6. Update installer and disaster-recovery operations documentation, package the
   kit in the normal installer release, run affected tests/typechecks and the
   canonical gate, obtain exact-source independent review, then DCO PR and
   protected queue. No live production outage injection. Actual production use
   still requires its pre-enrolled scoped authority; this draft supplies none.

## Risks, rollout and stop conditions

This design does not claim that current transaction locks protect a whole swap
or that current HMAC receipts provide independent authorization. Both require
the changes and adversarial tests above. Enable recovery only when every writer
on the installation advertises the shared protocol and a verified kit exists.
Existing installations without it retain their current behavior and explicit
unavailability; no seeded approval or broad recovery environment flag is added.
Rolling back the feature disables new recovery admission and preserves journals,
trust history and completed receipts. Active operations must settle first.

Missing authority, unresolved owner liveness, missing rollback assets, changed
mounts, incompatible data schema and failed signature checks stop before effects.
Failed or unrun exercises block acceptance. Review must reject any unimplemented
mitigation presented as fact. The operator's reliability objective remains open
until implementation, protected delivery and canonical failure exercises pass.

## Research references

- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785): reproducible JSON hashing
  and signing; informational specification, not an IETF Standards Track RFC.
- [NIST SP 800-34 Rev. 1](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final):
  contingency preparation and recovery exercises inform kit rehearsal.
- The concrete DPF source owners and current failure probes above determine
  implementation fit; neither external reference grants operational authority.

## Backlog coverage

Atomic under BI-7A4E70E9 for the safety dependency explained above. No initiative
scope baseline exists for BI-7A4E70E9. Coverage and independent design approval
are pending; this document is not implementation admission.
