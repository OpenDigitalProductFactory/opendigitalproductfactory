---
status: active
---

# Universal entity references — implementation plan (BI-A63A9476)

Design: [knowledge linking](../specs/2026-10-14-knowledge-linking-design.md) §3
and §5, under the scope rules R1–R7 of its §2. Scope manifest:
[entity references](../specs/2026-10-14-knowledge-linking-entity-references-design.md).
Builds on BI-825D3487 (corpus read grants, `apps/web/lib/tak/corpus-read-scope.ts`),
BI-23900D0A (one wikilink extractor, `replaceGraphEdgesFromSource`), BI-4EAFF7AC
(wiki backlinks, `canReadWikiPage`) and BI-957915CB (document access,
`readableDocumentWhere`). Each phase is test-first: the failing behaviour test
lands before the code.

## Decisions taken against the current substrate

- **Edge key `MENTIONS`, not `REFERENCES`.** The typed relation vocabulary
  (BI-85389A35, §8 of its design) retired `REFERENCES` before any row was
  written and registered `MENTIONS` ("the source body names the target entity
  by id or wiki link", class navigational, inverse "is mentioned in").
  `assertRelationWrite` throws on the retired key, and the
  `graph_relation_type` row for `MENTIONS` already exists
  (`20261028060000_graph_relation_type`). The UI keeps the wording
  "Referenced by". The vocabulary entry gains `requiredProps: ["writtenBy",
  "projection"]` and the `Workroom` and `WorkroomMessage` labels.
- **No migration.** No table, column or index is added: the edge store is
  `graph_edge`, which already has `(dst_key, rel_type)` and `(src_key,
  rel_type)` indexes. The local gate therefore does not switch to the
  exhaustive suite for a schema change.
- **Workroom messages** are `WorkItemMessage` rows on a work item that a
  `Workroom` is anchored to; the edge carries the room's row id as `roomId`,
  and admission is `resolveHumanWorkroomAccess` / `resolveAgentWorkroomAccess`
  at `content`.

## Phase 1 — parser, renderer and edge store

- `packages/db/src/wiki-frontmatter.ts`: `extractEntityIds(body)` beside
  `extractWikilinks`, with the §3.4 pattern and lookbehind, skipping fenced
  code, inline code and URLs. `entityKindOfId(id)` maps the prefix.
- `apps/web/lib/shared/markdown.ts`: a `dpf_entity_ref` core rule after
  `inline`. It turns an id in a text token into a link only when the caller's
  `entityRefHref(id)` returns an href; otherwise the id stays text. No caller
  option means plain text (kernel pages).
- `packages/db/src/graph-sync.ts`: `replaceGraphEdgesFromSource` accepts edges
  with props. Document nodes stop carrying `title` (AC-KLR-7).
- `packages/db/src/pg-graph.ts`: `clearGraphByLabel` never deletes `MENTIONS`
  edges and keeps a node that still has one (AC-KLR-8).

Tests: `wiki-frontmatter.test.ts` (ids, lookbehind, code, URLs),
`markdown.test.ts` (readable, unknown and unreadable ids), `graph-sync.test.ts`
(edge props, content-free document node, label refusal),
`pg-graph-ownership.test.ts` (wipe ownership).

## Phase 2 — the writer, lifecycle and rebuild

- `packages/db/src/entity-reference-scope.ts` (pure): scopes, the R4 direction
  rule, and `planReferenceEdges`, which keeps resolved mentions, drops refused
  ones and builds the edge props (`sourceScope`, `targetScope`, organization
  and family on each side, `sourceField`, `writtenBy`,
  `projection: "references"`, `syncedAt`).
- `packages/db/src/entity-reference-sync.ts`: `syncEntityReferences(source,
  body)` resolves ids and `[[slug]]` links (the BI-23900D0A resolver), writes
  content-free nodes, refuses an incompatible label and replaces the source's
  `MENTIONS` edges. `repointReferenceTarget` (merge), `removeEntityReferences`
  (delete) and `countReferenceEdges`.
- `packages/db/src/entity-references-rebuild.ts` and the CLI
  `rebuild-entity-references.ts` (`pnpm --filter @dpf/db references:rebuild`).
  The rebuild keeps each edge's `writtenBy`.
- `graph-projection-reconcile.ts`: a `references` row (edges against edges whose
  both ends still exist).
- Write paths: `lib/actions/backlog.ts` (item and epic create, update,
  delete), MCP `create_backlog_item`, `update_backlog_item`,
  `merge_backlog_items` and the epic tools, `saveManagedDocument`,
  `postWorkItemComment`, and `syncWikiPageLinks` (wiki bodies, entity ids
  only). One app hook, `lib/references/sync-references.ts`, logs a failure
  and never fails the save; the weekly job repairs gaps.
- Weekly job `knowledge/entity-references-rebuild` with its catalog entry.

Tests: `entity-reference-scope.test.ts` (R4, idempotent plan, AC-KLR-2,
AC-KLR-4), `entity-reference-sync.test.ts` (create, remove, re-run, merge,
delete, label refusal), `entity-references-rebuild.test.ts`,
`graph-projection-reconcile-references.test.ts` and
`knowledge-portfolio-graph-ownership.test.ts` (AC-KLR-8), and
`apps/web/lib/references/sync-references.test.ts` (app hooks never fail a save).

## Phase 3 — the reader and the read surfaces

- `apps/web/lib/references/read-references.ts`: `canReadEntities(reader,
  kind, keys)` once per kind; `listInbound` and `listOutbound` push
  organization, corpus and family filters into SQL, batch-check, then load
  titles and snippets from the passing source rows. Keyset pages after the
  filter. `resolveReadableEntityHrefs` serves the renderer.
- `apps/web/lib/references/reference-reader.server.ts`: the reader for a
  session person or for an MCP agent (corpus scope, clearance intersection,
  operator's document viewer).
- Surfaces: `ReferencedByPanel` (Surface + `BacklinkGroup`) on the backlog
  item panel (with a body read view), `EpicCard` (description through
  `MarkdownHtml`), the document page, and the wiki page; Workroom activity
  messages link readable ids. `get_backlog_item` returns `referencedBy`
  (id, kind, title, scope; never a snippet).
- Admin graph explorer: gated labels and `MENTIONS` are excluded in SQL.
- Lint: `detectScopeCrossingReferences` (error, over stored edges) and
  `detectKernelEntityCitations` (info).
- Copy in `packages/i18n/src/messages/en-US/references.json`.

Tests: `read-references.test.ts` (AC-KLR-3 including the `referencedBy`
shape, AC-KLR-5 contract, AC-KLR-6, renderer id resolution for AC-KLR-1),
`ReferencedByPanel.test.tsx` (panel and `EntityRefText`),
`epic-description-markdown.test.ts`, `explorer-queries.test.ts` exclusion
(AC-KLR-7), `reference-lint-detectors.test.ts` (AC-KLR-4).

## Traceability

requirement: OBJ-KLR-1, OBJ-KLR-2, OBJ-KLR-3.
contract: syncEntityReferences writer and listInbound reader contract.
flow: body save → syncEntityReferences → MENTIONS edges → listInbound → Referenced by.
verification: AC-KLR-1, AC-KLR-2, AC-KLR-3, AC-KLR-4, AC-KLR-5, AC-KLR-6, AC-KLR-7, AC-KLR-8.

| Requirement | Planned behavior | Acceptance verification |
| --- | --- | --- |
| OBJ-KLR-1 | Phases 1–2: parser, renderer, writer, rebuild and edge ownership. | AC-KLR-1, AC-KLR-2 and AC-KLR-8. |
| OBJ-KLR-2 | Phase 3: the reader and the four "Referenced by" surfaces, plus `referencedBy` on `get_backlog_item`. | AC-KLR-3. |
| OBJ-KLR-3 | Phases 2–3: R4 in the writer and lint, the reader's per-kind rules, corpus grants, content-free nodes and explorer exclusion. | AC-KLR-4, AC-KLR-5, AC-KLR-6 and AC-KLR-7. |

## Backlog coverage

Atomic. The writer without the reader shows nothing, and the reader without
the writer has no edges to read, so no phase ships alone. Every deliverable
maps to BI-A63A9476.

## Risk and rollback

- Document nodes lose their `title` prop, so the admin explorer no longer
  names them; it no longer lists them either (AC-KLR-7).
- Bodies saved through writers not wired here (bulk importers, federation
  sync, other `backlogItem.update` call sites) get their edges from the weekly
  rebuild, not at save time. A failed save-time write is logged, not queued;
  the weekly rebuild is the retry.
- One revert restores today's behaviour. `MENTIONS` rows left behind are
  derived data and can be deleted by `DELETE FROM graph_edge WHERE rel_type =
  'MENTIONS'`; no source data changes.
