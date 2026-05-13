# Document Management Capability

| Field | Value |
|---|---|
| Status | Draft for review |
| Date | 2026-05-12 |
| Depends on | `docs/superpowers/drafts/2026-05-12-agent-workspace-pattern.md` |
| Scope | Minimum managed document store for AI coworker document workspaces |
| Non-goal | Implementing the capability in this PR |

## 1. Problem

The agent workspace pattern needs a durable place for coworker outputs to land. A workspace file is useful scratch, and a git-tracked spec is useful source code review material, but neither is a managed document:

- References break when files move, branches are rebased, or a document is revised.
- Lifecycle is implicit in path names and PR status, not queryable state.
- Search is fragmented across repo grep, Qdrant memory, and wiki search.
- Version history is tied to git when the document happens to live in git, and absent when it does not.
- Ownership, access, and governance metadata cannot be queried consistently.
- Backup is split across Postgres, local files, git checkouts, and vector stores.

This capability provides Documentum-class semantics in a DPF-light implementation: Postgres is authoritative, local/blob storage holds large payloads, Qdrant provides semantic retrieval, and Neo4j remains a projection for traversal. No new infrastructure is introduced.

## 2. Current DPF Audit

Line references were checked on `origin/main` at `a05cbcce` in branch `doc/document-management-capability`.

| Surface | Existing implementation | Reuse / decision |
|---|---|---|
| Principal identity | `Principal` starts at `packages/db/prisma/schema.prisma:219`; `PrincipalAlias` starts at `packages/db/prisma/schema.prisma:236`. | Documents must use `Principal.id` for owner/creator/access grants. Do not add `ownerType` strings. |
| Organization identity | `Organization` starts at `packages/db/prisma/schema.prisma:2189`. | Every document is scoped to an `organizationId`; platform/kernel docs can use nullable org only if explicitly needed later. |
| Tool audit | `ToolExecution` starts at `packages/db/prisma/schema.prisma:3227`; governed writes are recorded by `apps/web/lib/mcp-governed-execute.ts:167`. | MCP calls use existing tool audit. Do not add a second tool audit table. |
| Thread attachments | `AgentAttachment` starts at `packages/db/prisma/schema.prisma:3306`; `handleFileUpload()` writes `threadId/randomUUID.ext` files at `apps/web/lib/shared/file-upload.ts:35` and `:57`. | Reuse storage configuration, not the table. Attachments are thread scratch and not content-addressed documents. |
| Knowledge articles | `KnowledgeArticle` starts at `packages/db/prisma/schema.prisma:6623`; revisions start at `:6651`. | Pattern for body + revision history, but not general document management. Live DB check returned 0 rows. |
| Wiki pages | `WikiPage` starts at `packages/db/prisma/schema.prisma:6721`; links start at `:6773`. | Keep wiki as curated knowledge. It is not the durable output store for every coworker artifact. Live DB check returned 0 rows. |
| Prompt templates | `PromptTemplate` starts at `packages/db/prisma/schema.prisma:7034`; prompt revisions start at `:7058`. | Useful versioning precedent, but prompt-specific. |
| Qdrant | Existing collections include `platform-knowledge` and `wiki-pages` in `packages/db/src/qdrant.ts:4`; collection creation starts at `:45`; vector upsert/search helpers start at `:121` and `:144`. | Add a `documents` collection inside the existing Qdrant service. This is not new infrastructure. |
| Wiki embeddings | `storeWikiPage()` starts at `apps/web/lib/wiki/embeddings.ts:79`; `searchWikiPages()` starts at `:139`. | Reuse the payload-index and two-stage search pattern, but with document lifecycle/access filters. |
| Embedding model | `generateEmbedding()` starts at `apps/web/lib/inference/embedding.ts:21`. | Reuse the existing embedding path and its failure-tolerant behavior. |
| Neo4j | `packages/db/src/neo4j.ts:2` says Postgres/Prisma is the source of truth; `packages/db/src/neo4j-sync.ts:2` describes fire-and-forget projections. | `DocumentReference` lives in Postgres. Neo4j receives projected doc-reference edges only. |
| MCP registry | `ToolDefinition` starts at `apps/web/lib/mcp-tools.ts:81`; `PLATFORM_TOOLS` starts at `:214`; `wiki_query` is defined at `:1975` and executed at `:8488`. | Add document tools to this registry and execution switch. |
| MCP external endpoint | Token filtering starts at `apps/web/app/api/mcp/v1/route.ts:192`; tool list/call handlers start at `:237` and `:249`. | The document tools automatically surface to external agents through `/api/mcp/v1` once registered and granted. |
| Agent grants | `TOOL_TO_GRANTS` starts at `apps/web/lib/tak/agent-grants.ts:11`; missing mappings are denied by default at `:283`; `getToolGrantMapping()` starts at `:306`. | Every `doc_*` tool needs an explicit mapping before it can be used. |
| Postgres full text | CRM migration adds `tsvector` columns and GIN indexes at `packages/db/prisma/migrations/20260320020000_crm_foundation_contact_account_extensions/migration.sql:89`. | Follow that raw-SQL pattern for document search vectors. |

Live database check against `dpf-postgres-1` returned zero rows for `KnowledgeArticle`, `WikiPage`, `RawSource`, and `AgentAttachment`, so this spec does not need a data backfill for those tables. It still treats their schema as implementation precedent.

## 3. Research & Benchmarking

AGENTS.md requires feature specs to benchmark real systems. The pattern here is: adopt the durable semantic primitives, reject the heavyweight surface area.

| System | Observed model | Adopt | Reject / defer |
|---|---|---|---|
| [OpenText Documentum DFC `IDfSysObject`](https://opentext.github.io/d2sv-sdk/24.2.0/dfc/com/documentum/fc/client/IDfSysObject.html) | A sysobject exposes content, creation/modify metadata, owner/permissions, full-text flag, version tree (`getVersions`), lifecycle policy/current state, promotion, and renditions. | Separate document identity from versions; make lifecycle state queryable; model owner/access; support renditions as version-bound artifacts. | Checkout/lock semantics, virtual documents, alias sets, rich business policies, e-signatures, and records retention in V1. |
| [Notion blocks](https://developers.notion.com/reference/block) and [page content](https://developers.notion.com/guides/data-apis/working-with-page-content) | Page content is a tree of typed blocks; nested content must be fetched recursively and can require async processing. | Keep structured metadata around content and allow future block/rendition extraction. | Do not store DPF documents as opaque block trees in V1. Markdown/plain text is easier for agents, diffs, and backup. |
| [Outline OpenAPI](https://raw.githubusercontent.com/outline/openapi/main/spec3.yml) | Documents are Markdown pages, grouped by collections, with policies, events, attachments, exports, and revision snapshots. | Use Markdown-first documents, explicit collection/workspace metadata, version list/load tools, and audit/event trails. | Do not copy Outline's full collaboration, comments, stars, or template surface. |
| [MediaWiki page/revision/content/slots](https://www.mediawiki.org/wiki/Manual:Page_table) | `page` is stable identity, `revision` records every edit, and `content` can address blobs separately. Slots allow multi-content revisions. | Stable document row + immutable version rows + blob indirection. This is the cleanest precedent for references surviving moves. | Multi-slot revision semantics are too much for V1. A single source content plus optional renditions is enough. |
| [Alfresco Content Services](https://docs.alfresco.com/content-services/7.1/develop/repo-ext-points/content-model/) | Nodes have types, aspects, properties, and associations; `versionable` and `auditable` are aspects; search covers both text content and metadata. | Use simple document kind, tags, access metadata, versioning, audit, and references/associations. | Do not introduce a dynamic content-model/aspect system or a separate search service. |

**DPF gap filled:** these systems combine durable document identity, revision history, lifecycle, search, references, and access, but they either assume a full ECM platform or a human wiki/editor product. DPF needs a smaller platform primitive that AI coworkers can call through governed MCP tools, with Postgres as the source of truth and existing Qdrant/Neo4j as projections.

## 4. Design Principles

1. **Postgres is authoritative.** Document identity, versions, lifecycle, tags, references, access grants, and lifecycle events live in Postgres.
2. **Content addressability for payloads.** Text under the limit can live in Postgres; binary and large payloads live in a content-addressed blob path with a hash in Postgres.
3. **References target stable document IDs.** Paths and URLs are locators, not identities. Managed documents get stable IDs so references survive moves and renames.
4. **Search is composed, not magic.** Metadata filters are hard filters; full-text and semantic search produce ranked candidates; references are a graph filter or secondary traversal.
5. **Governed agent access.** MCP tool grants and per-document access both apply. A tool grant alone does not bypass a document's org/access rules.
6. **Minimal lifecycle.** Use `draft`, `published`, and `archived` in V1. Review is a workflow over a draft, not a required persistent state.
7. **No Documentum clone.** Locks, virtual documents, records schedules, complex rendition pipelines, e-signatures, and compound assembly are extension points, not V1.

## 5. Data Model

This is the proposed Prisma shape. Field names can be adjusted during implementation, but the semantics should hold.

```prisma
model Document {
  id                 String   @id @default(cuid())
  documentId         String   @unique // Human-stable: DOC-...
  organizationId     String
  ownerPrincipalId   String?  // Principal.id
  title              String
  slug               String?
  documentKind       String   // brief | policy | plan | spec | audit | asset | external-ref | other
  contentFormat      String   // markdown | plain-text | html | pdf | image | binary | external-ref
  sourceKind         String   @default("managed") // managed | external
  externalLocator    Json?
  currentVersionId   String?
  currentState       String   @default("draft") // draft | published | archived
  accessScope        String   @default("organization") // private | organization | public-link
  classification     String?  // public | internal | confidential | restricted
  semanticIndexedAt  DateTime?
  fullTextIndexedAt  DateTime?
  archivedAt         DateTime?
  createdByPrincipalId String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}

model DocumentVersion {
  id                   String   @id @default(cuid())
  documentId            String
  version               Int
  title                 String
  contentText           String?  @db.Text
  contentBlobId         String?
  contentHash           String?
  contentSizeBytes      Int?
  summary               String?  @db.Text
  changeSummary         String?
  externalVersionLocator Json?
  createdByPrincipalId  String?
  createdAt             DateTime @default(now())

  @@unique([documentId, version])
  @@index([documentId])
  @@index([createdByPrincipalId])
}

model DocumentBlob {
  id              String   @id @default(cuid())
  sha256          String   @unique
  storageBackend  String   @default("local")
  storageKey      String   @unique
  mimeType        String
  sizeBytes       Int
  createdAt       DateTime @default(now())
}

model DocumentReference {
  id                   String   @id @default(cuid())
  sourceDocumentId      String
  sourceVersionId       String?
  targetDocumentId      String?
  targetVersionId       String?
  targetExternalLocator Json?
  refType               String   // cites | depends-on | supersedes | derives-from | mentions | related
  anchor                Json?
  createdByPrincipalId  String?
  createdAt             DateTime @default(now())

  @@index([sourceDocumentId])
  @@index([targetDocumentId])
  @@index([refType])
}

model DocumentTag {
  documentId String
  tag        String

  @@id([documentId, tag])
  @@index([tag])
}

model DocumentAccessGrant {
  id                  String   @id @default(cuid())
  documentId           String
  principalId          String?  // Principal.id; null means grant is not principal-specific
  grantKind            String   // owner | reader | editor | approver
  createdByPrincipalId String?
  createdAt            DateTime @default(now())

  @@index([documentId])
  @@index([principalId])
}

model DocumentLifecycleEvent {
  id                  String   @id @default(cuid())
  documentId           String
  fromState            String?
  toState              String
  eventType            String   // created | version-saved | published | archived | restored
  reason               String?  @db.Text
  toolExecutionId      String?
  actorPrincipalId     String?
  createdAt            DateTime @default(now())

  @@index([documentId])
  @@index([toolExecutionId])
  @@index([actorPrincipalId])
}

model DocumentRendition {
  id                String   @id @default(cuid())
  documentVersionId String
  renditionKind     String   // extracted-text | preview-pdf | thumbnail | html-preview
  blobId            String?
  contentText       String?  @db.Text
  mimeType          String?
  status            String   @default("ready") // pending | ready | failed
  createdAt         DateTime @default(now())

  @@index([documentVersionId])
  @@index([renditionKind])
}
```

### 5.1 Identity And Ownership

`Document.organizationId` references `Organization.id`, and `ownerPrincipalId`, `createdByPrincipalId`, and `actorPrincipalId` reference `Principal.id`. This follows the principal convergence rule in AGENTS.md and avoids a polymorphic `ownerType`.

Human and AI authorship is resolved through `PrincipalAlias`. If a UI needs to show "Mark" or "Brand coworker", it resolves the principal and aliases rather than storing parallel user/agent columns on each document row.

### 5.2 Stable References Across Repos

For new coworker outputs, `doc_save` creates managed `Document` rows. References point at `Document.documentId`, not filesystem path.

For repo files that should be cited but not imported, `doc_save` can create an `external-ref` document stub with `sourceKind = "external"` and an `externalLocator` such as:

```json
{
  "kind": "git",
  "repo": "OpenDigitalProductFactory/opendigitalproductfactory",
  "path": "docs/superpowers/specs/example.md",
  "commit": "a05cbcce",
  "sha256": "..."
}
```

The reference still targets a stable `Document` row. If the file later moves, only the locator changes; inbound references do not.

## 6. Storage Tier

Use a split model:

| Payload | Storage | Reason |
|---|---|---|
| Markdown/plain/html under 10 MB | `DocumentVersion.contentText` plus `contentHash` | Fast load, transactionally backed up by Postgres, easy full-text indexing. |
| PDF, images, binary, or text over 10 MB | `DocumentBlob` with content-addressed local storage | Avoids bloating Postgres and supports future S3/Azure without changing document identity. |
| Extracted text / previews / thumbnails | `DocumentRendition` | Lets search use extracted text from PDFs without making the original PDF mutable. |

The blob root should reuse the existing upload storage configuration path from `PlatformConfig.upload_storage_path` (`apps/web/lib/shared/file-upload.ts:20`) or the same environment fallback, but under a separate `documents/` prefix:

```text
<upload_storage_path>/documents/sha256/ab/cd/<full-sha256>
```

Do not reuse `AgentAttachment`. It is thread-scoped scratch storage and its keys are random, not content-addressed.

## 7. Search And Reference Graph

### 7.1 Full-Text Search

Add a raw SQL migration pattern like the CRM search migration at `packages/db/prisma/migrations/20260320020000_crm_foundation_contact_account_extensions/migration.sql:89`:

- `Document.searchVector` generated from title, tags, current version text, and extracted text rendition.
- GIN index on `Document.searchVector`.
- Trigger or generated-column function to update when title/current version changes.

If Prisma cannot model `tsvector` cleanly, keep it in migration SQL and expose search through a typed helper using `$queryRaw`.

### 7.2 Semantic Search

Add `DOCUMENTS: "documents"` to `QDRANT_COLLECTIONS` in `packages/db/src/qdrant.ts`. Payload indexes:

- `documentId`
- `versionId`
- `organizationId`
- `currentState`
- `documentKind`
- `contentFormat`
- `ownerPrincipalId`
- `classification`
- `tags`

Default V1 semantic search indexes the current version only. Historical versions remain loadable through `doc_version_list` and `doc_load(version)`, but are not in default semantic search until a follow-up adds version search.

### 7.3 Metadata Filters

Metadata filters are normal Prisma filters over `Document`, `DocumentTag`, and `DocumentAccessGrant`.

Default filters:

- `organizationId = caller.organizationId`
- `currentState = "published"` unless caller asks for drafts and has `document_write` or owner/editor access
- document access scope/grant permits caller principal

### 7.4 Composition Model

`doc_search` accepts:

```json
{
  "query": "licensing coworker brief",
  "mode": "hybrid",
  "filters": {
    "documentKind": ["brief", "policy"],
    "state": ["draft"],
    "ownerPrincipalId": "..."
  },
  "reference": {
    "citesDocumentId": "DOC-123"
  },
  "limit": 10
}
```

Composition rules:

1. Metadata and access filters are hard `AND` filters.
2. Reference filters are hard graph filters when supplied.
3. In `hybrid` mode, full-text and semantic results are candidate sources combined by `OR`.
4. Candidate rows are merged by `documentId`.
5. Suggested initial score: `0.55 semantic + 0.35 fullText + 0.10 recency`, with exact rank tuning out of scope.
6. If embedding fails or Qdrant is stale, return full-text/metadata results with `semanticStatus: "unavailable"`.

### 7.5 Neo4j Projection

`DocumentReference` is authoritative in Postgres. Neo4j gets projected nodes and edges:

```cypher
(:Document {documentId})-[:DOC_REFERENCES {refType, sourceVersionId, targetVersionId}]->(:Document {documentId})
```

Projection failures follow the existing pattern in `packages/db/src/neo4j-sync.ts:2`: log and reconcile later, never make Neo4j the write authority.

## 8. Lifecycle

V1 states:

| State | Meaning | Why it exists |
|---|---|---|
| `draft` | Work exists but is not generally relied upon. | Coworkers need to save outputs before human review. |
| `published` | Current approved version for normal search and linking. | Users and coworkers need a stable default retrieval set. |
| `archived` | Retained but excluded from default search and write flows. | Documents need durable history without active use. |

`in-review` and `approved` are not V1 states. Review is an approval/work-queue concern around a draft; "approved but not published" has no current coworker flow that requires a separate persisted state. If a future regulated workflow needs that distinction, add `DocumentReviewRequest` or extend lifecycle states with evidence from that workflow.

State transitions write `DocumentLifecycleEvent` rows:

- `created`: null -> draft
- `version-saved`: draft -> draft or published -> draft, depending on whether edits require republish
- `published`: draft -> published
- `archived`: draft/published -> archived
- `restored`: archived -> draft

## 9. MCP Tool Surface

Tool definitions follow `apps/web/lib/mcp-tools.ts:81` and must be listed in `TOOL_TO_GRANTS` at `apps/web/lib/tak/agent-grants.ts:11`.

Recommended grant names:

- `document_read`
- `document_write`
- `document_publish`
- `document_admin`

| Tool | Mode | Grants | Purpose |
|---|---|---|---|
| `doc_save` | proposal for non-admin coworkers; immediate for trusted workflows | `document_write` | Create a document or save a new version. Accepts title, kind, format, content text/blob id, tags, references, access scope, summary. |
| `doc_load` | immediate | `document_read` | Load current or specified version, subject to access/lifecycle filters. |
| `doc_search` | immediate | `document_read` | Hybrid search across metadata, full-text, semantic, and optional graph filters. |
| `doc_link` | proposal or immediate depending on route | `document_write` | Add/update a `DocumentReference` edge. |
| `doc_version_list` | immediate | `document_read` | Return version metadata and change summaries. |
| `doc_state_change` | proposal for publish/archive, immediate only for admin tools | `document_publish` | Transition lifecycle state and record event. |
| `doc_list_references` | immediate | `document_read` | Return inbound/outbound references from Postgres, with optional Neo4j traversal later. |

All tools must:

- Resolve the caller's `organizationId` and principal.
- Enforce MCP token grants through `/api/mcp/v1`.
- Enforce document access grants.
- Record the tool call in `ToolExecution`.
- Return stable `documentId` and `versionId`, never filesystem paths as identity.

## 10. UX Surface

The previous work did not make documents visible in the portal. This spec requires an explicit UX surface before the feature can be considered implemented.

Minimum product surface:

| Route / surface | Purpose |
|---|---|
| `/workspace/documents` | Searchable document library with status tabs, kind filters, owner filter, tags, and recently updated documents. |
| `/workspace/documents/[documentId]` | Document detail: rendered content or preview, lifecycle badge, owner/access panel, current references, version timeline, and "used by" backlinks. |
| Coworker chat artifact chips | When a coworker saves a brief/policy/plan, the message shows a linked document artifact with state and version. |
| Document workspace handoff | The agent workspace draft screen has a "Save to document library" action backed by `doc_save`. |
| Authority/audit link | Document state changes link back to the `ToolExecution` row where applicable. |

UI standards:

- Use theme tokens from AGENTS.md section 12; no hardcoded colors.
- Do not bury this under Admin. Admin configures retention/access defaults; users and coworkers work in the document library.
- The first screen is the document library, not a marketing/help page.
- The document detail page should feel like an operational tool: dense metadata, clear state, version/reference panels, and minimal decoration.

UX acceptance for implementation:

- A user can see a coworker-saved document in `/workspace/documents`.
- Search by phrase, concept, tag, owner, and state returns the document.
- Opening a document shows current version, version history, lifecycle state, and inbound/outbound references.
- Publishing or archiving changes the visible state and creates a lifecycle event.

## 11. Governance, Audit, And Mutation Atomicity

### 11.1 Audit

No new generic audit table is needed.

- MCP tool executions continue to land in `ToolExecution`.
- Domain lifecycle transitions additionally write `DocumentLifecycleEvent`.
- `DocumentLifecycleEvent.toolExecutionId` links a lifecycle event to the MCP/tool audit row when the transition came from a tool.

### 11.2 Atomicity

The Postgres transaction for `doc_save` covers:

1. `Document` create/update.
2. `DocumentVersion` insert.
3. `Document.currentVersionId` update.
4. `DocumentTag` replacement.
5. `DocumentReference` replacement/addition.
6. `DocumentLifecycleEvent` if state changes.

Blob write ordering:

1. Compute hash and write blob to a temp path.
2. Rename temp path to content-addressed path.
3. Commit Postgres row referencing the hash.
4. If commit fails, temp file cleanup is best effort. Content-addressed orphan cleanup can safely delete unreferenced blobs later.

Qdrant and Neo4j updates happen after commit. They are projections. If either fails, the document remains saved and searchable by metadata/full-text, with `semanticIndexedAt` null or stale until reindexed.

## 12. Migration Strategy

Pick option (a): existing `docs/superpowers/specs/*.md`, `docs/superpowers/audits/*.md`, and related repo markdown stay as-is.

Justification:

- They are source-controlled design artifacts and already benefit from PR review.
- Importing git history into document versions is a larger migration with ambiguous authorship mapping and duplicate source-of-truth risk.
- The immediate blocker is new coworker outputs, not retroactive import of historical specs.
- Stable references to repo docs can be handled through `external-ref` document stubs when needed.

Follow-up option: build an importer that creates `external-ref` stubs first, then optionally imports selected files with git history preserved as `DocumentVersion` rows. That should be a separate reviewed migration spec.

## 13. Backup And Restore

Coherent backup set:

1. Quiesce document writes or put the portal in maintenance mode.
2. Run `pg_dump -Fc` for Postgres. PostgreSQL documents `pg_dump` as a consistent database backup utility and recommends custom/directory archive formats for flexible restore.
3. Archive the document blob directory under `<upload_storage_path>/documents/`.
4. Create a Qdrant snapshot for the `documents` collection. Qdrant snapshots are tar archives containing collection data/configuration and are created with `POST /collections/{collection_name}/snapshots`.
5. Neo4j does not need to be in the coherent backup set for document management because it is a projection. On restore, rebuild document reference edges from Postgres `DocumentReference`.

Restore order:

1. Restore Postgres.
2. Restore/copy blob store files.
3. Restore the Qdrant `documents` snapshot, or rebuild it by re-embedding current document versions if the snapshot is missing.
4. Run the Neo4j document-reference projection rebuild.
5. Run a consistency check: every `DocumentVersion.contentBlobId` resolves to a blob, every current document has a current version, and every Qdrant point references an existing document/version.

## 14. Hive Contribution Stance

Managed documents are organization-local by default. Publishing a document in the organization library does not contribute it to the public hive, marketplace, or upstream repository.

If a coworker proposes a reusable artifact, contribution is a separate governed workflow:

- Export a selected `DocumentVersion` with provenance and license metadata.
- Record contribution intent through existing evidence/provenance tooling.
- Submit as a PR or marketplace contribution only after human approval.

This prevents a document workspace from silently leaking customer-specific drafts.

## 15. Open Questions

1. **Per-document ACL depth:** Is `DocumentAccessGrant` enough for V1, or do we need role/group grants tied to workforce teams before launch?
2. **Rendition generation:** Which renditions are required first: extracted text for PDF search, preview PDF for markdown, thumbnails for images, or HTML preview?
3. **Version labels:** Should versions be simple integers only, or do users need labels like `1.0`, `2.0`, `published`, and `current`?
4. **Review workflow:** Should review requests reuse an existing approval/work-queue model, or does document review need a first-class model later?
5. **Retention/legal hold:** Is archive enough for V1, or do licensing/policy workflows need retention locks before documents can store regulated artifacts?
6. **External-ref resolver:** How much effort should V1 spend keeping git-path locators fresh after repo moves?
7. **Semantic indexing job:** Should failed Qdrant updates be retried by an existing queue/inngest function or by a small document-specific repair command?
8. **UX placement:** Is `/workspace/documents` the final route, or should the library live under a broader `/knowledge/documents` IA once portal navigation is reviewed?

## 16. Implementation Slices

1. **Schema + storage helpers:** Add document models, content-addressed blob helper, and migration tests. No UI yet.
2. **MCP tools:** Add `doc_save`, `doc_load`, `doc_search`, `doc_link`, `doc_version_list`, `doc_state_change`, and `doc_list_references` with grant mappings and unit tests.
3. **Index projections:** Add Postgres full-text helpers, Qdrant `documents` collection/indexing, and Neo4j projection/rebuild command.
4. **UX surface:** Add `/workspace/documents`, detail/version/reference panels, and coworker artifact chips. Run production build and browser UX verification.
5. **Workspace integration:** Wire agent document workspaces to `doc_save` and show saved outputs in the library.

The feature is not complete until slice 4 has been rebuilt and exercised in the portal.
