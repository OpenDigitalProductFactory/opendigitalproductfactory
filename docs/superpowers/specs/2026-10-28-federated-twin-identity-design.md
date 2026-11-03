---
status: active
---

# Federated twin identity: one platform defect, worked once across paired installs

Backlog: BI-91FC6B9A.

Extends, does not supersede:
- [zero-touch organization federation](2026-08-23-zero-touch-organization-federation-design.md) §4 invariant 6, §5.11
- [work intake unification](2026-06-06-work-intake-unification-design.md) §3.6.1

## 1. Problem

Same-organization work sync (BI-FF8A57EF) mirrors a peer's backlog into this install one way. Each install also files its own items for what it observes. When the same platform defect is observed on both installs, it exists as two open items with different ids. Nothing connects them:
- intake dedupe looks for the origin marker in any body, including a peer's mirror, and bumps the mirror's count, which the next sync overwrites;
- an agent here cannot see that the peer is already working the defect, and can claim it here anyway, including claiming the peer's own mirror;
- a merged PR moves only the item it names, so the twin under the other id stays open for someone to pick up again.

The DEV install measured 34 local open items with an exact twin open on the paired install on 2026-10-28:

| Origin kind | Twins |
|---|---|
| mcp-call-efficiency | 18 |
| capability-need | 7 |
| tool-defect | 5 |
| client-capability | 3 |
| local-only-knowledge | 1 |

Each one can be diagnosed and fixed twice, so the organization pays twice for one defect.

## 2. Invariants kept

- **Only the origin mutates a mirror** (2026-08-23 §4 inv. 6). Nothing here writes a mirror's row: no count bump, status change or activity on a peer-owned item.
- **No cross-install write.** Each install acts only on its own items. The peer converges by running the same code on its side.
- **No new schema.** Identity is derived from origin markers already in item bodies. A twin is recorded as an activity on the local item, and the peer's claim state rides in `FederatedRecordMirror.payload`.

## 3. Design

### 3.1 Twin identity
Two items are twins when they share an intake origin marker `[origin:<kind>:<id>]` whose kind is not a federation marker (`federatedWork`, `federatedDemand`), and exactly one of them is a mirror. Twinship is a pure function of item bodies: `apps/web/lib/federation/federated-twins.ts`.

### 3.2 Intake never lands on a mirror
`ingestBacklogItem` matches an existing item by origin marker only among this install's own items (`OWNED_BACKLOG_WHERE`). A local observation of a defect the peer already tracks creates a local item, which becomes a twin (§3.3), instead of bumping a mirror whose count the next sync undoes.

### 3.3 Sync records twins on the local item
After each sync cycle, for every pulled mirror carrying a non-federation origin marker, the receiver finds this install's open items with the same marker. It writes one `federated_twin` activity on each such local item for each mirror, recording the peer installation, the peer item id, the marker and the peer's status. A pair already recorded is not written again. This runs for unchanged mirrors too, so the first cycle after deploy backfills every existing twin.

### 3.4 Peer claim visibility
`FederatedWorkItemV1` gains an optional `claim` field: `{ active, since, workrooms }`. Here `active` means a claim is held or a live Workroom names the item, and `workrooms` is the count of live rooms. It follows the `deferral?` precedent:
- the sender always emits it;
- the validator tolerates its absence;
- the spec version stays `dpf.work-sync/1`.

The receiver stores it in `FederatedRecordMirror.payload.claim`. A change in claim state alone refreshes the mirror, even when the origin's `updatedAt` is unchanged.

### 3.5 Claims see the peer's work
`claim_backlog_item_for_work` resolves the item's twins, or the item itself when it is a mirror.

If a peer mirror is in progress or holds an active claim, the claim is refused with `federated_twin_in_progress`, naming each twin with its peer status and claim. As with a local live Workroom, `force` plus `overrideReason` co-claims deliberately and is recorded.

Claiming a peer's mirror is likewise refused unless forced: the mirror is the peer's record, and its delivery is the peer's.

### 3.6 A merged PR closes the twins it closes
`applyGitHubPullRequestToBacklog` already moves the items a merged PR names to `awaiting-acceptance`. It now also moves this install's own items that share an intake origin marker with any named item, mirror or local, under the same coding-pool status rule. It records the twin as the reason. Mirrors are never moved here; the peer's merge signal moves its own copy.

## 4. Objectives and acceptance

**OBJ-1:** A platform defect observed on two paired installs is recognisable on each as one defect, without either install writing the other's records.

**OBJ-2:** An agent about to work a defect sees when the paired install is already working it, and cannot duplicate that work by accident.

**OBJ-3:** Delivering a defect on one install closes every same-origin copy this install owns, so no twin stays open to be fixed again.

| ID | Objectives | Statement |
|---|---|---|
| AC-1 | OBJ-1 | Intake dedupe never matches a mirror: a local observation whose marker exists only on a mirror creates a local item, and the mirror is untouched (unit test). |
| AC-2 | OBJ-1 | After a sync cycle, each local open item sharing a non-federation origin marker with a pulled mirror carries exactly one `federated_twin` activity per mirror, also for unchanged mirrors; a second cycle writes none (unit test). |
| AC-3 | OBJ-2 | `FederatedWorkItemV1.claim` is emitted by the sender, validated when present, accepted when absent, and stored in the mirror payload; a claim change alone refreshes the mirror (unit tests). |
| AC-4 | OBJ-2 | Claiming an item whose peer twin is in progress or claimed is refused with `federated_twin_in_progress` listing the twins; `force` with `overrideReason` co-claims and is recorded; claiming a mirror is refused unless forced (unit tests). |
| AC-5 | OBJ-3 | A merged PR naming item A moves this install's own coding-pool items that share A's origin marker to `awaiting-acceptance` with the twin recorded, and never moves a mirror (unit test). |
| AC-6 | OBJ-1 | On the DEV install after deploy, the 34 measured twins each carry a `federated_twin` activity, with before and after counts recorded on BI-91FC6B9A. |

## 5. Deliverables, in order

1. `federated-twins.ts`: marker parsing and twin resolution (pure), covering AC-1, AC-2 and AC-4.
2. The intake owned-only match in `backlog-ingest.ts` (AC-1).
3. The contract `claim` field and the sender in `work-page.ts` (AC-3).
4. Receiver: the claim payload, refresh on claim change and the twin activity pass in `work-sync.ts` (AC-2, AC-3).
5. The claim gate in `work-capsule-store.ts` and its handler payload (AC-4).
6. The merge expansion in `pr-submit-awaiting-acceptance.ts` (AC-5).
7. Deploy, then the backfill check (AC-6).
