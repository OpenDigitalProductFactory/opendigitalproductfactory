---
status: active
---

# Finish absorbing KnowledgeArticle into WikiPage (BI-67F04B3F)

Scope manifest for BI-67F04B3F. The design is in §6 of the
[knowledge linking design](2026-10-14-knowledge-linking-design.md). It
replaces the migration steps in EP-WIKI-001 §11.

## Objectives and acceptance

**OBJ-KLA-1:** The organization's knowledge articles become WWWD overlay wiki pages, and no data or history is lost.

**OBJ-KLA-2:** Existing callers keep working through a one-release compatibility period, after which the old model can be retired safely.

**OBJ-KLA-3:** No source file or document describes Qdrant as the current vector store.

| Acceptance | Objectives | Statement |
|------------|------------|-----------|
| AC-KLA-1 | OBJ-KLA-1 | Every `KnowledgeArticle` has a `WikiPage` in its organization's overlay with kind and status mapped and every revision copied with its version number. Product and portfolio anchors are kept in the renamed join tables, with their foreign keys. |
| AC-KLA-2 | OBJ-KLA-1 | The organization is resolved from the anchor, then the author, then the install's single organization. If the organization is ambiguous, the article is held and listed rather than guessed. `team` articles become drafts until the steward decides. |
| AC-KLA-6 | OBJ-KLA-1 | The new pages are embedded in `wiki-pages`, the old `knowledge-article-*` points are removed, and each page records `legacyArticleId`. Once BI-A63A9476 lands, the parser uses it so `KA-` ids keep resolving. |
| AC-KLA-3 | OBJ-KLA-2 | `search_knowledge_base`, `create_knowledge_article`, `flag_stale_knowledge` and `/knowledge` keep working on top of `WikiPage`, and each logs a deprecation notice. |
| AC-KLA-4 | OBJ-KLA-2 | A guard refuses to drop `KnowledgeArticle` and `KnowledgeArticleRevision` while any row has no mapped page, and the data-architecture steward's retention decision is recorded. Every consumer listed in §6 of the design has been repointed or retired. |
| AC-KLA-5 | OBJ-KLA-3 | EP-WIKI-001 §0.2 and §5, the schema comments and the other docs that describe the current system all name pgvector in Postgres as the vector store. |
