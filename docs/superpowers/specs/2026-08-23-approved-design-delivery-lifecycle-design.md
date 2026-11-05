---
status: proposed
---

# Approved Design Delivery Lifecycle

- **Date:** 2026-08-23; reconciled 2026-11-05
- **Backlog item:** BI-AADDF8C1
- **Epic:** EP-129D11FD
- **Current Workroom:** WC-9765090A
- **Current kernel decision:** DI-5F1916D158B6
- **Historical decision:** DI-45BF1401AFF7
- **Related but separate:** BI-0996913C (reviewer-baseline defect)

## 1. Decision

DPF treats an independently useful, independently approved design as a complete
delivery unit when implementation is blocked, deferred, or too large to review
honestly with the design. The design lands through a regular, non-draft,
document-only pull request. Implementation then proceeds under a distinct
successor BacklogItem, branch, Workroom, plan, and pull request.

The canonical preservation boundary is one typed `ApprovedDesignDelivery`
relation. It binds the design and successor backlog items, originating Workroom
semantic id, current initiative scope baseline and approval receipt, retained
artifact, and provider-observed delivery facts. It has a `prepared` phase before
the document PR and a `delivered` phase after merge. `BacklogItemActivity`
remains the append-only operator/audit feed, but is not canonical because that
table has a declared 365-day retention window.

One governed MCP operation writes the relation. `prepare` derives approval and
artifact identity from existing readiness records and refuses self-approval,
same-item successors, foreign Workrooms, stale baselines, or missing retention
pins. `finalize` derives merge, changed-file, commit, blob, and digest facts from
the provider and refuses draft, open, closed-unmerged, non-document, wrong-base,
wrong-branch, or byte-mismatched deliveries.

No new backlog status is added. Existing scheduling status stays authoritative;
a shared projector adds **Approved — delivery pending**, **Approved — awaiting
implementation**, or **Implemented** as an orthogonal evidence state.

## 2. Objectives

**OBJ-ADL-001:** Preserve an independently approved design as a first-class,
merged, provider-verified delivery before implementation begins.

**OBJ-ADL-002:** Keep the design BI, successor BI, Workroom, approval receipt,
baseline, retention pin, PR, merged commit, provider blob, and digest in one
discoverable evidence chain.

**OBJ-ADL-003:** Present **Approved — awaiting implementation** without creating
a duplicate backlog or overloading ordinary scheduling status.

**OBJ-ADL-004:** Prevent cleanup from removing the only branch that carries an
approved unresolved design.

**OBJ-ADL-005:** Recover approved unresolved work without depending on a client
task, local worktree, surviving Workroom row, or surviving installation DB.

**OBJ-ADL-006:** Keep the process symmetric across Codex, Claude, Grok,
Antigravity, and the portal, with independent review and no draft PR parking.

**OBJ-ADL-007:** Reserve at least twenty percent of implementation effort for
consolidating the touched projection, retention, cleanup, and recovery seams.

## 3. Verified substrate and remaining gap

| Concern | Existing owner | Use |
| --- | --- | --- |
| Work identity and scheduling | `BacklogItem` | Reuse. Design and implementation use separate items. |
| Independent approval | `initiative_gate_receipt` (`spec-approval`) | Reuse; reviewer and author principals must differ. |
| Immutable approved scope | `initiative_scope_baseline` | Reuse its locator, provider blob, digest, manifest, and receipt binding. |
| Artifact survival | `InitiativeArtifactRetentionPin` plus archived `DocumentBlob` | Reuse; no second blob store. |
| In-flight source | `Workroom` branch/head/PR fields | Reuse; retain the semantic Workroom id even if the row later disappears. |
| Workroom relationships | typed `WorkroomRelation` | Reuse when both delivery Workrooms exist; it cannot replace the durable BI-to-BI relation. |
| Operator audit | `BacklogItemActivity` | Reuse for timelines; not canonical because retention is 365 days. |
| Recovery | epic-scoped backlog/workroom bundles | Extend with deliveries and supporting done design items. |
| Cleanup | Workroom reaper, worktree janitor, branch deletion, `.worktree-pinned` | Feed one server-derived protection inventory to automatic cleanup. |
| PR readiness | one docs-only classifier; regular PR means merge-ready | Reuse unchanged; no GitHub draft state. |

Current statuses are `triaging`, `open`, `in-progress`, `awaiting-acceptance`,
`done`, `deferred`, and `retired`. None means that an approved prerequisite has
landed and implementation has not. Scheduling and evidence remain separate.

### 3.1 Why a durable relation is necessary

The August draft proposed activity pairs as the boundary. Current schema
declarations make `BacklogItemActivity` telemetry-bounded to 365 days, while the
retention pin accepts only `initiative_scope_baseline` activities. Exempting a
few activity kinds or broadening the baseline pin would turn retention policy
into a hidden lifecycle store. A successor JSON field would make a typed
many-entity relation overwritable and opaque.

Kernel decision `DI-5F1916D158B6` compared those shapes and selected one narrow
typed relation with high confidence. This is the only new source-of-truth
concept. Activities, UI badges, MCP responses, cleanup protection, and recovery
are projections or adapters over it.

## 4. Research and standards

Git refs are reachability roots; unreachable objects may be deleted and reflogs
are local and time-bounded. A pushed branch or client worktree is not a durable
preservation boundary. Primary sources: [Git data model](https://git-scm.com/docs/gitdatamodel),
[Git revisions](https://git-scm.com/docs/gitrevisions), and
[Git reflog](https://git-scm.com/docs/git-reflog.html).

GitHub exposes draft/merge state and the provider merge SHA. DPF observes those
facts instead of accepting caller prose. Source:
[GitHub pull request REST API](https://docs.github.com/en/rest/pulls/pulls).

NIST configuration-management guidance treats an approved specification as a
baseline requiring identification, status accounting, traceability, and audit.
DPF applies that pattern to the approved design and separately controlled
implementation. Sources: [NIST SP 800-171r3](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-171r3.html)
and [NIST SP 500-161](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-161.pdf).

## 5. Durable contract

`ApprovedDesignDelivery` is an operational, retained record:

```ts
type ApprovedDesignDeliveryRecord = {
  id: string;
  deliveryId: `ADL-${string}`;
  state: "prepared" | "delivered";
  designBacklogItemId: string;
  successorBacklogItemId: string;
  originatingWorkroomId: `WC-${string}`;
  baselineActivityId: string;
  approvalReceiptActivityId: string;
  repositoryFullName: string;
  artifactPath: string;
  approvedCommitSha: string;
  approvedProviderBlobId: string;
  approvedDigest: `sha256:${string}`;
  preparedBranch: string;
  preparedHeadSha: string;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  mergedCommitSha: string | null;
  deliveredProviderBlobId: string | null;
  deliveredDigest: `sha256:${string}` | null;
  mergedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
```

Constraints enforce distinct design/successor items, the delivered field set,
immutable prepared identity, and one current delivery per successor. Deleting
either BI, baseline, or receipt is restricted. The Workroom link is semantic,
not an FK, so recovery remains valid after the room is removed. The provider
blob remains retained by the existing baseline pin and archived document blob.

Audit activity kinds are `approved_design_delivery_prepared`,
`approved_design_delivered`, `approved_design_successor_prepared`, and
`approved_design_successor_linked`. They carry `deliveryId` and concise immutable
references, but authoritative reads resolve the retained relation.

## 6. Lifecycle

1. Independently approve the design through initiative readiness. A current
   baseline and retention pin must exist.
2. File a distinct successor BI under the same epic. It owns implementation
   acceptance, plan coverage, code, tests, UX evidence, and its later PR.
3. `record_approved_design_delivery(operation="prepare")` locks both BIs,
   resolves the Workroom and approved artifact, creates the relation, writes
   audit activities, and returns the shared projection.
4. Recovery capture includes the prepared relation, unfinished successor, and
   supporting approval chain. The regular design PR opens only after the
   docs-only gate is green; it is not a parking PR.
5. After merge, `finalize` locates the provider PR from prepared source identity,
   verifies a non-draft merge to `main`, confirms a document-only change set,
   re-reads the artifact at merge SHA, and atomically fills delivery fields.
6. The design BI may complete using that receipt. The successor keeps its normal
   status and projects **Approved — awaiting implementation**.
7. The successor uses a separate branch, Workroom, plan, and PR. At governed
   completion, the projection becomes **Implemented**.

Plan coverage precedes successor implementation, not independent delivery of
its approved design input.

## 7. Projection and UI

One pure projector owns this read shape:

```ts
type ApprovedDesignLifecycleProjection = {
  state: "approved-delivery-pending" | "approved-awaiting-implementation" | "implemented";
  label: "Approved — delivery pending" | "Approved — awaiting implementation" | "Implemented";
  deliveryId: string;
  designBacklogItemId: string;
  successorBacklogItemId: string;
  originatingWorkroomId: string;
  baselineId: string;
  approvalReceiptId: string;
  pullRequestUrl: string | null;
  mergedCommitSha: string | null;
  providerBlobId: string;
  digest: string;
};
```

Backlog list/get MCP reads, portal loaders, cleanup, and recovery reuse it. The
backlog row shows an evidence badge beside—not instead of—the ordinary status.
Accessible text includes the next action. A detail disclosure labels design BI,
PR, commit, approval, baseline, digest, and Workroom; it shows no raw JSON or
mystery truncated ids.

## 8. Cleanup protection

A protected unresolved branch is a `prepared` delivery without verified merge
facts. Workroom inventory exposes repository, branch, delivery id, BI ids,
baseline, path, and digest as a typed protection set.

- Worktree classification returns KEEP before stale/unmerged tiers.
- Branch deletion consumes the same set and refuses the branch.
- Automatic unmerged cleanup fails closed when protection is unavailable.
- The Workroom reaper does not abandon a protected room.
- Protection ends only when the relation proves the approved blob is reachable
  from merged `main`.
- `.worktree-pinned` stays an operator override, never canonical evidence.

## 9. Recovery

Recovery bundle schema v2 adds `approvedDesignDeliveries`. Capture without
`--all` includes every record whose successor is not done, the unfinished
successor, and the supporting design BI baseline/approval activities even when
that design BI is done. Supporting design BIs do not increase unfinished counts.
Reconciliation restores items and activities first, then the relation through
semantic-id resolution in one transaction.

The end-to-end fixture creates an approved delivery, removes originating
Workroom/client-task/worktree fixture records, captures, restores into an empty
coordination database, and proves every immutable reference plus the operator
label remains discoverable.

## 10. Cross-surface contract

This is an MCP/backlog contract, not a client feature. Tool definition, grant,
validation, result, and denial codes are identical for Codex, Claude, Grok,
Antigravity, and portal coworkers. Client task ids never enter the record. The
portal calls the governed handler and consumes the shared projection.

Keep one BI/branch/PR when design and implementation are one honest merge-ready
concern. Otherwise create the successor, prepare and capture, merge a regular
docs-only PR, finalize it, and implement on the successor. Never use a draft PR
or reuse the design BI for implementation.

## 11. Failure boundaries

- Provider unavailable: refuse finalization and retain protection.
- Transaction failure: no partial relation/activity write.
- Duplicate retry: return the prior delivery; conflict: refuse without rewrite.
- Workroom or client deletion after prepare: relation remains; finalization uses
  provider and semantic evidence.
- Installation loss after merge: restore prepared relation, locate provider PR,
  then finalize.
- Out-of-band branch deletion: report missing artifact; never fabricate delivery.
- Malformed/conflicting reads: return a diagnostic, never an approval badge.

## 12. Acceptance contract

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-ADL-001 | OBJ-ADL-001, OBJ-ADL-006 | A current independently approved design is prepared and captured before PR creation, then finalized only after a regular merged document-only PR contains the exact approved bytes. |
| AC-ADL-002 | OBJ-ADL-002 | One durable delivery id links design BI, successor BI, Workroom, approval receipt, baseline, retention pin, PR, merged commit, provider blob, and digest. |
| AC-ADL-003 | OBJ-ADL-003, OBJ-ADL-006 | Backlog MCP and portal surfaces show Approved — awaiting implementation alongside the successor's ordinary status. |
| AC-ADL-004 | OBJ-ADL-001, OBJ-ADL-006 | Design delivery and implementation use distinct BIs, branches, Workrooms, and PRs when split, with no draft PR, self-approval, or duplicate backlog. |
| AC-ADL-005 | OBJ-ADL-004 | Worktree, branch, and Workroom cleanup keep approved unresolved work and fail closed when protection cannot be resolved. |
| AC-ADL-006 | OBJ-ADL-002, OBJ-ADL-005 | Recovery without the originating Workroom, worktree, or client task restores the successor, approved delivery, and every immutable link. |
| AC-ADL-007 | OBJ-ADL-006 | One governed contract is usable from Codex, Claude, Grok, Antigravity, and the portal. |
| AC-ADL-008 | OBJ-ADL-007 | At least twenty percent of implementation consolidates shared lifecycle, projection, cleanup, and recovery seams with no parallel blob store or backlog. |

## 13. Non-goals

- No GitHub draft PR lifecycle, new backlog status, or duplicate backlog.
- No replacement blob store, approval lane, baseline, or retention pin.
- No automatic implementation start or Build Studio dependency.
- No self-approval, direct database workflow, or caller-supplied merge truth.
- No guarantee that a provider branch survives out-of-band administrator
  deletion before preparation.
