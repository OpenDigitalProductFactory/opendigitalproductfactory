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

## Addendum: surviving Linux kernel witness (2026-10-20)

### Scope and approval status

The operator explicitly authorized preparation of this bounded design addendum
in this chat. That authorization does not admit implementation, grant Linux
privileges, approve a changed artifact, or authorize activation. This section
extends CON-OR-3 and VER-OR-2; it does not replace the original two signatures,
current enrollment, original owner, capture, deadlines or journal contracts.

Reuse the recorded design `9ea14626c7edc4fb85d7198d00339f8c734504ea`,
baseline `20afd87e-432d-45d3-b800-e081146c1742` and admission
`IRD-217D54E67AD1` for their approved scope. The historical draft and coverage
statements above describe that document's original state. They do not revoke
those later receipts or approve this new boundary. This delta needs its own
scoped architecture/design disposition before implementation. All three original
recovery outcomes remain incomplete.

### Observed gap and retained decisions

The measured operator host is macOS. Its selected Docker Desktop daemon runs
Linux 7.0.14-linuxkit. A macOS process cannot directly retain that VM's Linux
pidfds. A witness inside the original broker's PID namespace cannot survive
that namespace's completed teardown. Existing installer HOST observations remain
the authority for HOST file/configuration identity (DI-A836A4CFB6B3); they do
not establish this distinct kernel lifetime condition.

The isolated Ubuntu diagnostic proved that a retained non-init leader pidfd
can report termination while a detached descendant remains alive. It also
measured original namespace-init and descendant pidfd termination separately.
That fixture is not a Linuxkit artifact test, an original-owner join, or proof
that a previously issued Docker request has finished. The cgroup diagnostic's
ENODEV result remains unavailable evidence, never an empty-group proof.

Retain DI-BD1FBABB7327 (fixed promoter execution), DI-2CA217FFDEA2 (native
inventory join), DI-B22B1AB3377D (existing signed SelfUpgradeRun evidence),
DI-37FF621B11DC (daemon references) and DI-A1E0AF9832AD (creation receipts).
No settled decision is rescored by this addendum.

### Proposed topology for governed review

Extend the existing pinned promoter artifact with a fixed Linux supervisor
mode. Within that same container, the supervisor remains outside a newly
created child PID namespace. Its only executable child is the approved fixed
broker, which becomes PID 1 in that child namespace. The supervisor obtains
an original process pidfd at creation with `clone3(CLONE_NEWPID | CLONE_PIDFD)`;
PID lookup after an interruption is not an alternative. It retains that handle
and the independently joined child namespace identity before permitting effects.

This is a proposed rearrangement of the existing promoter execution boundary,
not an implemented feature. It requires a small Linux-native executable mode
packaged and pinned by the existing promoter contract/build context. The
current Node-only artifact closure does not supply that mode. A native helper
binary is therefore an explicit new implementation component, even though it
adds no persistent service, public API, database, key, grant or agent role.
The existing macOS native Edge process is not claimed to execute Linux syscalls.

The parent starts exactly one broker for exactly one admitted original run.
It neither accepts arbitrary argv nor attaches to existing containers or PIDs.
No host PID namespace, host procfs bind, host process scan, Docker exec, ptrace,
namespace entry into unrelated processes, or privileged container is proposed.
The child remains confined to its namespace and descendants; joining an
ancestor namespace is forbidden. Daemon-created service containers are outside
this process boundary and require the separate daemon proof below.

The supervisor's post-launch job is observation only. It receives neither a
Docker socket nor an apply/cleanup API. It cannot signal the broker, delete
files or containers, release a lease, start a successor, or execute a supplied
command. Existing fixed execution and request writers retain their existing
roles. Timeout or parent loss must retain custody rather than trigger cleanup.

### Additional privilege and lifetime boundary

Creating a PID namespace requires CAP_SYS_ADMIN in the user namespace that
owns the new PID namespace. This broad Linux capability is a material change
from an ordinary restricted broker launch. It is required only by the proposed
fixed bootstrap; it is not authorized by the operator's permission to write
this design. Do not substitute `--privileged`, unconfined seccomp, host PID
access, or an assumed unprivileged-user-namespace configuration.

Before implementation admission, the reviewed launch contract must specify the
user namespace, UID/GID, complete capabilities, syscall filter, mounts and file
descriptors, with a supported Docker Desktop policy. Bootstrap must drop all
capabilities and their bounding/ambient paths, set no_new_privs and install
irreversible restrictions before the effects barrier opens. The child must not
inherit bootstrap privilege. The parent must then be unable to create another
child or regain privileges. An exact executable/syscall policy needs review
and measurement; this draft does not assert the current image can enforce it.

The supervisor survives child namespace teardown while its original container
and process remain alive. It does not survive its own death, container removal,
VM restart or daemon replacement. Lost original kernel handles are never
reconstructed from a durable record. Those cases retain the original owner and
intervention state. Native VM restart still requires separately measured
settlement and a sibling's own lease; this addendum supplies no restart handoff.

### Admission, authentication and handle custody

The existing authenticated installer/promoter admission binds the original
owner token, host/daemon identity, lock and state-file generations, capture,
source/image pins, exact broker executable and original time windows. The
supervisor joins its child handles to that same admission before any state or
Docker effect. The child cannot supply its own namespace identity or witness.
The physical HOST/private mapping remains independently verified, never inferred
from DPF_STATE_DIR, a report path, a container label or an echoed hash.

A fixed inherited anonymous descriptor barrier is proposed for the parent/child
startup and observation exchange. This is new internal IPC that requires
explicit review in this delta; it is not permission to add a listening socket,
HTTP route or general command transport. Bound its grammar and byte count;
close unused ends and prevent descriptor inheritance into broker descendants.
Only the original authenticated supervisor instance may complete the barrier.
A copied JSON receipt, integer fd or PID cannot substitute for its live handles.

The parent emits at most one bounded observation bound to the original nonce,
owner generation, daemon identity, artifact, kernel identity and journal digest,
using the existing authenticated evidence path. Its key material and output
must be inaccessible to the mutating child. Reuse of the existing receipt
mechanism requires a reviewed isolation and attribution proof; a shared child-
readable HMAC secret would not establish an independent observer. No new signing
key or trust root is approved here. If the existing mechanism cannot provide
that isolation, record the precise gap before implementation admission.

Observation records are audit data. The protected owner-transition code alone
may consume a live original observation capability together with all other
conditions. Persisted evidence never becomes a release or replay capability.

### Two independent settlement conditions

Kernel condition: retain the original non-thread init pidfd and namespace join,
prove that every admitted executor descendant was confined beneath that init,
and observe the required termination/reaping semantics on the exact supported
kernel. Poll readability alone is insufficient. Closed handles, POLLNVAL,
namespace mismatch, unavailable observations and incomplete confinement refuse.
The exact Linuxkit kernel and packaged binary must be measured before accepting
the condition; the private Ubuntu fixture cannot establish it.

Daemon condition: every original effect intent must have a matching complete
request settlement and independent expected observation under the existing
fixed request journal and finite creation/CID receipts. Kernel teardown never
cancels or settles daemon work. A lost response, incomplete create receipt,
unsettled rename/remove, or late promoter operation retains the original owner.
Container absence, Docker API version, command exit and a healthy portal cannot
close an uncertain request. This addendum adds no daemon cancellation or replay
protocol and makes no claim that every uncertain operation is recoverable.

Only when both conditions and the original authority/generation/deadline checks
hold may the existing boundary perform a protected serial ownership transition.
Guarded resume and combined rollback must revalidate actual state afterward;
no saved terminal report skips those checks. Expiry does not renew the original
forward or rollback window. The supervisor does not perform this transition.

### Changes, scale and verification owed

Extend existing owners: `substrate-start.mjs` for admitted fixed launch and
HOST/private evidence joining; `runtime-apply-lock.mjs` for opaque custody and
serial transition; `offline-recovery-execution.mjs` and its journal for original
request settlement; promoter artifact/contract/build-context owners for the
pinned Linux executable. Existing native runtime-apply code remains a distinct
consumer of the shared boundary and has no release-after-effect API today.
Reports and the existing SelfUpgradeRun importer remain data projections.

Scope is one supervisor, one child namespace and one original lease per local
runtime boundary. Work is bounded by the original finite request/CID journal
and fixed descriptor budget, with explicit refusal at the configured limits.
No fleet scan or per-process inventory poll is proposed. BI-7A4E70E9 owns this
local reliability delta; any fleet-wide coordinator is outside this design.
No schema or enum migration is proposed, and the existing journal remains the
single authoritative request history.

Before implementation, the governed review must resolve the bootstrap privilege
policy, native artifact packaging, parent/child authentication isolation and
physical HOST/private mapping. Review the bounded anonymous IPC explicitly.
No new privilege or component may be activated merely because it is named here.

Required later tests include an escaped non-init descendant, namespace/PID reuse,
handle substitution, parent death before and after every barrier, privilege
retention attempts, child forgery, descriptor leakage and VM/daemon replacement.
Inject late or uncertain Docker effects after kernel termination and assert no
handoff. Positive tests must measure the original namespace-init teardown and
all request settlements before exactly one serial transition. Repeat through
the canonical isolated full application artifact, N-1 caller and actual outage/
rollback exercises. Retain all prior failures. Source mocks and helper-only
fixtures cannot satisfy AC-OR-5 or authorize partial publication.

### Standards and evidence limits

- [Linux clone(2)](https://man7.org/linux/man-pages/man2/clone.2.html): original
  child creation with a pidfd and a new PID namespace; namespace creation has a
  capability requirement. This is the proposed creation primitive, not a probe.
- [Linux pid_namespaces(7)](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html):
  namespace-init death terminates namespace members and prevents later creation
  there. Exact teardown ordering still needs measured kernel evidence.
- [Linux pidfd_open(2)](https://man7.org/linux/man-pages/man2/pidfd_open.2.html):
  process handles identify individual processes; a process handle alone does not
  certify its descendants or a daemon request.
- [Linux seccomp(2)](https://man7.org/linux/man-pages/man2/seccomp.2.html): inherited
  syscall restrictions and no_new_privs support the proposed confinement; the
  actual filter and packaged runtime remain unimplemented and unverified.

Preserved source archive SHA-256:
`39b7937b3ad541e2914e2f388404df1fa2737ea2fd0513a6e2617b3293701f93`.
Preserved isolated pidfd diagnostic archive SHA-256:
`8adabfe476578b4e1281770913d622c2614274f09495a30d29217786fd73b1db`.
These identify retained evidence, not the future implementation or a passing
acceptance run. This addendum is a reviewable proposal only.
