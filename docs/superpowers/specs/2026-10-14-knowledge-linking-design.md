---
status: active
---

# EP-0237A305: Knowledge linking within governed scopes (Obsidian lessons)

| Field | Value |
|-------|-------|
| **Epic** | EP-0237A305 |
| **Items** | BI-825D3487 (corpus-scoped read grants), BI-23900D0A (link-write repair), BI-4EAFF7AC (backlinks), BI-A63A9476 (entity references), BI-67F04B3F (KnowledgeArticle absorption), BI-2F7BE778 (editor autocomplete and preview), BI-5412E422 (vault export), BI-359C7C2F (quick switcher) |
| **Depends on (outside the epic)** | BI-957915CB (enforced document permissions), required before BI-5412E422 |
| **Ordering preference** | BI-MCP-EFF-4F823E5B (`search_knowledge` fails 71% of calls) lands before BI-359C7C2F. The switcher does not call that tool, but search reliability comes first. |
| **Builds on** | [EP-WIKI-001 Platform Kernel Wiki](2026-05-09-platform-kernel-wiki-design.md), [EP-WIKI-005 Visual Navigation](2026-05-09-wiki-visual-navigation-design.md), [Principles as a Wiki Kind](2026-05-12-principles-as-wiki-kind-design.md) |
| **Supersedes** | EP-WIKI-001 §11 migration steps (see §6) |
| **Funding** | Founder-funded shared platform work; weighted toward integration and refactoring |
| **Grounded on** | `origin/main` 100324128c7 and the dev install database, 2026-10-14 |

Each feature item has a short scope manifest. The manifest holds that item's
marked objectives and acceptance and points back to its section here:

| Item | Section | Scope manifest |
|------|---------|----------------|
| BI-4EAFF7AC | §4 | [knowledge-linking-backlinks](2026-10-14-knowledge-linking-backlinks-design.md) |
| BI-A63A9476 | §5 | [knowledge-linking-entity-references](2026-10-14-knowledge-linking-entity-references-design.md) |
| BI-67F04B3F | §6 | [knowledge-linking-article-absorption](2026-10-14-knowledge-linking-article-absorption-design.md) |
| BI-2F7BE778 | §7 | [knowledge-linking-editor](2026-10-14-knowledge-linking-editor-design.md) |
| BI-5412E422 | §8 | [knowledge-linking-vault-export](2026-10-14-knowledge-linking-vault-export-design.md) |
| BI-359C7C2F | §9 | [knowledge-linking-quick-switcher](2026-10-14-knowledge-linking-quick-switcher-design.md) |

BI-825D3487 (§2 R5) and BI-23900D0A (§4.1) carry their acceptance in their
backlog bodies.

The manifests are separate files because the readiness baseline
(`apps/web/lib/backlog/initiative-readiness/baseline-manifest.ts`) reads every
marked objective and acceptance row in a file. If one file held six items'
rows, each item would owe the other five items' acceptance. This document
therefore states acceptance in prose, and the manifests carry the marked rows.

---

## 1. Problem

Research into why people love Obsidian (2026-10-14) found four traits:
linking costs nothing, every page shows what links to it, any note is one
keystroke away, and the notes are plain markdown the owner keeps. DPF has
most of the data for this but shows little of it:

- `WikiPageLink` holds 657 rows and `WikiPage.inLinks` is a real backlink
  index, but nothing renders it. The only reader is
  `lib/decision-perspective/material-backlinks.ts`. The rows are also
  incomplete (§4.1).
- Ids written in bodies (`BI-…`, `EP-…`, `DOC-…`, `KA-…`) are plain text.
  `BacklogItem.body` has no read view at all; it appears only in the edit
  textarea of `components/ops/BacklogPanel.tsx`. `Epic.description` is
  pre-formatted text in `components/ops/EpicCard.tsx`.
- Knowledge lives in four stores: `WikiPage` (375 rows), `Document` (92),
  `KnowledgeArticle` (3), and backlog bodies.
- The wiki editor is two plain textareas. A mistyped link surfaces only as a
  `dangling-xref` lint finding after the fact.
- There is no bulk export, no command palette and no keyboard switcher.

## 2. The governing constraint: links live inside scopes

Obsidian is a single-user vault: everything links to everything, and anyone
who opens the vault reads all of it. DPF must not copy that. The platform is
built on three governed knowledge scopes, and on 2026-10-14 the founder
restated that linking must keep them separate. Links between them are allowed
only where privileged-user access (RBAC), the use case and the Workroom
permit it.

| Scope | Corpus | Where it lives | Who decides |
|-------|--------|----------------|-------------|
| **WWMD** | Founder kernel: platform doctrine | `WikiPage.isKernel = true`, shipped by PR from `docs/founder-kernel/` | Platform, by PR only |
| **WWWD** | The organization's own knowledge: overlay and override pages, documents, backlog, epics, Workrooms | `WikiPage.organizationId` set; `Document`; work records | The organization |
| **WSID** | Profession craft corpus | `WikiPage` with `organizationId = null`, `isKernel = false`, slug under `professions/` | The profession |

`searchWikiPages` already derives the corpus this way
(`apps/web/lib/wiki/embeddings.ts`, the `source: "kernel" | "profession" | "org"`
field). The principle `decisions-belong-to-their-scope` makes each scope
authoritative only for its own decisions.

Regulated customers add a second reason. Recent attacks on agent systems
abuse broad read access: an agent that can read everything can be steered by
injected text into disclosing it (OWASP Top 10 for LLM Applications 2025,
LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency). A
careless link graph makes this worse. A backlink list or a "referenced by"
count tells the reader that something exists, what it is called and what it
says, even when the reader cannot open it (CWE-200; OWASP A01:2021 Broken
Access Control).

Every item in this epic follows these rules.

**R1. A link never grants access.** Backlinks, "referenced by", unlinked
mentions, autocomplete, the quick switcher and export are all read paths.
Each result is checked at read time against the reader's own access to that
entity. An entity the reader cannot open is left out entirely: no title, no
snippet, no count, and no "1 hidden item" placeholder. GitHub does the same
with cross-references from private repositories.

**R2. The reader is the intersection.** For a person, the reader's access is
their user capabilities in their own organization. That organization comes
from the session, never from `prisma.organization.findFirst()`, which the
wiki route uses today
(`app/(shell)/coworker-decisions/[...slug]/page.tsx:36`); this epic's read
paths must not copy that. For a coworker or external agent, access is the
intersection of the token scope, the coworker's grants and the operator's
capabilities, which is the authority rule in AGENTS.md §6. When the call
comes from a Workroom, it is further limited to what that room's admitted
participants may read. No linking feature opens a path around this
intersection.

**R3. Edges are derived, not authored.** Reference edges are computed from
bodies by one system writer (§3). Neither people nor agents write an edge
directly. An edge can exist only because someone allowed to write the source
body wrote the id into it. This blocks forged provenance, such as an agent
planting a fake "cited by principle X" link.

**R4. Edges cross scopes in one direction only.** A scope is a pair:
(corpus, organization).

- A WWWD record may reference WWMD and WSID pages. That is normal, because an
  organization builds on platform doctrine and craft.
- A WWMD kernel page never references an organization's records, because it
  ships to every install.
- A WSID page never references WWWD records.
- A WWWD record never references another organization's WWWD record. This
  matters on an MSP install that holds several customer estates.
- A backlog item with no `organizationId` is install-scoped platform work. It
  may reference the install's WWWD records, but never across customer
  estates.

The writer refuses edges that break these rules. Each edge records its source
and target scope, so a reader can filter to links within one scope.

When the author meets a refused reference and when the author writes an
unknown id, the editor and lint show the same "unresolved reference". A
different message would tell the author that the target exists.

**R5. Agents see only the corpus their job needs (BI-825D3487).** Today the
code merges `registry_read` into every coworker
(`COWORKER_READ_BASELINE_GRANTS`, `apps/web/lib/tak/agent-grants.ts:114-123`).
That grant covers all three corpora at once, and `wiki_query`,
`search_knowledge_base`, `principle_decide` and `evaluate_profession_decision`
are gated on it alone. An implication from `registry_read` could therefore
never narrow anything.

BI-825D3487 adds three grants: `wiki_kernel_read`, `wiki_org_read` and
`wiki_profession_read`. Kernel and organization reads are whole-corpus grants.
The profession read is scoped to job families, because the WSID corpus is 23
professions, not one body of knowledge. A finance coworker has no need for the
security or HR craft pages, and under JSI (Job-Specific Intelligence,
`2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md`) each
coworker's corpus is meant to be specific to its job.

- **Kernel and organization defaults.** Every coworker holds
  `wiki_kernel_read` and `wiki_org_read`, so today's behaviour is unchanged.
- **Profession default: the coworker's own family.** `wiki_profession_read`
  lets the coworker read pages under `professions/<key>/` for its bound
  family only. The family is resolved by
  `findProfessionFamilyForAgentIdentity`
  (`apps/web/lib/decision-perspective/resolve-profession-profile.ts`), the
  same resolver that profession grounding already uses
  (`apps/web/lib/tak/profession-grounding.ts`). Grant checks and prompt
  grounding therefore always agree on what a coworker's craft corpus is.
- **Further families.** A job that genuinely spans professions gets one more
  `AgentToolGrant` row per extra family, keyed
  `wiki_profession_read:<professionKey>`. Adding one is a WWWD decision made
  from the coworker record. Revoking one uses the existing
  `AgentToolGrantRevocation` tombstone, so the boot seed cannot bring it
  back. `AgentToolGrant.grantKey` is already a free string, so no schema
  change is needed.
- **No family, no profession read.** A coworker that maps to no family
  reads no profession pages. This fails closed, and it narrows today's
  behaviour. Before enforcement, one release runs in report-only mode: it
  lists unmapped coworkers that read profession pages, using
  `ProfessionCorpusUsageStat` and the tool logs, so the organization can bind
  or grant a family before access is removed.
- **Narrowing the kernel or organization corpus.** These grants are stored
  per coworker as `AgentToolGrant` rows, the existing per-coworker grant
  store edited from the coworker record. An organization can remove either
  corpus from a coworker; that is a WWWD decision.
- **Enforcement.** Every knowledge read tool filters its results by the
  caller's corpus grants and profession families. That covers the existing
  tools and every linking path in this epic. A tool whose whole purpose is
  one corpus refuses cleanly when the caller lacks the grant:
  `principle_decide` for the kernel, and `evaluate_profession_decision` for a
  family outside the caller's set.
- **People.** Family scoping is a limit on agents. People read the
  profession corpus through their own RBAC capabilities, as today. A person's
  occupation family (`OccupationProfile.wsidProfessionFamily`) is used only to rank
  results (below), never to hide them.

Narrowing the defaults themselves is an organization decision, not a platform
one.

**Ranking within the job's family.** Every list that the linking features
return puts the reader's own family first. That covers backlinks, "referenced
by", unlinked mentions, editor autocomplete and the quick switcher. For an
agent, the family is its bound family; for a person, it is the family of their
occupation, if one is bound. The order is: same family, then the kernel and the
reader's organization overlay, then other granted families. Ranking runs only
after the R1 filter, so a page that was filtered out cannot affect the order.

**Graph retrieval seeded from the job.** When `wiki_query` runs in `ppr` mode
(Personalized PageRank over the `WikiPageLink` subgraph,
`apps/web/lib/wiki/recall.ts`), it does two things:

- It cuts the subgraph down to the pages the caller may read before
  PageRank runs. A walk therefore never passes through a page outside the
  caller's families, and such a page cannot raise the score of a readable
  one.
- It seeds the walk with the query's vector hits plus the caller's family
  pages. Links therefore pull in related craft from the coworker's own field,
  not from neighbouring professions.

`vector` mode applies the same family filter. Links from one family to
another remain allowed (R4 permits WSID→WSID), but such a link is followed
only if the far end is in the caller's family set.

**Linking the organization's stance to its craft.** An organization overlay
page that sets the organization's position for a job may link to that job's
profession pages. R4 already permits WWWD→WSID links. With family ranking, a
coworker reading its organization's overlay therefore reaches its own craft
corpus first. No link runs back from WSID to WWWD.

**R6. Export is the highest-risk path.** Export takes knowledge out of the
platform. In this epic only a person can start one, from the portal. There is
no MCP export tool; a later item may add one with human approval for each
run. Export needs its own grant, `knowledge_export`, which no other grant
implies. Each run covers one scope and is audited (§8).

**R7. Kernel pages stay read-only in the runtime.** A "link it" action on a
kernel page offers nothing. Kernel edits stay PR-only (EP-WIKI-001 §0.4).

---

## 3. Shared substrate: one derived reference graph

### 3.1 Substrate verification

Run as `dpf-verify-substrate-first` on 2026-10-14:

| Candidate | Fit | Verdict |
|-----------|-----|---------|
| `GraphNode` / `GraphEdge` (`graph_node`, `graph_edge`, BET-5, `packages/db/src/graph-sync.ts`) | Universal node key; `(src_key, dst_key, rel_type)` is unique and indexed both ways; JSON props. Already mirrors wiki pages (`Wiki__*` labels keyed by `WikiPage.id`), `LINKS_TO` (657 rows, matching `WikiPageLink`), `OVERRIDES`, `Document` nodes and `DOC_REFERENCES`. Rebuildable by design. | **Use** |
| `WikiPageLink` | Wiki-to-wiki only, with no props. | Keep as the wiki system of record, projected as today |
| `DocumentReference` | Document-to-document and versioned; 0 rows. | Keep for controlled-document references |
| New `EntityReference` table | Would duplicate the edge store. | **Rejected** |

Rule: **the source body is the system of record, and references are a
derived projection.** That is the role `graph_edge` already plays ("Postgres
graph mirror", maintained by sync writers). If every reference edge were lost,
no data would be lost, because the rebuild (§5) recreates them from the
bodies.

### 3.2 Node keys

| Entity | Graph key | Label | Scope |
|--------|-----------|-------|-------|
| Wiki page | `WikiPage.id` (existing) | `Wiki__<Kind>` (existing) | From `isKernel`, `organizationId` and slug |
| Backlog item | `itemId` (`BI-…`) | `BacklogItem` | WWWD, plus `sensitivity` |
| Epic | `epicId` (`EP-…`) | `Epic` | WWWD |
| Document | `documentId` (`DOC-…`, existing) | `Document` (existing) | WWWD |
| Workroom | room id (`WC-…`) | `Workroom` | WWWD, room-gated |
| Workroom message (a source only) | `WorkItemMessage` id | `WorkroomMessage` | WWWD, gated by its room (`props.roomId`) |
| Knowledge article | none; absorbed into wiki pages (§6) | | |

Keys are the semantic ids people already write, so a mention resolves to a
key without a lookup table.

Workroom messages are keyed per message. If they were keyed per room, each
new message's edge replacement would delete the edges from earlier messages.

**Nodes and edges hold no content.** For gated kinds (backlog item, epic,
document, Workroom, message) the graph stores only the key, the label, the
scope and `organizationId`. Titles, statuses and snippets are read from the
source row at read time, after `canReadEntity` has passed. Other readers of
the mirror include the admin graph explorer
(`apps/web/lib/graph/explorer-queries.ts`, gated only by `view_admin`). If the
mirror held content, those readers would bypass R1. Keeping content out also
means a title or snippet is never stale.

The writer refuses to upsert a node whose key already exists under an
incompatible label. Today `upsertGraphNode` silently merges labels, and
`graph_node.key` is one global namespace.

### 3.3 Edge types

| `rel_type` | Meaning | Writer |
|------------|---------|--------|
| `LINKS_TO` | wiki `[[slug]]` link | existing `syncWikiPageLink`, switched to replace semantics on commit (§4.1) |
| `REFERENCES` | an entity id in any body, or a `[[slug]]` in a non-wiki body | new reference writer (§5) |

`REFERENCES` edges carry these props:

- `sourceScope` and `targetScope`;
- `sourceField`: `body`, `description` or `message`;
- `writtenBy`: the principal whose write produced the edge, which is the
  provenance R3 relies on;
- `projection: "references"`: an ownership marker;
- `syncedAt`.

They carry no snippet. Repeated mentions of one target from the same source
collapse into one edge, as `DOC_REFERENCES` already does.

The graph module has no single-edge delete today. §5 adds
`replaceGraphEdgesFromSource(srcKey, relType, edges)` to `graph-sync.ts`, and
both `LINKS_TO` and `REFERENCES` use it.

**Edge ownership.** Existing whole-label wipes would destroy edges they do not
own. `clearGraphByLabel` (`pg-graph.ts:573`), called by
`rebuild-documents-graph.ts`, deletes every edge that touches a `Document`
node, references included. This epic restricts `clearGraphByLabel` and each
rebuild job to the edge types they own. `REFERENCES` edges are removed only
by the reference writer, or when their source or target entity is deleted.

### 3.4 One parser, one renderer, one reader

- **Parser.** One extractor in `packages/db/src/wiki-frontmatter.ts`, fixed by
  BI-23900D0A, understands `[[slug]]` and `[[slug|label]]`. The slug may
  contain `/`, as in `principles/no-assumptions`. A sibling function,
  `extractEntityIds`, recognises
  `(?<![A-Za-z0-9-])(BI|EP|DOC|KA|WC)-[A-Z0-9]+(?:-[A-Z0-9]+)*`. The lookbehind
  stops it matching inside keys such as `ACT-WC-…`. Both functions skip fenced
  code, inline code and URLs. The lint detector's private copy
  (`apps/web/lib/wiki/lint-detectors.ts:209-217`) is deleted in favour of the
  shared one.
- **Renderer.** A markdown-it inline rule `dpf_entity_ref`, registered next to
  the existing `dpf_wikilink` rule in `apps/web/lib/shared/markdown.ts`, so
  every `MarkdownHtml` surface gets it. The server resolves the readable ids
  in a body before rendering and passes them in as a set. Readable ids become
  links. All other ids stay plain text, so an unknown id and an unreadable id
  look the same (R1). On kernel pages, entity ids always render as plain text.
  The 48 such ids in 26 kernel files are historical citations from the
  platform's own backlog, and R4 forbids kernel→WWWD edges. Lint reports them
  at info level.
  `ownerSafeBuildText` in `components/build/BuildOperatorOverview.tsx` hides
  ids on purpose for owner-facing build text, and it stays as it is.
- **Reader.** `apps/web/lib/references/read-references.ts` exposes
  `listInbound(targetKey, reader, page)` and
  `listOutbound(sourceKey, reader, page)`. Each read runs in three steps:
  1. The query pushes the cheap filters into SQL: the organization and corpus
     columns stored on the edges, and, for profession pages, the family key
     taken from the `professions/<key>/` slug prefix (R4 and R5).
  2. The batch check `canReadEntities(reader, kind, keys[])` runs once per
     kind, never once per row.
  3. Titles and snippets are loaded from the source rows that passed.

  Pagination is keyset-based and applied after filtering, so a cap never
  counts rows the reader cannot see. The scale ceiling is a few thousand
  inbound edges per target. Heavily cited kernel principles are the worst
  case. The per-kind rules are:

  | Entity | Rule |
  |--------|------|
  | Wiki page | Organization scope: `organizationId IN (null, readerOrg)`, with the reader's organization taken from the session. Agents also need the corpus grant for the page; for a profession page, the page's family must be in the agent's family set (R5). Results are ordered by the reader's family after this filter (R5, ranking). |
  | Backlog item, epic | Backlog read capability. Items marked `confidential` or `restricted` also require that level in the reader's `Principal.sensitivityClearance`; for an agent, in the clearance of both the coworker and its operator. Both enums use the same four levels. |
  | Workroom, Workroom message | Room admission |
  | Document | `canReadDocument`, owned by BI-957915CB (enforced document permissions). Until that item lands, the reader applies organization scope, and the readable set excludes any document whose `accessScope` is not `organization`. Excluding them never leaks; it only hides more than strictly necessary. |

  Every linking feature calls this reader. No feature queries edges and
  decides visibility on its own. The admin graph explorer excludes the gated
  labels and `REFERENCES` edges unless it reads them through this function.

### 3.5 Shared listbox

The codebase has no combobox or command component, and `cmdk` is not a
dependency. The editor (§7) and the switcher (§9) share one new
`components/shared/Combobox.tsx` built to the WAI-ARIA APG combobox pattern,
with theme tokens from AGENTS.md §9. No new dependency is added for it.

---

## 4. Backlinks and unlinked mentions on wiki pages (BI-4EAFF7AC)

### 4.1 Prerequisite: correct link rows (BI-23900D0A)

Backlinks are only as good as `WikiPageLink`, and today it is incomplete:

- `extractWikilinks` (`packages/db/src/wiki-frontmatter.ts:239`) ignores
  `[[slug|label]]`, so labelled links render but are never stored.
- `getWikiPage` (`packages/db/src/wiki-store.ts:406`) matches the exact
  organization only, so an overlay page's link to a kernel page is never
  stored.
- `linkPages` only upserts, so removed links persist.
- `LINKS_TO` is refreshed only by the batch rebuild.

BI-23900D0A makes these changes:

- Merges the two duplicate commit paths (`syncOutLinks` in
  `apps/web/lib/wiki/proposal-commit.ts:599` and `apps/web/lib/actions/wiki-edit.ts:102`)
  into one function.
- Fixes the shared extractor.
- Resolves link targets explicitly: the page's own organization first, then
  the kernel, then the profession corpus. `@@unique([organizationId, slug])`
  does not constrain null organizations, so a null-organization lookup alone
  cannot tell a kernel page from a profession page.
- On commit, replaces the page's out-links in both `WikiPageLink` and
  `LINKS_TO` through `replaceGraphEdgesFromSource`. `pruneKnowledge` removes
  edges only when an endpoint page is gone, so a link removed between two live
  pages would otherwise stay.
- Backfills existing pages.

BI-4EAFF7AC depends on it.

### 4.2 Panel

**Surface.** A "Linked from" panel on the wiki viewer
(`components/wiki/WikiPageViewer.tsx`, route `coworker-decisions/[...slug]`).
It sits below the body on narrow screens and in a right column on wide
screens. `BacklinkGroup` is moved out of
`components/decision-perspective/MaterialBacklinksPanel.tsx` into a shared
component with real links (today its chips are `<span>`s), and the material
panel keeps using it.

**Organization.** The route resolves the reader's organization from the
session. This replaces `prisma.organization.findFirst()`
(`page.tsx:36`) for this page (R2).

**Data.** Until BI-A63A9476 lands, the panel uses the existing
`wikiPageLink.findMany` helper in `material-backlinks.ts:353-374`, wrapped by
the shared reader's `canReadEntities`. After BI-A63A9476 it reads inbound
`LINKS_TO` and `REFERENCES` edges through `listInbound`, which also shows
backlog items, epics and documents that cite the page. This lets
BI-4EAFF7AC ship first.

**Rows.** Each row shows the title, a page-kind chip (EP-WIKI-005 §6.1
shapes), a scope badge (Platform, Organization or Profession), and the text
around the link. Rows are grouped by scope with the reader's own scope first,
so on an organization page the organization's citations come before platform
ones.

**Overrides.** An organization's override of a kernel page lists links to
both the override and the kernel page it overrides, each labelled. Another
organization's backlinks never appear: the install is the tenant, and the
MSP estate boundary is applied through R2.

### 4.3 Unlinked mentions

A collapsed section lists readable pages whose body contains this page's
title, or the last segment of its slug, as whole words. Matches inside code
or inside an existing link are excluded, as are pages that already link here.
`WikiPage` has no full-text column. The query uses `pg_trgm` (installed) with
a new GIN trigram index on `WikiPage.body`. The organization and corpus
filters run in SQL, then a whole-word check runs in code. The 20-row cap
applies after filtering.

Each row offers **Link it**:

- On an overlay page the reader may edit, it opens a proposal through the
  existing `executionMode: "proposal"` path. The proposal wraps the first
  mention as `[[slug|text]]`.
- On a kernel or profession page it is not offered (R7).

**Empty state.** "No pages link here yet." When the unlinked list is also
empty, nothing more is shown.

**Acceptance (prose; the marked rows are in the scope manifest).** The list
matches the readable inbound rows exactly. Unreadable sources never appear
and are never counted. Unlinked mentions leave out pages that already link
here. The panel works for kernel, overlay and override pages. It passes the
UX-fit review and the §9 theme rules.

---

## 5. Universal entity references (BI-A63A9476)

**Write path.** `syncEntityReferences(source, body)` runs after every
committed write of a body field:

- `BacklogItem.body` on create, update and merge (MCP tools and
  `BacklogPanel` actions),
- `Epic.description`,
- the text of each new current `DocumentVersion`,
- each Workroom message (`WorkItemMessage`). Messages are append-only, so each
  is written once and keyed by its own id,
- `WikiPage.body` on revision commit, for entity ids only. Wiki-to-wiki links
  stay on `LINKS_TO`.

The writer parses the body (§3.4), keeps the mentions that resolve to an
existing key, applies R4, and calls `replaceGraphEdgesFromSource`. That call
deletes this source's `REFERENCES` edges that are no longer mentioned and
upserts the rest, so running it twice on the same body changes nothing. It
runs in the same request after the commit. If it fails, the failure is logged
and queued for retry, and the user's save is never blocked; the reconcile
job repairs any gap.

**Rebuild.** `pnpm --filter @dpf/db references:rebuild` runs the writer over
every body. A weekly scheduled job does the same, and also adds a `references`
count to `reconcileGraphProjections` (`graph-projection-reconcile.ts`). That
reconcile only counts and reports; the rebuild is what repairs. Both can be
re-run at any time.

**Lifecycle.**

- `merge_backlog_items` re-points the merged item's inbound edges to the
  surviving item.
- A retired item keeps its edges. The reader shows its status, read at the
  time of the request.
- Deleting a wiki page, document or message removes the edges that start or
  end at it.
- The node holds no content (§3.2), so renames need no graph update.

**Read surfaces.** All of these go through `listInbound`:

- a "Referenced by" section in the backlog item panel
  (`components/ops/BacklogPanel.tsx`; there is no separate item page) and on
  `EpicCard`;
- the document page (`workspace/documents/[documentId]`);
- the wiki panel (§4).

Each row shows the source entity, its kind and scope, and a snippet taken from
the source row at read time. The MCP `get_backlog_item` response gains a
`referencedBy` array, filtered the same way. It holds only id, kind, title and
scope, and no snippet. That way text planted by a less privileged writer never
reaches a privileged agent's context unless the agent opens the source itself
(OWASP LLM01, indirect prompt injection).

**Rendering.** The backlog item panel gains a read view of the body through
`MarkdownHtml`. `EpicCard` swaps its URL-splitting regex for `MarkdownHtml`.
Both, along with document and Workroom message views, pick up the
`dpf_entity_ref` rule.

**Corpus grants.** The narrow read grants come from BI-825D3487, which lands
first (R5). This item checks them on every read surface it adds.

**Out of scope.** People @mentions and subscriptions (owned by EP-D7361FCF;
the parser must not claim `@`) and graph visualization (EP-WIKI-005).

**Acceptance (prose).** Known, readable ids render as links and everything
else as plain text. Saving creates and removes edges idempotently. The
rebuild can be re-run. "Referenced by" shows source, kind, scope and snippet,
and hides what the reader cannot open. Edges that break R4 are refused. No
new table is added.

---

## 6. Finish absorbing KnowledgeArticle (BI-67F04B3F)

**Does EP-WIKI-001 §11 cover it?** No. §11 assumed `KnowledgeArticle` was
empty and planned to rename it into `WikiPage`. Since then both models have
grown up separately. `WikiPage` is live with its own revisions, and
`KnowledgeArticle` has 3 rows on the dev install (KA-001 published, KA-002
and KA-003 archived), and customer installs may have more. A rename is no
longer possible. This section replaces §11's steps. §11's direction still
stands: one knowledge model, with wiki search as the search surface.

**Scope.** Knowledge articles are an organization's own knowledge, so they
become **WWWD overlay pages** with `isKernel = false`. They never become
kernel or profession pages.

`KnowledgeArticle` has no `organizationId`, so the migration decides the
organization in this order:

1. The organization of the anchored product or portfolio.
2. The author's organization.
3. The install's single organization, when exactly one exists. Install is the
   tenant.

If the organization is still ambiguous, for example on an MSP install with
several customer estates, the migration holds the article and lists it for
an administrator. It never guesses, and it never uses `findFirst`.

`visibility` maps as follows:

- `internal` → an organization page.
- `public` → an organization page with `metadata.visibility = public`.
  Publishing beyond the organization stays a separate decision.
- `team` → kept as a **draft** overlay page until the data-architecture
  steward decides how team visibility maps. Otherwise a team-only article
  would become readable by the whole organization.

**Current consumers** (all to be repointed or retired):

- Routes: `app/(shell)/knowledge/*` and `portfolio/product/[id]/knowledge`.
  Components: `components/knowledge/*`.
- MCP tools in `lib/mcp/packs/knowledge-pack.ts`: `search_knowledge_base`,
  `create_knowledge_article`, `flag_stale_knowledge`. Their grant entries in
  `agent-grants.ts`, `packages/db/data/grant_catalog.json` and
  `packages/db/src/platform-tools-snapshot.json`, plus
  `lib/gpp/known-unclassified-side-effect-tools.ts` and
  `lib/tak/tool-result-provenance.ts`.
- Libraries:
  - `lib/actions/knowledge.ts`, `lib/actions/agent-coworker.ts`,
    `route-knowledge-pointers.ts`;
  - `coworker-self-tasks.ts:448`, `product-operating-context-query*.ts`,
    `product-management-playbook.ts`;
  - the route contexts `lib/tak/{agriculture,product-line,product}-route-context.ts`
    and `route-context-map.ts`;
  - `lib/govern/data/legacy-coverage-baseline.ts`.
- `semantic-memory.ts`: `storeKnowledgeArticle` writes the points
  `knowledge-article-<id>` into the `platform-knowledge` collection.

**Migration** (additive, never destructive, per `never-wipe-db-for-code-fixes`):

1. **Pages.** For each article, create a `WikiPage` with:
   - `slug = "knowledge/" + kebab(articleId + "-" + title)`;
   - `pageKind` mapped from `category`: `how-to`, `runbook` and
     `troubleshooting` become `runbook`; `decision` becomes `decision`;
     `policy`, `process` and `reference` become `summary`;
   - `status` mapped one to one (`review-needed` and `archived` already
     exist);
   - `abstract` and `lastReviewedAt` copied over;
   - `metadata` holding `legacyArticleId`, `visibility`, `valueStreams`,
     `tags` and `reviewIntervalDays`.
2. **Revisions.** Copy each `KnowledgeArticleRevision` into
   `WikiPageRevision`, keeping version numbers, authors and timestamps.
3. **Anchors.** Keep EP-WIKI-001 §11's normalized direction. Rename
   `KnowledgeArticleProduct` and `KnowledgeArticlePortfolio` to
   `WikiPageProduct` and `WikiPagePortfolio`, so they key on the page and keep
   their foreign keys and cascades. The product knowledge tab reads those
   tables. Anchors are relational source data, and are not demoted to JSON or
   to a derived edge.
4. **Embeddings.** Embed the new pages into `wiki-pages` and delete the
   `knowledge-article-*` points from `platform-knowledge`. `search_knowledge`,
   which searches that whole collection, keeps working for capabilities and
   platform knowledge.
5. **Old ids.** `KA-…` ids keep resolving: the reference parser maps them to
   the page through `metadata.legacyArticleId`.

**Compatibility window** (one release):

- `search_knowledge_base` becomes a WWWD-scoped wiki search with the same
  response shape.
- `create_knowledge_article` opens an overlay page proposal.
- `flag_stale_knowledge` reads review-due overlay pages.

All three log a deprecation notice, and `/knowledge` redirects to the wiki
with an organization filter.

**Retirement** (a later release, after the window): drop `KnowledgeArticle`
and `KnowledgeArticleRevision`. The join tables survive under their new
names. A guard first checks that every row has a mapped
page, and the data-architecture steward records the retention decision for
the retired tables.

**Stale documentation.** EP-WIKI-001 §0.2 and §5 describe Qdrant. The vector
store is pgvector in Postgres (`vector_embedding`, `pgvector-store.ts`); BET-5
replaced Qdrant and Neo4j. Those sections, the schema comments, and other
docs that present Qdrant as current are corrected. Docs that describe it as
history stay as they are.

**Acceptance (prose).** Every article has a page with full history, and no
data is lost. Existing callers keep working through the window. No source or
doc says Qdrant is the current vector store. The steward review is recorded.

---

## 7. Wiki editor: link autocomplete, dangling-link warning and preview (BI-2F7BE778)

**Surface.** `components/wiki/WikiPageEditor.tsx` (route
`coworker-decisions/edit/[...slug]`). The textarea stays; this is not a
WYSIWYG editor.

**Autocomplete.** Typing `[[` opens the shared `Combobox` (§3.5) at the
caret. After two characters it calls `GET /api/wiki/link-suggest?q=` and
shows up to 8 matches by title, slug and kind:

- Matching uses `pg_trgm` similarity on title and slug.
- Every result passes `canReadEntity`.
- Results follow R4: an overlay page may link kernel, profession and overlay
  pages; a profession page may link only profession and kernel pages.

Arrow keys move through the list. Enter or Tab inserts `[[slug|title]]`, and
Escape closes it. Target: under 200 ms at the 95th percentile on the dev
install, measured at the route.

**Dangling-link warning.** As the author types (debounced 400 ms), links are
checked by the same resolver the `dangling-xref` detector uses. That resolver
is `detectDanglingXrefs`'s slug-set check
(`apps/web/lib/wiki/lint-detectors.ts:159-207`), extracted to a shared
module. The editor gets the slug set from the server once per session.
Unresolved links are listed under the editor with their line numbers, and
saving shows the same message `wiki_lint` would. The rule is unchanged; the
author simply sees the result earlier.

**Preview.** A Write/Preview toggle on narrow screens and side by side on
wide ones. The preview renders with `WikiBodyRenderer`, the same component
the viewer uses, so the two cannot drift apart.

**Later extension.** After BI-A63A9476, typing `BI-`, `EP-` or `DOC-` offers
entity completion through the same endpoint.

**Acceptance (prose).** `[[` plus two characters lists matches within the
latency target, and Enter inserts a valid link. Dangling links are flagged
before save using the lint rule. The preview matches the published viewer.
The UX-fit review is recorded.

---

## 8. Vault export (BI-5412E422)

**What it does.** A person exports one scope as a zip that opens in Obsidian
as a vault, with no plugins needed.

**Who may export, and how much (R6):**

- A person starts each export from the portal. The `knowledge_export`
  capability is required, and no other grant implies it. This epic adds no
  MCP export tool, so coworkers cannot export (R6).
- Each run covers exactly one scope:
  - **Organization**: overlay and override pages, plus documents the caller
    can read.
  - **Profession**: WSID pages for the selected `professionKey`s.
  - **Platform**: kernel pages, limited to principles with
    `principlePublic = true` plus non-principle pages.

  Combining scopes takes separate runs. That way a regulated customer's
  organization knowledge is never bundled with platform doctrine by accident.
- Every page and document passes `canReadEntity` for the caller. A restricted
  document the caller cannot read is left out of the zip and counted in the
  audit record only.
- Before the download starts, the audit record is written through
  `logComplianceAction` (`lib/actions/compliance-helpers.ts`,
  `ComplianceAuditLog`). Its actor column is an `EmployeeProfile` key, so the
  exporter's principal id, scope, counts and the SHA-256 of the zip go into
  the record's JSON value. If the principal cannot be identified, the export
  is refused.
- Restricted documents need real enforcement, so export depends on
  BI-957915CB (enforced document permissions).

**Format.**

```
<scope>-vault-<yyyy-mm-dd>/
  README.md                  what this is, scope, export time, caller
  wiki/<pageKind>/<last-slug-segment>.md
  documents/<DOC-id>-<slug>.md
  attachments/               non-markdown document renditions
```

**Frontmatter.** Every file starts with YAML frontmatter, which Obsidian
reads as Properties. The fields are:

- `dpf_id`, `dpf_scope`, `title`;
- `aliases`: the full slug, plus the legacy `KA-` id where one exists;
- `tags`, `page_kind`, `status`;
- the principle fields (`principle_tier`, `principle_applies_to`, …) as typed
  values;
- for documents: `document_id`, `version`, `document_kind` and
  `classification`.

**Links.** Obsidian resolves links by file name, so `[[slug|label]]` is
rewritten to `[[<last-slug-segment>|label]]`. The exporter adds a numeric
suffix when two pages share a last segment and uses the suffixed name in
every link to them. Ids and links to anything outside the export become plain
text, because a link to something absent would reveal that it exists. Raw
source citations become ordinary markdown links to their URLs.

**Zip library.** `fflate` (MIT) is already a dependency of `@dpf/db`
(`packages/db/package.json`). Reuse it. If the web app needs it directly, pin
the same version.

**Round trip.** A parse test reads every exported file back and checks that
the frontmatter equals the typed fields.

**Out of scope.** Import and two-way sync, which need a separate decision.
Backlog export, which `backlog:capture` already covers.

**Acceptance (prose).** The folder opens in Obsidian with working links,
backlinks and properties. Frontmatter round-trips with no loss. Export of a
restricted document by an unauthorized principal is refused. Every export is
audited.

---

## 9. Quick switcher (BI-359C7C2F)

**Surface.** Ctrl+K or Cmd+K anywhere in the shell opens a centred dialog
built on the shared `Combobox` (§3.5), following the APG
combobox-in-dialog pattern. Escape closes it and returns focus to where it
was. The handler is mounted once in `app/(shell)/layout.tsx`. It ignores the
shortcut while focus is in a textarea or contenteditable that uses Ctrl+K
itself. It is a switcher only and runs no commands.

**Exact id.** Input that matches an id pattern (`BI-`, `EP-`, `DOC-`, `KA-`,
`WC-`) resolves that single entity. Enter opens it when the reader can open
it. Otherwise the dialog says "No match", the same message as for an id that
does not exist (R1).

**Search.** Any other input calls `GET /api/switcher?q=` and returns up to 12
rows across backlog items, epics, wiki pages, documents and Workrooms.

- Ranking: `pg_trgm` similarity on titles first, then a title-prefix bonus,
  then how recently the entity was updated.
- No route-visit tracking exists. Instead, the dialog keeps a per-browser list
  of the last 20 opened ids, stored only as ids (never titles or bodies),
  keyed by principal and cleared on sign-out. The server re-checks those ids
  every time the dialog opens. While the input is empty, they are shown
  first.
- Each kind is queried only if the reader holds that kind's grant, and every
  row passes `canReadEntity`.
- Rows show the title, kind and scope badge.

Target: under 300 ms at the 95th percentile on the dev install.

**Agents.** The switcher is not an MCP tool. Agents already have scoped
search tools, and a cross-kind finder for agents would be a new broad read
path (R5).

**Order.** `search_knowledge` fails 71% of calls today
(BI-MCP-EFF-4F823E5B). The switcher does not call it, so this is not a
technical dependency. It is an ordering preference: search reliability comes
first. The switcher does depend on BI-825D3487 for corpus grants and, for
`KA-` ids, on BI-67F04B3F.

**Acceptance (prose).** An exact id opens on one Enter. Title search meets
the latency target. No result reveals anything the reader cannot open. The
UX-fit review is recorded.

---

## 10. Research and standards

| Reference | What DPF adopts | What DPF rejects, and why |
|-----------|-----------------|---------------------------|
| **Obsidian** (backlinks, unlinked mentions, quick switcher, Properties, `[[wikilinks]]`) | Backlinks with a context snippet; unlinked mentions with one-click linking; the switcher; YAML frontmatter as Properties; file-over-app export | A single vault anyone can read: DPF links inside scopes (§2). Plugins, the global graph, daily notes and canvas are out of scope for this epic. |
| **Logseq** (linked and unlinked references) | References grouped by source | Block-level references: in DPF the page is the unit |
| **GitHub cross-references** (issue/PR autolinks, "mentioned this" events) | Ids become links automatically; references are derived from text rather than a separate action; references from places the reader cannot see are hidden completely | The timeline-event form: DPF shows a list |
| **Notion and Confluence backlinks** | Backlinks follow page permissions | Space-wide graphs that ignore which scope owns a page |
| **Linear and VS Code command palettes** | Ctrl/Cmd+K, jump by exact id, fully keyboard-driven | A palette that runs actions: deferred until the switcher has proven useful |

Standards: CommonMark and YAML 1.2 frontmatter; Obsidian Flavored Markdown
for link syntax; WAI-ARIA Authoring Practices 1.2 (combobox, listbox,
dialog); OWASP Top 10 A01:2021; OWASP Top 10 for LLM Applications 2025
(LLM02, LLM06); CWE-200.

---

## 11. Order and sizes

| Order | Item | Size | Why |
|-------|------|------|-----|
| Order | Item | Size | Why |
|-------|------|------|-----|
| 1 | BI-825D3487 corpus-scoped read grants | medium | The founder's scope-separation requirement; every read path checks these grants |
| 1 | BI-23900D0A link-write repair | small | Backlinks depend on correct rows |
| 1 | BI-MCP-EFF-4F823E5B | (owned separately) | Search reliability first (a preference) |
| 2 | BI-4EAFF7AC backlinks | medium | Builds the shared reader and `canReadEntities`, the session organization, the trigram index and the panel |
| 2 | BI-2F7BE778 editor | medium | Shared `Combobox`, suggestion endpoint, extracted resolver, preview |
| 3 | BI-A63A9476 references | medium | Parser, writer, edge ownership, rebuild, four surfaces |
| 3 | BI-67F04B3F absorption | large | Data migration, organization resolution, aliases, later retirement |
| 4 | BI-359C7C2F switcher | medium | Reuses `Combobox` and `canReadEntities`; `KA-` ids need absorption |
| 4 | BI-5412E422 export | medium | Needs BI-957915CB; simpler after absorption |

BI-4EAFF7AC builds the shared reader (§3.4), because it is the first item at
order 2. Every later item reuses it. The reader's document rule comes from
BI-957915CB.

## 12. Risks

| Risk | Mitigation |
|------|------------|
| A missed visibility check leaks a title or snippet | One reader (§3.4) for every feature. Each feature gets a contract test that plants an entity from another scope or an unreadable one and asserts it is absent, including from counts |
| The graph mirror becomes a second read path | Nodes and edges for gated kinds hold no titles or snippets (§3.2); the admin explorer excludes gated labels and `REFERENCES` unless it reads through the shared reader |
| Linking agents read text planted by less privileged writers (indirect prompt injection) | MCP `referencedBy` carries no snippets; edges record `writtenBy` (§5) |
| Documents still readable on paths outside this epic | BI-957915CB enforces document permissions on `doc_load`, `doc_search` and the document page; until it lands, the reader hides non-`organization` documents |
| Rebuild jobs wipe edges they do not own | Ownership marker and type-restricted wipes (§3.3) |
| Reference edges drift from the bodies | Idempotent writer, weekly rebuild, counted reconcile |
| Absorption loses article history or widens visibility | Revisions copied with their version numbers; ambiguous organization held, never guessed; `team` articles held as drafts; a mapping check guards the drop; steward review |
| Export becomes an exfiltration channel | Started by a person only, separate capability, one scope per run, principal-identified audit with a digest (R6) |
| Corpus grants change how agents behave | All three are held by default, so nothing changes until an organization narrows a coworker |
