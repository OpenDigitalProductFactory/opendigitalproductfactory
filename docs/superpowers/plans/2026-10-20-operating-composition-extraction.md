---
status: active
---

# OP-01 local extraction checkpoint

Backlog: BI-9874488F. Workroom: WC-147710C7. Owner: @markdbodman.
Parent design: [reusable architecture](../specs/2026-10-18-reusable-architecture-extraction-design.md), family 4;
parent plan: [OP-01 / OF-01 / CT-OP](2026-10-18-reusable-architecture-extraction.md).
Source base: `4fa796b64425b6129f172a01b89d8c8887c065fc`.

The human authorized a bounded local refactor with independent review and local
tests; native design, functional, shared-runtime and acceptance gates remain
unrun. This plan records implementation sequencing under that exception, not a
new gate receipt or permission to publish, alter production, or write DPF2.

## Design grounding

The existing AIDoc fingerprint is SHA-256 over model settings, sorted prompt
labels, sensitivity, default human-review tier and canonical persisted grants.
UserFact and semantic-memory records store the unversioned hexadecimal value.
Preserve that material and the sorted-key JSON.stringify serializer byte for
byte. Move their computation, then migrate AIDoc and the routing hash adapter;
do not backfill records or reinterpret the field as complete qualification.

Add a separate versioned complete composition contract using trusted reference
shapes. Its required sources include job/role, supervision, instructions, skills,
model/configuration, tools, doctrine, governed-memory policy and harness/runtime.
The host resolves effective source revisions and current revocation state; the
package hashes supplied bounded data and queries supplied qualification facts.
No profile database, policy catalog, router, credential loader or authority
decision is introduced. Existing strict trusted-agent 0.1.0 envelopes retain
their fields and semantics; the new composition is the record their composition
reference may identify, not an implicit schema upgrade.

## Sequence and evidence

1. Pin literal legacy digests and actual AIDoc behavior before moving code.
2. Extract the exact serializer/material projection and share its implementation
   with existing routing metadata hashing. Canonical grants and aliases stay in
   the app. Extract the existing bounded JSON guard unchanged to a common leaf.
3. Specify new behavior in failing tests: strict bounded composition, exact
   references, material changes, ordering, current qualification facts and
   missing/revoked/unsupported holds. Then implement the pure boundary.
4. Run AIDoc, identity/memory/cards, routing hash, trusted contracts and portable
   tests; typecheck validators and the app. Graph advice found AIDoc and agent
   card tests; bounded import/caller inspection additionally identified memory,
   snapshot and routing-registry tests. New paths have no graph-linked tests.
5. Copy the exact source closure into a temporary dependency-free NodeNext
   consumer; compile with Node 24.16.0 / TypeScript 6.0.3, types=[] / ES2022.
   Exercise a synthetic author/reviewer receipt transaction: exact subject and
   result, failure, lost acknowledgment, duplicate/conflicting retry, revoked
   qualification and missing persistence. This adapter is not production review.
6. Update the current agent meta-model and include source provenance, notices,
   absorption/retirement guidance and observed checks. Run local guard/doc checks;
   independent review is required before the parent's unpublished commit.

## Boundaries and retirement

Keep prompt loading/cache/fallback/include resolution and instruction provenance,
model selection/residency/capability policy, canonical authority intersections,
governed memory and actual receipt persistence with their existing DPF owners.
The old hash serializer and AIDoc material builder are removed from the app after
literal/parity checks. The generic routing SHA adapter remains a real host caller.
Old memory field values remain readable without migration. Revert package and
callers together if compatibility fails.

Freshness-only coworker certification, active AIDoc validation_state and the
coordinator's absent-scheme not-applicable result are preserved separately from
exact-composition qualification. Missing AIDoc's existing advisory memory fallback
is characterized, not silently hardened. Full routing/harness execution, real
authenticated independent review, production mediation, runtime qualification
and broad provider alternatives are unqualified by this source-local checkpoint.

## Observed local checkpoint

- Legacy characterization passed before the move: 3 suites / 37 tests.
- Composition stub Red, then qualification-query Red, were observed before Green.
  Generated-reference bounds, impossible dates and mutable packet/result cases
  also failed before their fixes.
- Final affected portable/trusted checks: 5 suites / 114 tests; application
  identity, memory, cards and routing checks: 8 suites / 71 tests.
- Exact Node 24.16.0 / TypeScript 6.0.3 isolated consumer: 11 behavior groups.
  Validators and web TypeScript 7 typechecks passed.
- Canonical JSON, style, prose, link and whitespace checks passed; doc index and
  diagrams were fresh. Claimed doc-impact output regenerated to 747 code and
  87 route edges, then its freshness check passed.
- The parent's independent local source review found no actionable issue.
  This is not a native acceptance receipt. Native/shared-runtime/production
  qualification gates remain unrun; no PR, push or production change is authorized.
