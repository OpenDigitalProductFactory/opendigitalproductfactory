# EP-WIKI-002: Bi-Temporal Revisions and Edge Invalidation

| Field | Value |
|-------|-------|
| **Epic** | EP-WIKI-002 |
| **Builds on** | [EP-WIKI-001 — Platform Kernel Wiki + Per-Org Overlay](2026-05-09-platform-kernel-wiki-design.md) |
| **Depends on** | EP-WIKI-001 Phase 1 (data model shipped) |
| **Status** | Draft (research follow-up) |
| **Created** | 2026-05-09 |
| **Author** | Mark Bodman + Claude (design partner) |
| **Inspiration** | Zep / Graphiti — *Knowledge Graph Memory for Agentic Applications* (<https://arxiv.org/abs/2501.13956>); Cognee `memify` and `Forget` operations |

---

## 0. Relationship to Existing Memory Infrastructure

Added 2026-05-09 after review of prior specs in `docs/superpowers/specs/`. The bi-temporal extension proposed here **generalizes** the freshness mechanism already present in two places:

- `KnowledgeArticle.reviewIntervalDays` + `lastReviewedAt` from [EP-KM-001 (2026-04-02)](2026-04-02-knowledge-management-design.md), absorbed by EP-WIKI-001 §11 into `WikiPage`.
- The `validation_state ∈ {current, stale, advisory, advisory_until_revalidated}` retrieval-time gate from [EP-TAK-3F9A21 (2026-04-25)](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md) §12.5, including the deny-with-reason `archival_overdue_for_consequential_action`.

The world-time / system-time fields proposed below strengthen those gates with explicit retroactive-correction support — they don't replace them. Specifically:

- `systemExpiredAt` is the projection that drives `validation_state = stale` for wiki rows.
- `worldValidFrom` / `worldValidTo` add the orthogonal axis (when the claim is true *in reality*) that the existing single-timestamp model cannot express.
- The runtime freshness gate per TAK §12.5 continues to fire from the system-time projection; nothing in the gate's contract changes.

This spec assumes EP-WIKI-001 §11 has shipped and `WikiPage` is the canonical model name. References to "WikiPageRevision / WikiPageLink / WikiPageSource" below are the post-migration models.

---

## 1. Problem

EP-WIKI-001 detects two kinds of fact rot via a **daily lint job**:

- `kernel-drift` — an org override's `derivedFromKernelVersion` is older than the current kernel version.
- `contradiction` — two pages with cosine ≥ 0.85 carry incompatible claims.

Both are reactive. Contradictions accumulate between lint runs. "What did Mark believe in 2024 vs 2026?" cannot be answered. When new evidence supersedes old evidence, the old evidence is either edited (losing history) or left in place to be flagged later (inconsistent state).

Zep/Graphiti shows that these are **write-path concerns, not lint concerns**. Every fact carries two timestamp pairs:

- **World-time** (`worldValidFrom`, `worldValidTo`) — when the claim is true *in reality*.
- **System-time** (`systemCreatedAt`, `systemExpiredAt`) — when the platform learned/unlearned it.

When new evidence contradicts an existing claim, the write path **invalidates** the old fact (sets `systemExpiredAt = now()`) and inserts the new one. Old facts stay queryable for time-travel.

This subsumes both lint checks into queries.

---

## 2. Design

### 2.1 Bi-Temporal Fields on Existing Models

Add to `WikiPageRevision`, `WikiPageLink`, and `WikiPageSource`:

```prisma
worldValidFrom   DateTime?
worldValidTo     DateTime?
systemCreatedAt  DateTime  @default(now())   // already there as createdAt; rename or keep both
systemExpiredAt  DateTime?
invalidatedById  String?                     // FK to the revision/link/source row that superseded this one
```

For `WikiPageLink` (currently `(fromPageId, toPageId)` PK), the PK changes to `(fromPageId, toPageId, systemCreatedAt)` so multiple historical states of the same edge coexist.

### 2.2 Default Query View

All retrieval helpers (`searchWikiPages`, `recallWikiContext`, the API list endpoints) gain an implicit filter:

```ts
WHERE systemExpiredAt IS NULL
  AND (worldValidFrom IS NULL OR worldValidFrom <= NOW())
  AND (worldValidTo   IS NULL OR worldValidTo   >  NOW())
```

This is the "current view." Time-travel queries pass an explicit `asOf: Date` parameter that swaps `NOW()` for that date and ignores `systemExpiredAt`.

### 2.3 Write-Path Invalidation

Ingest gains a step between claim extraction (pass 2) and diff proposal:

1. For each extracted claim, look up existing claims on the target page that the LLM judges incompatible.
2. If incompatible, the existing revision/edge is **invalidated** in the same transaction as the new revision is inserted: `systemExpiredAt = now()`, `invalidatedById = newId`.
3. The old row stays. No data is destroyed.

The decision is part of the ingest proposal that the user/agent reviews, so a wrong invalidation is reversible by rejecting the proposal.

### 2.4 Lint Replaced by Queries

| Old EP-WIKI-001 lint | Replacement |
|----------------------|-------------|
| `kernel-drift` | Query: `WHERE kernelPageId IS NOT NULL AND derivedFromKernelVersion != currentKernelVersion AND systemExpiredAt IS NULL` |
| `contradiction` | Cannot exist in steady state — write path invalidates old fact. Lint becomes purely a regression check that flags pages with `cosine ≥ 0.85` and **no** invalidation lineage between them. |

New lint check: `temporal-inconsistency` — `worldValidTo < worldValidFrom` or `systemExpiredAt < systemCreatedAt`. Severity: error.

### 2.5 Per-Org Isolation

Bi-temporal applies to both kernel rows and overlay rows independently. The kernel can have its own world-time history (Mark's stance changed in 2024 vs 2026) and an org's overlay has its own. The two never share rows.

---

## 3. Why This Is Better

- **Contradictions never accumulate.** They're handled at write time, not by a daily job. Lint becomes a health check, not a cleanup.
- **Founder kernel evolution is queryable.** "Show me how Mark's stance on portfolio anchoring changed between kernel v1.0 and kernel v2.0" is a single query — exactly the use case the wiki is built for.
- **Audit trail is complete.** No fact is ever deleted; every transition has a row. GDPR delete becomes a separate, explicit op (see EP-WIKI-005 on `Forget`, future spec).
- **No new infrastructure.** Implemented entirely in Postgres with the columns above. No event store, no separate temporal DB.

---

## 4. Risks

- **Schema bloat.** Every revision row gains 4 timestamps + an FK. For an org with 10k pages × 10 avg revisions, ~400k extra columns — modest in Postgres terms.
- **Migration cost.** If EP-WIKI-001 Phase 1 ships first, this is an `ALTER TABLE` plus a backfill: `worldValidFrom = createdAt`, `systemCreatedAt = createdAt`, `worldValidTo = NULL`, `systemExpiredAt = NULL`. Backwards compatible.
- **Query helper discipline.** Every consumer of `WikiPage` rows must use the new helpers, not raw Prisma queries, or they'll see archived revisions. Enforce via lint rule on direct `prisma.wikiPage.find*` calls outside `apps/web/lib/wiki/`.
- **Invalidation false positives.** The LLM contradiction detector at write time will sometimes wrongly invalidate. Mitigation: invalidations are part of the ingest proposal that the user/agent reviews — reversible by rejecting the proposal.

---

## 5. Out of Scope (separate future specs)

- **`Forget` as a first-class scoped operation** (Cognee). GDPR-style hard delete with cascade. Spec target: `2026-05-09-wiki-forget-operation-design.md` (placeholder).
- **Reflection across time** — generating "Mark's stance evolved from X to Y between 2024 and 2026" pages. Falls under EP-WIKI-003 (importance + reflection).
- **Bitemporal extension to KnowledgeArticle.** Could happen later; not required for the wiki.
