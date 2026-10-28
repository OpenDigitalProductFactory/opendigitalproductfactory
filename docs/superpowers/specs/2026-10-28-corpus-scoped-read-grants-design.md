---
status: active
---

# Corpus-scoped read grants (BI-825D3487)

Scope manifest and delivery design for BI-825D3487. The governing design is
§2 R5 and §3.4 of the
[knowledge linking design](2026-10-14-knowledge-linking-design.md), amended in
#6665 to scope the profession corpus to the coworker's JSI profession family.
This file adds the delivery decisions that R5 leaves open and the
machine-readable acceptance rows.

## 1. Where the grants act (code survey, origin/main 2026-10-28)

- `TOOL_TO_GRANTS` (`apps/web/lib/tak/agent-grants.ts`) gates `wiki_query`,
  `search_knowledge_base`, `principle_decide` and `evaluate_profession_decision`
  on `registry_read` alone. `COWORKER_READ_BASELINE_GRANTS` merges
  `registry_read` into every coworker in code, so it cannot be narrowed.
- `wiki_query` (`apps/web/lib/mcp/packs/wiki-pack.ts`) turns the profession
  corpus on by default and takes `professionKey` from the caller, so any
  coworker can read any family. Its handler drops the execution context, so it
  does not know who is calling.
- `searchWikiPages` (`apps/web/lib/wiki/embeddings.ts`) reads the organization,
  profession and kernel corpora in separate passes, and its lexical fallback
  has the same three clauses. Each pass is a natural filter point.
- `searchByPPR` (`apps/web/lib/wiki/ppr.ts`) loads every published page with
  `organizationId IN (org, null)` into the walk, profession pages included,
  and labels them `org`.
- `recallWikiContext` (`apps/web/lib/wiki/recall.ts`) injects kernel and
  organization pages into coworker prompts.
- `search_knowledge_base` returns `KnowledgeArticle` rows, which are the
  organization's knowledge (WWWD, being absorbed into the overlay by
  BI-67F04B3F). `search_knowledge` returns backlog, epics and specs. It reads no
  knowledge corpus and is out of scope.
- The backlinks reader (`apps/web/lib/wiki/backlinks.ts`) already takes
  `WikiReader.professionFamilies`.

## 2. Delivery decisions

**D1. One resolver.** `resolveCorpusReadScope(agent)` in
`apps/web/lib/tak/corpus-read-scope.ts` returns
`{ kernel, organization, professionFamilies, familyKey, mapped }` for a
coworker. Every enforcement point calls it; none reads grants itself.

- `kernel` is held unless `wiki_kernel_read` is revoked for the coworker.
- `organization` is held unless `wiki_org_read` is revoked.
- `professionFamilies` is the coworker's own family from
  `findProfessionFamilyForAgentIdentity`, unless `wiki_profession_read` is
  revoked, plus one family for each live `wiki_profession_read:<key>` grant row.
  Revoked rows are ignored.
- `mapped` says whether the coworker resolved to a family at all.

**D2. Defaults live in code, removals live in rows.** The three grants join
`COWORKER_READ_BASELINE_GRANTS`, so every coworker holds them with no seed
churn. Unlike the other baseline grants, an `AgentToolGrantRevocation` row for
any of the three removes it. The boot seed never writes them, so a revocation
survives a reboot seed. Extra families are ordinary `AgentToolGrant` rows,
written and revoked through the existing coworker grant core
(`apps/web/lib/tak/coworker-tool-grant-core.ts`), whose closed key list now
accepts `wiki_profession_read:<key>` for registered profession keys only.

**D3. Report-only first, for unmapped coworkers only.**
`DPF_WIKI_CORPUS_GRANT_MODE` is `report-only` (the default in this release) or
`enforce`. The mode changes one case. An unmapped coworker keeps its
profession results in `report-only`, and each such read is recorded as a
`corpus-grant-report` entry on the tool execution. In `enforce` it gets none.
Kernel and organization revocations, and the family filter for mapped
coworkers, apply in both modes, because an operator chose them or the
coworker's own job defines them.

**D4. Enforcement points.**

- `wiki_query`: the handler receives the execution context. Vector mode passes
  the scope into `searchWikiPages`, which skips a corpus the caller does not
  hold and limits the profession pass, and the lexical fallback, to the
  caller's families. A requested `professionKey` outside the set returns no
  profession rows. Results rank the caller's own family first.
- `wiki_query` in `ppr` mode: `loadOverlaySubgraph` keeps only pages the
  caller may read before the walk, and the walk is seeded with the vector hits
  plus the caller's family pages. An ungranted page therefore neither appears
  nor changes any readable page's score.
- `recallWikiContext`: skips the kernel or organization pass the coworker does
  not hold.
- `search_knowledge_base`: refuses without `wiki_org_read`.
- `principle_decide`: refuses without `wiki_kernel_read`, naming the grant.
- `evaluate_profession_decision`: refuses for a family outside the caller's set,
  naming the family.
- Backlinks: `wikiReaderForCorpusScope(scope, organizationId)` builds the
  `WikiReader` for an agent reader, feeding the existing family seam. People
  keep `professionFamilies: null`.

**D5. Audit and display.** Granting and revoking already record `grantedBy`
and `revokedBy`. Each corpus grant change also writes an `authority-trail`
audit row, the same writer coworker grant reconciliation uses. The coworker
identity page (`/platform/ai/agent/[agentId]`) gets a "Knowledge corpus"
section showing the kernel, organization and family grants as the resolver
sees them, and whether the coworker is mapped.

## 3. Objectives and acceptance

**OBJ-CRG-1:** A coworker reads only the knowledge corpora its grants hold, and in the profession corpus only its own JSI family plus families granted to it.

**OBJ-CRG-2:** An organization can narrow or widen a coworker's corpus through audited grant rows that survive a reboot seed.

**OBJ-CRG-3:** Narrowing today's behaviour for unmapped coworkers is preceded by a report-only release that lists them.

| Acceptance | Objectives | Statement |
|------------|------------|-----------|
| AC-CRG-1 | OBJ-CRG-1 | With defaults, a mapped coworker's `wiki_query` (vector and lexical fallback) returns kernel pages, its organization's overlay and its own family's profession pages, and no page from another family, including when it asks for another `professionKey`. |
| AC-CRG-2 | OBJ-CRG-2 | A coworker with a `wiki_profession_read:<key>` grant also reads that family; after the grant is revoked it does not, including after a reboot seed. |
| AC-CRG-3 | OBJ-CRG-3 | In `report-only` mode an unmapped coworker still gets profession pages and each such read is recorded and listable; in `enforce` mode it gets none. |
| AC-CRG-4 | OBJ-CRG-2 | With `wiki_kernel_read` or `wiki_org_read` revoked, `wiki_query`, prompt recall and the backlinks reader return no page from that corpus; `principle_decide` (kernel) and `evaluate_profession_decision` (a family outside the set) refuse with a reason naming the missing grant or family. |
| AC-CRG-5 | OBJ-CRG-1 | In `ppr` mode a contract test shows that a page in an ungranted family neither appears in results nor changes the score of any readable page. |
| AC-CRG-6 | OBJ-CRG-2 | Corpus grant changes write an audit row, and the coworker identity page shows the coworker's kernel, organization and family grants and whether it is mapped. |
| AC-CRG-7 | OBJ-CRG-1 | The backlinks reader built for an agent omits and does not count a citing page from a family outside the agent's set (the corpus-grant half of BI-4EAFF7AC AC-KLB-4). |

## 4. Out of scope

- Changing the kernel or organization defaults (an organization decision).
- Limiting people by family. People keep RBAC; their family only ranks.
- Uses of `registry_read` outside knowledge reads.
- Turning `enforce` on. That is the next release, after the report has been
  read.
