# Corpus-scoped read grants — implementation plan (BI-825D3487)

Design: [corpus-scoped read grants](../specs/2026-10-28-corpus-scoped-read-grants-design.md),
under §2 R5 and §3.4 of the
[knowledge linking design](../specs/2026-10-14-knowledge-linking-design.md).
Each phase is test-first: the failing behaviour test lands before the code.

## Phase 1 — the resolver and the grant vocabulary

- Add `wiki_kernel_read`, `wiki_org_read` and `wiki_profession_read` to
  `COWORKER_READ_BASELINE_GRANTS` and to the known grant keys
  (`apps/web/lib/tak/agent-grants.ts`). `isKnownGrantKey` accepts
  `wiki_profession_read:<key>` only for a profession key in the registry.
- New `apps/web/lib/tak/corpus-read-scope.ts`:
  `resolveCorpusReadScope(agent)` returns
  `{ kernel, organization, professionFamilies, familyKey, mapped }`. Defaults
  come from the baseline, revocation rows remove them, and live
  `wiki_profession_read:<key>` rows add families.
- `corpusGrantMode()` reads `DPF_WIKI_CORPUS_GRANT_MODE`
  (`report-only` default, `enforce`).
- `wikiReaderForCorpusScope(scope, organizationId)` builds the backlinks
  `WikiReader` for an agent.

Tests: the resolver over defaults, revocations, extra-family rows, a revoked
extra family, an unmapped coworker in both modes, and the backlinks reader
built from a scope (AC-CRG-7).

## Phase 2 — enforcement in the read paths

- `wiki_query` (`apps/web/lib/mcp/packs/wiki-pack.ts`): pass the execution
  context through and resolve the caller's scope.
- `searchWikiPages` (`apps/web/lib/wiki/embeddings.ts`): accept a
  `corpusScope`, skip the kernel or organization pass the caller lacks, and
  limit the profession pass and the lexical fallback to the family set.
  Results rank the caller's own family first.
- `searchByPPR` (`apps/web/lib/wiki/ppr.ts`): filter the subgraph to readable
  pages before the walk, and seed with vector hits plus family pages.
- `recallWikiContext` (`apps/web/lib/wiki/recall.ts`): skip passes the coworker
  does not hold.
- `search_knowledge_base` refuses without `wiki_org_read`;
  `principle_decide` refuses without `wiki_kernel_read`;
  `evaluate_profession_decision` refuses for a family outside the set.
- Report-only: an unmapped coworker's profession read is recorded as a
  `corpus-grant-report` entry on its tool execution, and
  `listUnmappedProfessionReaders()` lists them.

Tests: vector, lexical and ppr filtering (AC-CRG-1, AC-CRG-5), revoked kernel
and organization corpora (AC-CRG-4), report-only and enforce (AC-CRG-3), and
extra family grant and revoke (AC-CRG-2).

## Phase 3 — audit and display

- Grant and revoke of a corpus key write an `authority-trail` tool execution row
  (`apps/web/lib/tak/coworker-tool-grant-core.ts`).
- The coworker identity page (`/platform/ai/agent/[agentId]`) shows a
  "Knowledge corpus" section from the resolver, with theme-aware styling.
- Seed: the boot seed never writes the three corpus grants, so a revocation
  survives a reboot seed (test over `isGrantRevoked`).

Tests: audit row on change, section render, and revocation survives the seed
(AC-CRG-2, AC-CRG-6).

## Traceability

requirement: OBJ-CRG-1, OBJ-CRG-2, OBJ-CRG-3.
contract: resolveCorpusReadScope corpus scope contract.
flow: coworker tool call → corpus scope → filtered knowledge results.
verification: AC-CRG-1, AC-CRG-2, AC-CRG-3, AC-CRG-4, AC-CRG-5, AC-CRG-6, AC-CRG-7.

| Requirement | Planned behavior | Acceptance verification |
| --- | --- | --- |
| OBJ-CRG-1 | Phases 1–2: the resolver and the filters in wiki_query, recall and backlinks. | AC-CRG-1, AC-CRG-5 and AC-CRG-7. |
| OBJ-CRG-2 | Phases 1 and 3: revocations, extra-family rows, audit and display. | AC-CRG-2, AC-CRG-4 and AC-CRG-6. |
| OBJ-CRG-3 | Phase 2: report-only mode and the unmapped-reader listing. | AC-CRG-3. |

## Backlog coverage

Atomic. The three phases ship as one change: the resolver without the filters
grants nothing, and the filters without the resolver have no scope to apply,
so no phase is independently shippable. Every deliverable maps to BI-825D3487.

## Risk and rollback

- The family filter narrows mapped coworkers immediately. A coworker whose job
  spans families needs a `wiki_profession_read:<key>` grant. The identity page
  shows the family set, so the gap is visible.
- Unmapped coworkers keep profession reads in `report-only`, so this release
  removes nothing they rely on.
- One revert restores today's behaviour. There is no schema change or data
  migration.
