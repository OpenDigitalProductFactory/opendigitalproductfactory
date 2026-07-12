# P5 — JIT-retrieval discipline (guard)

- **BI:** BI-223E55DA · **Epic:** EP-27FD96BC
- **Scope spec:** `docs/superpowers/specs/2026-07-11-coworker-reasoning-economy-scope.md`
- **Kernel:** no work-scope/altitude sub-decision — a pure additive guard + doc, no options to weigh.

## Problem (from the audit)

The reasoning-economy audit checked whether any operational / system-of-record table (orders, invoices, customer accounts, token-usage / tool-execution ledgers, build activity) is ever embedded into the vector store. **It is not** — every `generateEmbedding` caller is a durable-knowledge source (WWMD/WWWD corpus, documents, conversation/platform/capability memory). The discipline is intact.

The risk is *future* drift: someone adds "embed recent invoices for semantic search," a coworker starts reasoning over a stale vectorized snapshot, and the corpus silently diverges from the live database. Nothing today prevents that.

## Approach — freeze the embedding choke point

Substrate-verify-first: no fix to product code (discipline holds). Add a guard that makes a future violation loud.

`generateEmbedding` (`apps/web/lib/inference/embedding.ts`) is the single embedding entry point — every `storeWikiPage` / `storeConversationMemory` / document-embed path calls it. So freezing the *set of modules that call it* covers the whole surface.

1. **`apps/web/lib/inference/jit-retrieval-discipline.test.ts`** (new): `git grep -l generateEmbedding` over non-test `apps/web` sources, assert the caller set equals an explicit `ALLOWED_EMBEDDING_CALLERS` knowledge allow-list. A new caller fails the test with a message telling the reviewer to confirm it embeds knowledge, not a live operational record, before adding it. Also asserts each allow-listed caller still calls `generateEmbedding` (so the list can't rot).
2. **Doc** — augment P4 in `docs/architecture/context-engineering-standards.md`: operational records are fetched live and never vectorized; mark the aspect `[ENFORCED]` with a pointer to the guard.

## Verification
- Unit: the guard passes against the current tree (8 known knowledge callers) and would fail if an unlisted module called `generateEmbedding` (validated by construction — the allow-list is exactly the current set).
