---
status: draft
backlog: BI-34955E1F
epic: EP-LOCALCI-ADMITS
workroom: WC-C1F703FD
---

# Host-backed local-CI reservation and current-client admission

This canonical draft is authored under Large DESIGN admission IRD-9230F71FC00D
and the normally accepted thirteen-path scope in WC-C1F703FD, sequence307.
It preserves the original four item criteria. Independent native approval,
current coverage, implementation and live acceptance remain pending. The
separately attributed CLIENT advisory found no blocking design findings; its
two minor scale/provenance clarifications are included, not treated as approval.

## Problem and scope

A local-CI run admitted from a memory snapshot can lose capacity to later platform
work. BI-34955E1F extends existing leases into one conservative physical-host
budget instead of depending on every client voluntarily yielding. The first
host-backed reservation slice is protected delivery6894; current remaining
protocol is preserved at16760dde22c20004a2e205d7b2d03fedc6faccc7,
treeae959a1aec4b816771c907a5ddb2bdd4c66e6fdb, over765a432c.
Current protected main must be integrated and inspected before implementation.

The remaining source makes old or invalid local-CI clients fail actionably before
a lease/wait allocation. It does not introduce a second allocator, scheduler,
process ledger, telemetry stream or retry authority. Original old execution
uncertainty, including e4/E9, remains immutable and does not become retryable.
The third retained transport-diagnostic patch is separate subsequent source;
this design does not label it delivered or smuggle it into this slice.

Extend the existing 2026-09-25-platform-owned-local-ci-memory-design and
2026-07-31-local-ci-control-plane-starvation-design rather than copying their
builder calibration, substrate upkeep or host restart procedures. Existing
NonProductionEnvironmentLease, TaskRun, exact evidence and native authority remain
the source of truth. DecisionDI-8C38441632ED selected the existing host-backed
reservation direction; it is not approval of this new Large design.

## Original outcomes

**OBJ-C1-1:** Later admitted platform work conserves the capacity already reserved
for an admitted local-CI run.

**OBJ-C1-2:** Clients receive the actual actionable refusal before execution when
their implementation or physical-host observation cannot prove admission.

**OBJ-C1-3:** Infrastructure outcomes and recovery preserve exact source, lease,
authority and original execution uncertainty without a client-managed retry loop.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-C1-1 | OBJ-C1-1 | An admitted gate cannot be starved by work admitted after it. |
| AC-C1-2 | OBJ-C1-2 | The refusal happens at admission, where it is actionable, rather than mid-build. |
| AC-C1-3 | OBJ-C1-1, OBJ-C1-2 | No client-side headroom check is required for the pool to conserve capacity. |
| AC-C1-4 | OBJ-C1-3 | A run that still cannot proceed is reported as infrastructure and re-runnable on the same SHA, as today. |

These are the original item statements, not a reduced acceptance contract.
Unmanaged external pressure remains observable infrastructure; no DPF client
is granted authority to kill an unknown process, alter host budgets or infer
original provider settlement. Same-source recovery still requires the actual
supported current native eligibility; UNKNOWN is never a retry instruction.

## Current protocol

1. The shared server budget accounts for each active calibrated physical-host
   envelope once, including work admitted but not yet started. It excludes only
   the same exact reservation on renewal and respects release/cancel/expiry.
   Both local-CI and heavyweight host admission use the same conservative budget
   and existing lock order. This slice retains current per-physical-host admission
   limits and configured slot/resource ceilings in the existing host-resource
   policy and local-CI pool policy. Implementation review must verify complete
   accounting within those inherited finite bounds; do not add another collector
   or silently sample active reservations. EP-LOCALCI-ADMITS owns any expansion. Calibration stays bounded and raise-only where the
   current owner contract requires it; no new constant or reset is proposed.
2. A local-CI gate client reports revision4 and a positive finite physical
   hostPressure.totalMemoryBytes. This is an observation, not an override of the
   server's policy or measured available-memory counter. Stage raw os.freemem and
   broker-available memory are different measurements and cannot be substituted.
3. The admission endpoint applies revision4 to Windows and POSIX. A missing host
   path cannot evade a floor that covers both platforms; a platform-specific
   rule still cannot guess an unknown host. Non-gate infrastructure probes retain
   their existing admission behavior.
4. An old client receives non-retryable gate_client_upgrade_required. A current
   gate client with a missing/nonfinite/nonpositive physical total receives
   non-retryable invalid_host_pressure. These failures precede allocation and
   durable wait creation. The next action is to merge current origin/main or
   refresh the actual host observation, respectively, not repeat the old claim.
5. The real gate exits with the existing usage outcome for those non-retryable
   refusals. The existing durable resumer records usage as UNRUN and stops;
   queue/settled infrastructure classifications keep their existing bounded
   behavior. Do not add a replacement nonce, private control loop or new lease
   identity to make an old failure disappear.
6. Exact current claim, immutable source, current authority, expected child and
   native release/renewal contracts remain authoritative. A stale/refused client
   does not gain cleanup authority over another holder. Reservation expiry and
   a stopped observer are separate from child process cleanup and a test verdict.

## Evidence already earned and its limits

- Current167 normal commit generators/scans and both web TypeScript programs
  passed. An independent CLIENT source assessment reports no blocking findings;
  native independence remains UNVERIFIED.
- Actual current167 focused verification ran75tests/2files under original
  NPEL-AEA176039D, child/resumerexit0 at2026-11-05T23:59:23.755Z. Its reservation
  later expired normally. It is not full integration or live acceptance.
- Original NPEL-0163DD9840 never admitted, has no evidence record and expired.
  Original resumer ended75/UNRUN after145queued observations atNov6 00:41:10Z.
  Do not restart that old result as if its two-hour window remained active.
- Original e4 host receipt is INCONCLUSIVE with missing child/descendant proof;
  original native E9 remains UNKNOWN/unverified/retryfalse. Neither is rewritten.
- New Large classification is required because the former Medium appetite has
  elapsed. Current readiness returns PLAN_REQUIRED/malformed and missing scope
  baseline. BI-5D06B748 owns the narrower malformed-prerequisite routing repair;
  this branch does not copy that repair or fabricate a baseline.

## Ordered delivery and verification

1. Resolve the current source/shape and record this canonical design under the
   normal DESIGN claim. Preserve original body/evidence. If immutable reviewer
   source is unavailable, use a normal same-branch documentation-only packaging
   commit: retain167 history and restore only this branch's unpublished runtime
   delta to verified protected main. No reset/rebase/force/override or source edit
   outside claimed scope. The net published design tree must contain no runtime
   implementation. Re-read ownership and current main before doing this. Capture
   preserved167 commit/tree and all twelve authored blob identities, the exact
   protected comparator, and the resulting documentation-only head/tree/diff.
   Require actual gate-context documentation-only classification, not a filename
   assertion. Retain this evidence through restoration and final verification.
2. Obtain actual independent spec approval/current scope baseline and immutable
   coverage through the supported current issuer path. The5Drepair may restore
   routing; it does not approve this design. No repeat of an UNKNOWN review.
3. After actual implementation admission, integrate current protected main and
   restore the retained protocol on the same branch, resolving real interface
   differences. Reuse shared lease/claim and outcome classifiers. Preserve a
   single authoritative budget and avoid new serializer, collector or scheduler.
4. Run meaningful current-head regression checks for stale revisions, both known
   platforms and absent path; missing/zero/negative/nonfinite/string totals;
   valid gate claims; unaffected non-gate probes; once-only refusal/no allocation;
   usage/UNRUN durable completion; ordinary queue/resume/cancel/expiry behavior;
   and both reservation directions, mixed sizes and exact self-exclusion.
5. Perform normal package types, impact/docs guards and one exact final-source
   canonical integration run. Source changes earn their own identities. Preserve
   all failed/unrun/inconclusive original receipts and supported host-only
   dispositions. Do not create duplicate gates while an original is active.
6. Independently review the frozen integrated delta; fulfill the current native
   publication policy truthfully. Publish one DCO-signed ready PR, pass protected
   checks/merge queue, then qualify the containing canonical release. No hand-built
   runtime or direct-main push.
7. Record independent source/lease-bound live proof of the four original criteria:
   admitted capacity is conserved against later platform admissions, invalid
   observations refuse before allocation, no client politeness is required, and
   settled infrastructure permits only its supported same-source recovery. Only
   then record contractual completion/reconciliation as actually owed.

## Compatibility, rollback and exclusions

Revision floor and client/refusal handling ship together. Do not deploy a client
floor without a reachable current client. A rollback is a normal reviewed source
and release action with explicit compatibility checks; it never lowers a live
calibrated safety reserve, clears usage/history, reopens a consumed allowance or
revives an unfenced old writer. Fail closed on unproven admission while the
current owner diagnoses a defect.

No grant/provider/credential changes, extra spend/budget, external-process kills,
manual VM/cache maintenance, heap/floor/TTL increase, installation asset edit,
paired-peer mutation or original review replay is part of this work. Portal V8
heap exhaustion observedNov13 is separate runtime evidence, not a proven cause
of the original starvation or authority to tune the install. Desktop/iOS UI
campaigns are not added to this protocol scope.
