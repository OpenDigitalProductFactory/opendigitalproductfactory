---
status: active
backlogItem: BI-6A5AB570
workroom: WC-CE5EB2E7
program: BI-7C1F43E3
---

# Immutable Gate Single-Flight Design

## Problem

The local integration gate and semantic change review already bind evidence to
committed trees, but they do not share a canonical in-flight identity.
`scripts/gate-worktree.mjs` currently keys a lease by caller session and commit,
so two callers asking for the same verification create different claims.
Semantic review can reuse an existing receipt, but two concurrent requests can
both observe no receipt and dispatch duplicate reviews.

The result is duplicate computation, competing leases, and receipts whose
relationship to the execution that produced them must be reconstructed after
the fact.

## Requirements

- `REQ-SF-1`: At most one executor runs for one immutable gate identity.
- `REQ-SF-2`: Concurrent callers observe the canonical execution instead of
  starting another one.
- `REQ-SF-3`: A valid terminal pass or fail is reused while every identity and
  freshness invariant remains valid.
- `REQ-SF-4`: A changed integration tree, evidence plan, toolchain, or gate kind
  produces a different identity.
- `REQ-SF-5`: The evidence record names the same gate identity used for
  admission, and duplicate suppression emits bounded telemetry.
- `REQ-SF-6`: New branch commits supersede only nonterminal requests for the old
  tree. Completed evidence remains immutable history.

## Existing substrate

`GateRun` is a projection, not a database model.

| Concern | Canonical existing record | Current invariant used |
| --- | --- | --- |
| Local-CI execution ownership | `NonProductionEnvironmentLease` | Unique `claimKey`; environment transaction and FIFO reconciliation |
| Semantic-review execution ownership | `TaskRun` | Unique `taskRunId`; indexed `repeatedPatternKey`; terminal task state |
| Local-CI result | `ExternalEvidenceRecord` | `operationType=local_integration_ci`; immutable details payload |
| Semantic-review result | `ExternalEvidenceRecord` and Workroom activity | `operationType=semantic-change-review.receipt`; receipt freshness contract |
| Caller correlation | Existing `taskRunId`, Workroom, and owner-session fields | No second task or subscriber store |

No schema migration or new table is required. The lease row already has a
unique claim key and an evidence-record link. `TaskRun.repeatedPatternKey` is
already indexed and provides a bounded lookup for semantic-review attempts.

## Gate identity

The server derives the key. Clients supply normalized components; they do not
choose the hash or use their session as part of execution identity.

```text
gateKey = sha256(canonical-json({
  schemaVersion: 1,
  repository,
  integrationTreeSha,
  evidencePlanDigest,
  toolchainFingerprint,
  gateKind
}))
```

The component contract is:

- `repository`: lower-case GitHub `owner/name`.
- `integrationTreeSha`: lower-case 40-character committed tree SHA. For
  semantic review this is the reviewed head tree.
- `evidencePlanDigest`: the CI evidence-plan digest. For semantic review it is
  a digest of the Workroom capsule, policy version, base tree, diff digest,
  risk, and sorted specialist set. The capsule is required because the current
  receipt freshness contract binds review evidence to one delivery packet.
- `toolchainFingerprint`: the local-CI toolchain fingerprint. For semantic
  review it is a digest of the reviewer version and dispatch contract version.
- `gateKind`: a closed value, initially `local-integration-ci` or
  `semantic-review`.

The accepted base and policy are therefore identity-bearing without adding
parallel fields: local CI includes them in the evidence-plan digest; semantic
review includes them in its review-plan digest. Any drift changes `gateKey`.

The derived key is returned to the caller, stored as the local-CI lease
`claimKey`, copied into evidence details, and used in semantic-review
`TaskRun.repeatedPatternKey` as `gate:<gateKey>`.

## Local integration flow

1. The pre-admission evidence planner produces the exact integration tree,
   plan digest, and toolchain fingerprint.
2. `gate-worktree` sends the identity components to
   `claim_nonprod_environment_lease`.
3. The server derives `gateKey` before the lease transaction.
4. If no matching claim exists, the caller becomes the executor and receives
   `queued` or `admitted`.
5. If the matching claim belongs to another session, the caller receives
   `subscribed` plus the canonical lease identity. It does not renew, release,
   or execute that lease.
6. A subscriber observes the same claim at the existing bounded retry cadence.
   Durable suspension and notifications are delivered separately by
   `BI-MCP-EFF-0285909C`.
7. The executor records its result with `gateKey`. The result adapter verifies
   the lease owner, writes the external evidence, and binds its id to the lease.
8. A later matching claim returns `reused` when the linked receipt is a valid
   pass or fail for the same identity. Missing, inconclusive, expired, or
   mismatched evidence fails closed and may create a fresh attempt; it never
   becomes a pass by absence.

Only the executor session may renew or release the lease. A subscriber never
inherits process authority merely because it knows `gateKey`.

## Semantic-review flow

1. The MCP and Build Studio adapters normalize the existing
   `SemanticReviewIdentity` and derive the same gate identity contract with
   `gateKind=semantic-review`.
2. The adapter first loads a valid terminal receipt by `gateKey`. Existing
   receipt freshness checks remain authoritative.
3. If no reusable receipt exists, it transactionally creates the deterministic
   `TaskRun` attempt. A concurrent uniqueness conflict reads the winner.
4. The creator dispatches the review. Other callers receive `subscribed` with
   the canonical `taskRunId`; they do not dispatch.
5. The creator records the existing semantic-review evidence and completes the
   `TaskRun` with the evidence id and result disposition in `progressPayload`.
6. A subsequent caller reads that evidence and reuses it. An infrastructure-
   inconclusive task permits a new numbered attempt under the same `gateKey`;
   a semantic fail remains a valid receipt until the reviewed tree changes.

This coordination lives in the persistence adapters. The surface-neutral
`runSemanticChangeReview` operation remains pure and keeps its current direct
receipt-reuse behavior for callers that already hold a receipt.

## Result contract

Both execution surfaces project these dispositions:

| Disposition | Meaning | Caller action |
| --- | --- | --- |
| `admitted` | This caller owns the execution | Execute once |
| `queued` | This caller owns a queued execution | Observe admission |
| `subscribed` | Another caller owns the canonical nonterminal execution | Observe only |
| `reused` | A valid terminal receipt already exists | Return it without computation |
| `blocked` | Identity or terminal evidence is invalid/inconclusive | Fail closed or create an explicit retry attempt |

Responses include `gateKey`, canonical lease or task identity, executor owner,
receipt id when terminal, and low-cardinality suppression telemetry fields.
They never return another caller's release credential or grant reviewer tools.

## Supersession

Execution identity contains the immutable tree. A new commit therefore creates
a new `gateKey`. Before admitting it, an adapter may mark an older request from
the same repository/branch/gate kind as superseded only when it is still
`queued`, `submitted`, or `working` and no process authority is active.
Completed TaskRuns, terminal leases, and evidence rows are never rewritten.

Supersession is an optimization, not a validity rule: an old executor that is
already running may finish and record immutable evidence for its old tree.
That receipt cannot satisfy the new key.

## Failure behavior

- Invalid identity components return `blocked` before lease or TaskRun writes.
- Owner mismatch returns `subscribed`; it no longer creates a second claim and
  does not transfer authority.
- Receipt identity mismatch, expiry, missing evidence linkage, or
  infrastructure-inconclusive output returns `blocked`, never `reused`.
- A process crash leaves the existing lease reaper and TaskRun watchdog in
  authority. This slice does not add another reaper.
- A subscriber timeout ends only that caller's observation; it does not cancel
  the canonical execution.

## Telemetry

Reuse and suppression use existing metrics and activity payloads. The bounded
labels are `gateKind`, `disposition`, and terminal result class. `gateKey`,
repository, branch, task id, and lease id stay in structured evidence rather
than metric labels. This prevents a high-cardinality time-series index.

## Security and authority

- The server computes `gateKey` from validated inputs.
- The lease owner remains the only process authority.
- Subscriber responses are read-shaped and cannot renew, release, or record a
  result for the executor.
- Local-CI result binding checks executor session, gate key, and candidate
  identity before linking evidence.
- Semantic-review subscribers receive a TaskRun reference, not the reviewer's
  tools or authority envelope.

## Scalability and boundaries

Lease lookup is constant-time through the existing unique `claimKey` index.
Semantic-review lookup uses the existing `TaskRun.repeatedPatternKey` index and
reads a bounded number of recent attempts. Evidence lookup uses explicit ids,
not an unbounded JSON scan.

This slice coalesces work on one DPF installation. It does not coordinate gates
across sovereign installations or provide distributed remote caching. The
program-level scale path is `BI-MCP-EFF-0285909C` for durable wait/resume and
`BI-30EDD4B0` for governed executor capacity. Cross-install evidence exchange
would require a separately authenticated federation design.

## Architecture review

- Alignment: well aligned with the existing program design and kernel
  principles.
- `single-source-of-truth`: the design projects one logical run over leases,
  TaskRuns, and evidence; it adds no parallel `GateRun` table.
- `schema-audit-before-features`: existing unique/indexed fields satisfy both
  coordination paths, so no migration is justified.
- `gate-coverage-matches-blast-radius`: the key uses the evidence-plan and
  toolchain identities that already determine what the gate proves.
- `one-common-process-three-surfaces`: CLI, MCP, and Build Studio consume the
  same server-derived identity and receipt rules.
- `remove-avoidable-failure-opportunities`: ownership and subscriber roles are
  distinct response states, so a subscriber cannot accidentally become a
  second executor.

No unresolved architectural trade-off requires a new kernel decision.

## Acceptance scenarios

- `VC-SF-1`: N parallel claims for one identity create one executor; N-1
  callers receive the canonical subscription identity.
- `VC-SF-2`: a valid local-CI pass or fail is reused without running a command.
- `VC-SF-3`: a valid semantic-review pass or fail is reused without dispatch.
- `VC-SF-4`: changing each identity component independently creates a different
  `gateKey`.
- `VC-SF-5`: a subscriber cannot renew, release, or record the executor result.
- `VC-SF-6`: an inconclusive/missing/expired receipt fails closed and permits an
  explicit attempt without weakening prior history.
- `VC-SF-7`: a new branch tree does not consume an older tree's receipt and may
  supersede only its nonterminal observation state.
- `VC-SF-8`: duplicate suppression increments bounded telemetry and preserves
  the exact key in evidence payloads.
