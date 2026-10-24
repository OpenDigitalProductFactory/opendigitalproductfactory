---
status: draft
---

# Approved Design Delivery Lifecycle

- **Date:** 2026-08-23
- **Backlog item:** BI-AADDF8C1
- **Epic:** EP-129D11FD
- **Workroom:** WC-D3176BAB
- **Kernel decision:** DI-45BF1401AFF7
- **Scope:** document-only delivery of an independently approved design before its implementation
- **Related but separate:** BI-0996913C (reviewer-baseline defect)

## 1. Decision

DPF will make an approved design a normal delivery unit when implementation is
blocked, deferred, or too large to review honestly with the design. The design
lands through a regular, non-draft documentation/specification pull request.
Implementation then uses a separately reviewable successor BacklogItem, branch,
Workroom, and pull request.

The durable boundary is a versioned pair of `BacklogItemActivity` records. One
record closes the design-side delivery relationship and the other projects the
successor as **Approved — awaiting implementation**. Both records carry the same
delivery identifier and immutable references. They reuse the existing
`initiative_scope_baseline`, independent approval receipt, artifact-retention
pin, Workroom identity, BacklogItem identity, provider blob, and repository
commit. No new lifecycle table and no new `BacklogItem.status` value are added.

The boundary is managed by one governed MCP operation with `prepare` and
`finalize` phases. `prepare` runs before PR creation and writes a self-contained
intent onto the unfinished successor; the mandatory recovery capture therefore
travels in the design PR itself. `finalize` runs after the provider proves that
the pull request is merged, non-draft, and contains at the merged commit the
exact bytes approved by the baseline. The writer rejects
self-approval, a design BI used as its own successor, an unapproved or stale
baseline, a foreign Workroom, a draft/open/closed-unmerged pull request, a
non-document change set, a blob or digest mismatch, or a missing successor.

Before that merged boundary exists, the prepared intent protects its Workroom
branch from automatic cleanup. The design PR includes the current epic recovery
bundle containing that intent. After merge, the commit and provider blob are
reachable from `main`; the provider PR is discoverable from the approved commit,
and the bundle can restore and finalize the delivery even if the originating
installation, client task, worktree, Workroom row, or branch is already absent.

## 2. Objectives

1. **OBJ-ADL-001:** Preserve an independently approved design as a first-class,
   merged, provider-verified delivery before implementation begins.
2. **OBJ-ADL-002:** Keep the design BI, successor BI, Workroom, approval receipt,
   baseline, retention pin, PR, merged commit, provider blob, and digest in one
   discoverable evidence chain.
3. **OBJ-ADL-003:** Present a clear operator state, **Approved — awaiting
   implementation**, without creating a duplicate backlog or overloading the
   ordinary work status.
4. **OBJ-ADL-004:** Prevent cleanup from removing the only branch that carries an
   approved unresolved design.
5. **OBJ-ADL-005:** Recover approved unresolved work and all immutable delivery
   references without depending on a client task, local worktree, or surviving
   installation database.
6. **OBJ-ADL-006:** Keep the process symmetric across Codex, Claude, Grok,
   Antigravity, and the portal, with independent review and no draft PR parking.
7. **OBJ-ADL-007:** Reserve twenty percent of implementation capacity for
   refactoring the touched lifecycle, projection, cleanup, and recovery seams.

## 3. Verified existing substrate

| Concern | Existing owner | Decision |
| --- | --- | --- |
| Work identity and intent | `BacklogItem`, `Workroom`, branch, and PR | Reuse; a design delivery and its implementation use separate BIs/Workrooms/branches/PRs. |
| Independent design approval | `initiative_gate_receipt` with `gateKey=spec_approval` | Reuse; the delivery writer accepts only the current independently reviewed baseline binding. |
| Immutable approved scope | `initiative_scope_baseline` | Reuse; it supplies the approved artifact locator, digest, provider blob, manifest, receipt, and baseline id. |
| Artifact survival | `InitiativeArtifactRetentionPin` plus archived `DocumentBlob` | Reuse; no second blob store or retention table. |
| Durable entity ledger | `BacklogItemActivity` | Reuse with typed versioned activity payloads and deterministic projection. |
| Recovery | epic-scoped backlog recovery bundles | Extend validation/capture so a prepared intent and supporting approval evidence travel in the design PR before it is ready. |
| Backlog status | `triaging/open/in-progress/done/deferred/retired` | Keep unchanged. The approved-awaiting state is a projection orthogonal to scheduling status. |
| Workroom retention | terminal rows are retained; the stale reaper abandons rather than deletes | Exclude Workrooms carrying an approved unresolved design from abandonment until delivery resolves the branch dependency. |
| Worktree cleanup | janitor tiers, leases, PR observation, `.worktree-pinned` | Add server-derived approved-design protection as a first-class KEEP reason. Local marker remains an operator override, not canonical evidence. |
| PR policy | normal PR against `main`; PR creation means merge-ready; no drafts | Preserve. A document-only PR is complete delivery, not a parking mechanism. |
| PR linkage | durable commit/PR identity plus Workroom and BI records; public PR body omits installation-private ids | Preserve. The provider-verified writer records the linkage in the coordination plane. |

### 3.1 Why existing statuses are insufficient by themselves

`deferred` says when work is scheduled, not whether its prerequisite design has
been approved and delivered. `done` correctly describes the design delivery BI
after it lands, but it cannot describe the successor's readiness. A new status
would combine scheduling with evidence state and would force every status
consumer to understand a special case. The projection therefore composes:

```text
BacklogItem.status = open | in-progress | deferred | ...
approvedDesignDelivery.state = approved-awaiting-implementation | implemented
```

An operator can see `deferred` and **Approved — awaiting implementation** at the
same time without either fact erasing the other.

## 4. Research and benchmarking

Git's own data model treats refs as the reachability roots that keep objects
available; unreachable objects may later be deleted. A reflog is local and
time-bounded, so it is not a shared preservation contract. DPF must therefore
not treat an unreferenced branch commit or a client worktree as durable storage.
Sources: [Git data model](https://git-scm.com/docs/gitdatamodel),
[Git revisions](https://git-scm.com/docs/gitrevisions), and
[Git reflog](https://git-scm.com/docs/git-reflog.html).

GitHub's pull-request API distinguishes draft state and reports a provider
merge commit SHA after merge, including squash and rebase outcomes. DPF uses
the provider observation rather than caller prose as the delivery fact. Source:
[GitHub pull request REST API](https://docs.github.com/en/rest/pulls/pulls).

NIST configuration-management guidance describes a baseline as a formally
reviewed and agreed specification used for later builds and changes, and calls
for configuration identification, status accounting, traceability, and audit.
DPF adapts that pattern by preserving the approved design baseline and linking
it to a separately controlled successor implementation. Sources:
[NIST SP 800-171r3, Configuration Management](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/800-171r3/NIST.SP.800-171r3.html)
and [NIST software configuration management](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-161.pdf).

## 5. Lifecycle

### 5.1 One delivery concern per BI and PR

The normal rule remains one BI, one branch, one Workroom, and one PR for one
delivery concern. The split is required when the design is independently useful
and approved but implementation cannot truthfully be declared merge-ready in
the same unit:

1. The design BI owns research, the design/spec, review findings, approval,
   and the document-only PR.
2. Before recording delivery, a distinct successor BI exists under the same
   epic and owns implementation acceptance, plan coverage, code, migrations,
   tests, UX evidence, and its later PR.
3. `record_approved_design_delivery(operation="prepare")` appends a typed intent
   to both BIs. Normal recovery capture writes the unfinished successor and its
   supporting design evidence into the epic bundle on the same branch.
4. The design PR opens only after document checks, independent approval, and a
   current recovery-bundle check complete. It is a regular PR ready to merge;
   no bookkeeping commit is required after it opens.
5. After merge, `record_approved_design_delivery(operation="finalize")` locates
   the provider PR through the approved commit, verifies it, and atomically
   appends the paired delivery activities. A restored intent can finalize
   without its originating Workroom row.
6. The existing governed terminal path may mark the design BI done using the
   delivery receipt as evidence. The successor remains open, in-progress, or
   deferred and projects **Approved — awaiting implementation**.
7. When the successor reaches done with completion evidence, projection becomes
   **Implemented**. History is not rewritten.

An implementation plan for the successor is not required before the design PR
lands. Plan coverage is required before implementation intent is claimed, under
the existing readiness policy. This resolves the apparent conflict: plan
coverage precedes implementation, not independent delivery of its approved
design input.

### 5.2 Activity contract

Four append-only kinds form the prepared and delivered phases:

- `approved_design_delivery_prepared` on the design BI;
- `approved_design_successor_prepared` on the successor BI;
- `approved_design_delivered` on the design BI;
- `approved_design_successor_linked` on the successor BI.

Each pair uses schema version 1 and the same delivery id. The prepared successor
payload is self-contained and carries every immutable fact known before merge:

```ts
type ApprovedDesignDeliveryV1 = {
  schemaVersion: 1;
  deliveryId: `ADL-${string}`;
  state: "approved-delivery-pending" | "approved-awaiting-implementation";
  designBacklogItemId: `BI-${string}`;
  successorBacklogItemId: `BI-${string}`;
  originatingWorkroomId: `WC-${string}`;
  baseline: {
    activityId: string;
    baselineId: string;
    approvalReceiptId: string;
  };
  approvedArtifact: {
    repositoryFullName: string;
    path: string;
    commitSha: string;
    providerBlobId: string;
    digest: `sha256:${string}`;
  };
  prepared: {
    repositoryFullName: string;
    branch: string;
    headCommitSha: string;
    recordedAt: string;
  };
  delivery?: {
    pullRequestNumber: number;
    pullRequestUrl: string;
    mergedCommitSha: string;
    providerBlobId: string;
    digest: `sha256:${string}`;
    mergedAt: string;
  };
  recordedAt: string;
};
```

The approved commit may differ from the merge commit, but the path's provider
blob and SHA-256 digest at the merge commit must match the approved artifact.
This permits a normal squash merge without weakening byte identity.

Activity pairs are idempotent by delivery id and by the tuple
`(design BI, successor BI, baseline activity, merged commit, path)`. A retry
returns the existing projection. Conflicting retries fail without partial
writes. The successor activity is self-contained. Recovery capture also carries
the design BI's approval receipt and baseline activities as supporting evidence
while the successor is unfinished, even after the design BI becomes done.

### 5.3 Provider verification and authority

During `prepare`, the writer resolves the authenticated repository identity,
current Workroom branch/head, baseline, approval receipt, and retention pin.
During `finalize`, it resolves the pull request associated with the prepared
head commit from GitHub and requires:

- `merged=true`, `draft=false`, base branch `main`, and a provider merge SHA;
- PR head repository and branch matching the originating Workroom;
- a document-only changed-file set under the existing docs-only classifier;
- the merged artifact path present at the merge SHA;
- provider blob id and locally computed SHA-256 matching the current baseline;
- a current retention pin for that baseline activity;
- an independent approval receipt whose reviewer is not the design author;
- distinct design and unfinished successor BIs under the same epic;
- the caller's ordinary backlog/Workroom write grants.

The operation does not accept caller-supplied bytes, digest, merge status,
approval identity, or baseline payload. It accepts semantic identifiers and
derives every authoritative fact. No direct database or GitHub bypass exists.

## 6. Projection and portal experience

One pure parser/projector owns all activity interpretation. MCP reads, portal
loaders, cleanup policy, recovery tests, and conformance tests reuse it.

The successor projection is:

```ts
type ApprovedDesignLifecycleProjection = {
  state: "approved-delivery-pending" | "approved-awaiting-implementation" | "implemented";
  label: "Approved — delivery pending" | "Approved — awaiting implementation" | "Implemented";
  designBacklogItemId: string;
  successorBacklogItemId: string;
  deliveryId: string;
  mergedCommitSha: string | null;
  pullRequestUrl: string | null;
  baselineId: string;
  approvalReceiptId: string;
  digest: string;
};
```

The backlog row renders a compact evidence badge beside, not instead of,
the normal status badge. Its accessible name includes the design BI and next
action. The detail disclosure shows the design BI, PR, commit, approval,
baseline, digest, and Workroom references with clear labels. It avoids raw JSON,
truncated mystery identifiers, or an additional workflow control. The MCP
`list_backlog_items` and `get_backlog_item` responses expose the same structured
projection and operator label.

When the successor is done, the state is derived as `implemented`; the delivery
activity remains immutable. If activities are malformed or conflicting, reads
return an explicit unavailable/conflict diagnostic rather than silently
presenting approval.

## 7. Cleanup protection

An **approved unresolved branch** is a prepared delivery whose current baseline
and retention pin have no matching `approved_design_delivered` activity.

The Workroom inventory exposes this as a typed protection projection including
the BI, baseline activity, artifact digest, repository, branch, and artifact
path. It supports a protection-only filter for janitor callers.

Cleanup behavior:

- the local worktree janitor classifies an approved unresolved branch as KEEP
  before stale/unmerged tiers;
- its branch-delete path consumes the same protection inventory and cannot
  delete that branch after removing a worktree;
- if the protection inventory is unavailable, automatic cleanup of unmerged
  branches fails closed;
- the Workroom reaper does not mark protected Workrooms abandoned;
- merged branches cease to be the only copy only after the delivery record
  proves that the approved blob is reachable from `main`;
- `.worktree-pinned` remains a manual pin and is never manufactured as a
  substitute for the server fact.

## 8. Recovery

The existing recovery bundle remains epic-scoped and captures every not-done
successor. A prepared or delivered successor causes capture to include its
supporting design BI plus the design's approval receipt and baseline activities,
even when that design BI is done. This is a recovery dependency, not reopened
work, and it does not change unfinished-item counts. Prepared and delivered
activities are sanitized without tokens, local paths, client task ids, or
secrets.

The end-to-end recovery fixture must:

1. create an approved baseline, retention pin, independent approval, prepared
   and delivered pairs, done design BI, and unfinished successor BI;
2. capture without `--all`, proving the done design BI is included only as a
   supporting dependency and not counted as unfinished;
3. remove the fixture's originating Workroom, worktree, and client-task records;
4. restore the bundle into an empty coordination database;
5. query the successor through the shared projector;
6. prove the design BI id, Workroom semantic id, receipt, baseline, merged
   commit, provider blob, digest, PR, and **Approved — awaiting implementation**
   label remain discoverable.

Capture documentation explicitly names approved unresolved successor activity
as a preservation obligation. A capture that drops, sanitizes away, or cannot
parse the typed payload fails deterministically.

## 9. Cross-surface contract

The lifecycle is an MCP/backlog contract, not a client feature. The same tool
definition, grants, validation, result shape, and denial codes are advertised to
Codex, Claude, Grok, Antigravity, and portal coworkers. The portal consumes the
same read projection. Client-specific task ids are intentionally absent from the
durable payload; `originatingWorkroomId` is evidence, while the successor BI is
the continuing work identity.

Contributor instructions change only at the split point:

- if approved design and implementation remain one honest merge-ready concern,
  keep one BI/branch/PR;
- if implementation is blocked/deferred or independently reviewable, file the
  successor, prepare and capture the delivery, land the design plus current
  bundle through a docs-only regular PR, and finalize after merge;
- never open a draft PR or leave a PR open as storage;
- never reuse the design BI for implementation after recording a successor.

## 10. Architecture review

### 10.1 Canonical ownership

The design adds no source-of-truth table. Backlog status continues to own work
scheduling; readiness baseline owns approved design identity; the retention pin
owns artifact retention; GitHub owns merge/blob facts; activity pairs own the
durable relationship; Workroom owns in-flight branch identity; recovery bundles
own installation-independent unfinished-work restoration.

### 10.2 Failure boundaries

- Provider unavailable: refuse the write and retain cleanup protection.
- Database transaction failure: neither activity is written.
- Duplicate retry: return the prior delivery.
- Conflicting activity pair: surface conflict and block projection.
- Workroom or client deletion after delivery: successor activity remains
  sufficient.
- Installation loss immediately after the design PR merges: restore the prepared
  successor and supporting approval chain from that PR, locate the merged PR by
  approved commit, and finalize.
- Branch deletion before delivery: cleanup guard prevents platform automation;
  an out-of-band provider deletion is reported as a missing approved artifact.

### 10.3 Refactoring budget

At least twenty percent of implementation effort is reserved for extracting the
shared typed activity parser/projector, a single protection resolver consumed by
both reapers, and a provider-verification adapter reused by the MCP writer and
tests. This is touched-seam refactoring, not an unrelated cleanup campaign.

## 11. Acceptance contract

| Acceptance | Objectives | Verification |
| --- | --- | --- |
| **AC-ADL-001:** A current independently approved design is prepared and captured before PR creation, then finalized only after a regular merged document-only PR contains the exact approved bytes. | OBJ-ADL-001, OBJ-ADL-006 | Provider-adapter and repository-writer tests cover preparation, capture freshness, merged, draft, open, wrong-base, code-change, branch, blob, and digest cases. |
| **AC-ADL-002:** One atomic delivery id links design BI, successor BI, Workroom, approval receipt, baseline, retention pin, PR, merged commit, provider blob, and digest. | OBJ-ADL-002 | Transaction/idempotency tests and MCP contract tests. |
| **AC-ADL-003:** Backlog MCP and portal surfaces show **Approved — awaiting implementation** alongside the successor's ordinary status. | OBJ-ADL-003, OBJ-ADL-006 | Pure projection, MCP parity, loader, component, accessibility, and visual verification. |
| **AC-ADL-004:** Design delivery and implementation use distinct BIs/branches/Workrooms/PRs when split, with no draft PR, self-approval, or duplicate backlog. | OBJ-ADL-001, OBJ-ADL-006 | Writer denials, instructions, and cross-surface conformance tests. |
| **AC-ADL-005:** Worktree, branch, and Workroom cleanup keep approved unresolved work, including fail-closed behavior when protection cannot be resolved. | OBJ-ADL-004 | Janitor-core, janitor-adapter, branch-delete, and Workroom-reaper tests. |
| **AC-ADL-006:** Recovery without the done design BI, originating Workroom, worktree, or client task restores the successor and every immutable link. | OBJ-ADL-002, OBJ-ADL-005 | End-to-end capture/reconcile demonstration fixture. |
| **AC-ADL-007:** The process is usable through one governed contract from Codex, Claude, Grok, Antigravity, and the portal. | OBJ-ADL-006 | Tool-pack grant/definition parity and supported-executor fixture matrix. |
| **AC-ADL-008:** Twenty percent of the work is spent consolidating the typed lifecycle and cleanup/recovery seams, with no parallel store. | OBJ-ADL-007 | Diff review, module-size guard, architecture review, and blast-radius evidence. |

## 12. Non-goals

- No GitHub draft PR lifecycle.
- No general-purpose workflow engine or new backlog status.
- No replacement of initiative readiness, approval, baseline, retention pin,
  completion evidence, or recovery bundles.
- No automatic implementation start after design delivery.
- No Build Studio dependency or special Build Studio execution lane.
- No database script, seed, or direct SQL as a production workflow.
- No promise that a local branch alone survives provider-side deletion.
