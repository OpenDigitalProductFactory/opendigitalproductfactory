---
status: active
---

# EP-0237A305: Knowledge linking within governed scopes (Obsidian lessons)

| Field | Value |
|-------|-------|
| **Epic** | EP-0237A305 |
| **Items** | BI-23900D0A (link-write repair), BI-4EAFF7AC (backlinks), BI-A63A9476 (entity references), BI-67F04B3F (KnowledgeArticle absorption), BI-2F7BE778 (editor autocomplete and preview), BI-5412E422 (vault export), BI-359C7C2F (quick switcher) |
| **Precondition** | BI-MCP-EFF-4F823E5B (`search_knowledge` fails 71% of calls) is repaired before BI-359C7C2F ships |
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

BI-23900D0A is a bug fix. Its acceptance lives in its backlog body, and §4.1
here describes it.

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

**R4. Edges cross scopes in one direction only.** A WWWD record may reference
WWMD and WSID pages; that is normal, because an organization builds on
platform doctrine and craft. A WWMD kernel page never references an
organization's records, because it ships to every install. A WSID page never
references WWWD records. The writer refuses edges that break this, and lint
reports them. Each edge records its source and target scope, so a reader can
filter to links within one scope.

**R5. Agents see only the corpus their job needs.** Today every coworker
receives `registry_read`, which covers the knowledge base, the wiki and
portfolio context together (`COWORKER_READ_BASELINE_GRANTS` in
`apps/web/lib/tak/agent-grants.ts`). This epic adds three narrower read
grants: `wiki_kernel_read`, `wiki_org_read` and `wiki_profession_read`.
`registry_read` implies all three through the existing one-way
`GRANT_IMPLICATIONS` table, so no current coworker loses access. A regulated
install can then give a coworker only the corpus its role needs. Linking read
paths check the narrow grant for each entity's corpus. Defaults stay the same;
narrowing them is an organization decision (WWWD), not a platform one.

**R6. Export is the highest-risk path.** Export moves knowledge out of the
platform. It is started by a person, needs its own grant (`knowledge_export`,
which nothing implies and the coworker baseline does not include), covers one
scope per run, and is audited (§8).

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
| Knowledge article | none; absorbed into wiki pages (§6) | | |

Keys are the semantic ids people already write, so a mention resolves to a
key without a lookup table. Node props cache only what a reference row needs
to display (title, kind, status, scope). Authorization never reads them (R1).

### 3.3 Edge types

| `rel_type` | Meaning | Writer |
|------------|---------|--------|
| `LINKS_TO` | wiki `[[slug]]` link | existing `syncWikiPageLink`, now also called on commit (§4.1) |
| `REFERENCES` | an entity id in any body, or a `[[slug]]` in a non-wiki body | new reference writer (§5) |

`REFERENCES` props are `sourceScope`, `targetScope`, `sourceField` (`body`,
`description` or `message`), `snippet` (up to 160 characters around the first
mention) and `syncedAt`. Repeated mentions of one target from the same source
collapse into one edge, the same way `DOC_REFERENCES` handles them. The graph
module has no single-edge delete today; §5 adds
`replaceGraphEdgesFromSource(srcKey, relType, edges)` to `graph-sync.ts`.

### 3.4 One parser, one renderer, one reader

- **Parser.** One extractor in `packages/db/src/wiki-frontmatter.ts`, fixed by
  BI-23900D0A, understands `[[slug]]` and `[[slug|label]]`. The slug may
  contain `/`, as in `principles/no-assumptions`. A sibling function
  `extractEntityIds` recognises `\b(BI|EP|DOC|KA|WC)-[A-Z0-9-]+\b`. Both skip
  fenced code, inline code and URLs. The lint detector's private copy
  (`apps/web/lib/wiki/lint-detectors.ts:209-217`) is deleted in favour of the
  shared one.
- **Renderer.** A markdown-it inline rule `dpf_entity_ref`, registered next to
  the existing `dpf_wikilink` rule in `apps/web/lib/shared/markdown.ts`, so
  every `MarkdownHtml` surface gets it. The server resolves the readable ids
  in a body before rendering and passes them in as a set. Readable ids become
  links. All other ids stay plain text, so an unknown id and an unreadable id
  look the same (R1).
  `ownerSafeBuildText` in `components/build/BuildOperatorOverview.tsx` hides
  ids on purpose for owner-facing build text, and it stays as it is.
- **Reader.** `apps/web/lib/references/read-references.ts` exposes
  `listInbound(targetKey, reader)` and `listOutbound(sourceKey, reader)`. They
  read `graph_edge`, then filter each far end through
  `canReadEntity(reader, kind, key)`. That function dispatches to each
  entity's access rule:

  | Entity | Rule |
  |--------|------|
  | Wiki page | Organization scope (`organizationId IN (null, readerOrg)`), plus the corpus grant (R5) for agents |
  | Backlog item, epic | Backlog read capability, plus `BacklogItem.sensitivity` |
  | Workroom | Room admission |
  | Document | A new `canReadDocument`: organization scope as `document-store.ts` applies today, plus `accessScope`. Any scope other than `organization` needs a matching `DocumentAccessGrant` (the model exists, but no code reads it yet). |

  Every linking feature calls this reader. No feature queries edges and
  decides visibility on its own.

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

BI-23900D0A fixes the shared extractor, adds the kernel fallback, replaces a
page's out-links on commit, calls `syncWikiPageLink` on commit, and backfills.
BI-4EAFF7AC depends on it.

### 4.2 Panel

**Surface.** A "Linked from" panel on the wiki viewer
(`components/wiki/WikiPageViewer.tsx`, route `coworker-decisions/[...slug]`).
It sits below the body on narrow screens and in a right column on wide
screens. `BacklinkGroup` is moved out of
`components/decision-perspective/MaterialBacklinksPanel.tsx` into a shared
component with real links (today its chips are `<span>`s), and the material
panel keeps using it.

**Data.** Until BI-A63A9476 lands, the panel uses the existing
`wikiPageLink.findMany` helper in `material-backlinks.ts:353-374`, wrapped by
the shared reader's `canReadEntity`. After BI-A63A9476 it reads inbound
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
a new GIN trigram index on `WikiPage.body`, followed by a whole-word check in
code, and is capped at 20 rows.

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
- Workroom messages (append-only, so each is written once),
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
every body. A scheduled weekly reconcile, modelled on
`graph-projection-reconcile.ts`, does the same. Both can be re-run at any
time.

**Read surfaces.** All of these go through `listInbound`:

- a "Referenced by" section in the backlog item panel
  (`components/ops/BacklogPanel.tsx`; there is no separate item page) and on
  `EpicCard`;
- the document page (`workspace/documents/[documentId]`);
- the wiki panel (§4).

Each row shows the source entity, its kind, its scope and the snippet. The
MCP `get_backlog_item` response gains a `referencedBy` array under the same
filter, so agents see what people see and nothing more.

**Rendering.** The backlog item panel gains a read view of the body through
`MarkdownHtml`. `EpicCard` swaps its URL-splitting regex for `MarkdownHtml`.
Both, along with document and Workroom message views, pick up the
`dpf_entity_ref` rule.

**Corpus grants.** The narrow read grants from R5 ship here, because this is
the first item that reads across corpora.

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
become **WWWD overlay pages**, with `organizationId` set to the owning
organization and `isKernel = false`. They never become kernel or profession
pages.

**Current consumers** (all to be repointed):

- Routes: `app/(shell)/knowledge/*` and `portfolio/product/[id]/knowledge`.
- MCP tools in `lib/mcp/packs/knowledge-pack.ts`: `search_knowledge_base`,
  `create_knowledge_article`, `flag_stale_knowledge`.
- Libraries: `lib/actions/knowledge.ts`, `route-knowledge-pointers.ts`,
  `coworker-self-tasks.ts:448`, `product-operating-context-query*.ts`.
- `semantic-memory.ts`: `storeKnowledgeArticle` writes points
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
3. **Anchors.** Keep product and portfolio anchors in `metadata.anchors` and
   project them as `ANCHORED_TO` graph edges, so no join table is added. The
   product knowledge tab reads those edges.
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

**Retirement** (a later release, after the window): drop the four
`KnowledgeArticle*` models. A guard first checks that every row has a mapped
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

- The `knowledge_export` grant is required. Nothing implies it, and the
  coworker baseline does not include it. The MCP tool
  `export_knowledge_vault` checks the grant as well as the caller's identity.
  A coworker can export only if a person has deliberately granted it that
  right.
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
- The audit record is written through `logComplianceAction`
  (`lib/actions/compliance-helpers.ts`, `ComplianceAuditLog`) before the
  download starts. It holds the caller, the scope, the counts and the
  SHA-256 of the zip.

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

**Zip dependency.** The app has no zip library. Add one pinned
dependency with no native code and no transitive dependencies (preferred:
`fflate`, MIT). It goes through the normal dependency and supply-chain
review.

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
- No route-visit tracking exists, so the dialog instead keeps a per-browser
  list of the last 20 opened ids (ids only, never titles or bodies). Those
  ids are re-checked on the server every time the dialog opens, and shown
  first while the input is empty.
- Each kind is queried only if the reader holds that kind's grant, and every
  row passes `canReadEntity`.
- Rows show the title, kind and scope badge.

Target: under 300 ms at the 95th percentile on the dev install.

**Agents.** The switcher is not an MCP tool. Agents already have scoped
search tools, and a cross-kind finder for agents would be a new broad read
path (R5).

**Dependency.** `search_knowledge` fails 71% of calls today
(BI-MCP-EFF-4F823E5B). The switcher does not call it, but that failure is the
signal that search reliability must come first. The switcher ships after it.

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
| 1 | BI-MCP-EFF-4F823E5B | (owned separately) | Search reliability first |
| 1 | BI-23900D0A link-write repair | small | Backlinks depend on correct rows |
| 2 | BI-4EAFF7AC backlinks | small | The data exists; ships with the shared reader |
| 2 | BI-2F7BE778 editor | medium | Shared `Combobox`, suggest endpoint, extracted resolver, preview |
| 3 | BI-A63A9476 references | medium | Parser, writer, reader, rebuild, four surfaces, corpus grants |
| 3 | BI-67F04B3F absorption | large | Data migration, aliases, later retirement |
| 4 | BI-359C7C2F switcher | medium | Needs item 1 and reuses `Combobox` and `canReadEntity` |
| 4 | BI-5412E422 export | medium | Reuses `canReadEntity`; simpler after absorption |

`canReadEntity` (§3.4) is built by whichever of BI-4EAFF7AC, BI-2F7BE778 or
BI-A63A9476 reaches implementation first, and the others reuse it. Its
document rule (`canReadDocument`) belongs to BI-A63A9476, the first item that
shows documents.

## 12. Risks

| Risk | Mitigation |
|------|------------|
| A missed visibility check leaks a title or snippet | One reader (§3.4) for every feature. Each feature gets a contract test that plants an entity from another scope or an unreadable one and asserts it is absent, including from counts |
| `canReadDocument` makes documents stricter than today | It applies `accessScope` and grants that no code enforces yet. Roll it out first to the new read paths, then to the document page with a release note |
| Reference edges drift from the bodies | Idempotent writer, weekly reconcile, rebuild command |
| Absorption loses article history | Revisions are copied with their version numbers; a mapping check guards the drop; steward review |
| Export becomes an exfiltration channel | Separate grant, one scope per run, started by a person, audited with a digest (R6) |
| Narrow grants change how agents behave | `registry_read` implies all three, so nothing changes until an organization narrows a coworker |
