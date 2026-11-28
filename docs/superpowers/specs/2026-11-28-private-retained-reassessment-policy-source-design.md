---
status: draft
---

# Private retained source for a one-use reassessment policy

**Backlog:** BI-AE2EF5E4.

Status: proposed compatibility design for independent review. This design creates no live policy, approval, allocation, test execution, or authority. It uses synthetic identifiers only. It does not alter or attach the unpublished policy candidate.

## Decision and boundary

Use the existing private initiative-design DocumentVersion, its DocumentBlob, and the InitiativeArtifactRetentionPin created through canonical independent spec approval. The ordinary initiative resolver already supports a private document version linked to the correct subject and organization and verifies its bytes. The reassessment reader and present relation currently accept only a retained Git blob. Passing a document version to the current reader is not supported. Do not create a new store, issue a substitute receipt, or label retained document bytes as a Git archive.

For the first slice, accept the private source only for the existing closed one-use v2 policy. Scope the policy document to the **authorization intake**, not to the underlying design subject. Keep the underlying spec-approval review and original accepted request bound to their existing repository artifact, Workroom, and subject baseline. This changes where the *policy* comes from, not what is reviewed or who can approve or execute the review.

## Objectives

**OBJ-S5-PRIVATE-SOURCE:** Verify the same current, independently approved private policy version, retained bytes, and digest through canonical review and reassessment.

**OBJ-S5-AUTHORITY:** Preserve exact subject, organization, and actor authority and keep approval independent of authorship.

**OBJ-S5-ONE-USE:** Preserve one subject-wide allocation across supported source variants and retain the original unknown outcome without replay.

**OBJ-S5-COMPATIBILITY:** Preserve existing repository-source policy behavior and exact legacy relation reconstruction.

## Exact private source contract

1. **Resolve, review, retain.** The canonical resolver verifies an initiative-design DocumentVersion under the authorization intake's exact organization and subject. Require independent author/reviewer identities, a current version, and a real immutable DocumentBlob. Do not accept text-only or caller-provided bytes for authority. The ordinary independent spec-approval transaction pins the actual locator, digest, version and blob using source kind `document_version`. A note, a generic evidence record, or possession of a version ID is not approval.
2. **Read one approved source.** Through the existing authority path, resolve the authorization and underlying subject from server records and require matching non-null organization, current actor grants, and content admission. Require one current approved authorization baseline and its passing independent receipt, same version locator and artifact digest, exact matching retention pin and Blob ID. Require current DocumentVersion ownership and linkage and recheck its current pointer. Read bytes from the pinned blob through the existing bounded verified blob reader. Check the pin, version, receipt, baseline and rehashed bytes agree; then decode the closed policy and verify attributable operator evidence. Retain the existing distinctions between original request digest, policy digest and raw artifact digest.
3. **Carry the proof without changing existing accepted bytes.** Keep legacy repo-blob relations and their canonical reconstruction byte-for-byte. Propose a separate closed relation variant for the private source, with an explicit discriminator, existing canonical document-version locator, and the raw approved digest, alongside the unchanged authorization item, authorization baseline, policy digest and original occurrence pins. The host derives it from the approved source; callers cannot mint it. Exact field-set/version validation must be shared by preparation, transport reconstruction, adoption and worker readback. Unsupported or mixed-version readers refuse before inference. No content text, storage key or private capability belongs in the relation, public status, or user-visible logs.
4. **Revalidate at admission and consumption.** Use one shared verifier for preparation, the transaction and worker/capture. Blob I/O and parsing happen outside subject/task locks. Use the existing retained-byte proof pattern, then re-read the live metadata and compare the complete proof inside admission with no provider or storage I/O under locks. Preserve current writer grants, qualification, execution-root and seal checks. Revalidate current source and policy at the existing worker checks. If a policy is superseded after an assessment is accepted, hold further effects on that request; never refund or reopen its allocation. A stale or missing proof is an explicit refusal, not a valid zero-result lookup.
5. **Preserve one use and original uncertainty.** Reuse the existing canonical-subject lock and bounded subject-wide lineage inventory. Do not key or filter the admission count by artifact kind, policy baseline, version, credential, reviewer, or attempt outcome. All accepted v2 variants share the same ceiling across repo and private forms. An exact duplicate joins only under the current identity rules. Other requests refuse once allocated. Keep the original accepted request read-only, its unknown effects and consumption separate, and replay disabled. A genuine matching original receipt still takes precedence.

## Synthetic fixture and required assertions

Use one in-process fixture, never an installed subject, live TaskRun, external provider, or real user. Fake records are `org-fixture-a`, `org-fixture-b`, `policy-intake-fixture`, `doc-fixture-v1`, `blob-fixture-1`, `baseline-fixture-1`, `author-fixture`, `reviewer-fixture`, and `operator-fixture`. No fixture ID is a production locator. To exercise the existing S5-only decoder, seed an isolated test DB with its required *schema* subject constant and synthetic records; do not add a live-policy document to this design.

Use one deterministic UTF-8 byte sequence constructed from a test-only closed policy fixture with fixed key order, one spec-approval requirement, fixed dummy 64-hex request digest and synthetic operator evidence. Compute SHA-256 from those bytes in test setup. Supply those exact bytes independently to the canonical review resolver and retention reader, and require the relation and admission proof to reconstruct the same digest. Build a second version with equivalent decoded policy where feasible but different raw bytes, so semantic equality cannot satisfy byte identity.

| ID | Objectives | Criterion |
| --- | --- | --- |
| AC-S5-PRIVATE-MATCH | OBJ-S5-PRIVATE-SOURCE | Current private version, independent passing receipt and matching pin, Blob ID and digest. Canonical review and proof reconstruction agree. One synthetic present request can reach ordinary allocation under the existing gates; no real provider or tool effect. |
| AC-S5-PRIVATE-STALE | OBJ-S5-PRIVATE-SOURCE | Different raw bytes, different version with the same bytes, stale approval, missing pin, wrong pin kind, or changed current pointer, each independently. Typed refusal before allocation, or before effects at worker revalidation. A new document version needs its own approval even when bytes match. |
| AC-S5-PRIVATE-AUTHORITY | OBJ-S5-AUTHORITY | Cross-organization document or item, wrong subject link, wrong operator or acting actor, revoked permission, or author equals reviewer. Refusal before effects. Knowing an ID or having access to one room does not establish authority on the other. |
| AC-S5-PRIVATE-ALLOCATION | OBJ-S5-ONE-USE | Concurrent valid private and repo variants, alternate reviewers or policy baselines, one subject. At most one accepted allocation under the existing transaction. A reserved, failed, canceled or uncertain accepted attempt still counts. Idempotent exact joins create no new allocation. An incomplete lineage inventory refuses. |
| AC-S5-PRIVATE-NO-REPLAY | OBJ-S5-ONE-USE | Original unknown, no replay; genuine original receipt as a separate fixture. Unknown remains unknown and no old request is reactivated. A genuine receipt wins before prospective allocation. |
| AC-S5-PRIVATE-LEGACY | OBJ-S5-COMPATIBILITY | Existing repository-source policies and persisted relations. Exact legacy bytes, digest reconstruction, outcome and denial behavior unchanged. Unsupported private variant refuses instead of dropping fields. |

Required future proof uses the existing resolver/retention test seam, reader and relation unit contracts, existing transaction/lineage PostgreSQL fixtures and worker/capture checks. The artifact and reassessment stewards should choose the versioned relation encoding together and approve the bounded fixture plan before any implementation or test run. Nothing in this draft is a native gate pass.

## Admission and handback

The existing design-intent Workroom is the authoring lane. This sanitized design is supplied for independent review at its exact repository commit and blob, separately from the protected candidate. The proposed private-source contract remains subject to the ordinary design and acceptance gates. This document does not publish, authorize, or approve the protected policy, and does not authorize tests, grant changes, runtime effects, or an assessment or replay of the original case.
