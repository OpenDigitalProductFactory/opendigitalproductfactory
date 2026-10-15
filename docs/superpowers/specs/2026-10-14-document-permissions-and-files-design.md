---
status: active
---

# Documents workspace: enforced permissions, upload and collections

- Backlog item: BI-957915CB (slice A3 of the integrated office suite roadmap, umbrella BI-E86EB427)
- Epic: EP-8DC217EB
- Roadmap: integrated office suite roadmap design (2026-10-14), flow F-OS-UPLOAD
- Date: 2026-10-14

## Problem

The managed document store models access, but nothing enforces it.

- `Document.accessScope` (`"organization"` by default, `"restricted"` on request) and `DocumentAccessGrant` (principal, grant kind, optional expiry) exist in the Prisma schema. A `git grep` on main at `f29ea81970d` finds no code that reads either one.
- Every read path resolves a document by its stable `documentId` alone. That covers:
  - the store functions in `apps/web/lib/documents/document-store.ts`: `loadManagedDocument`, `searchManagedDocuments`, `listManagedDocumentReferences` and `listManagedDocumentVersions`;
  - the file routes, through `resolveDocumentContent` (`document-content.ts`), `resolvePreviewImage` (`document-previews.ts`) and `exportDocumentVersion` (`document-office-export.ts`);
  - the MCP `doc_*` handlers in `apps/web/lib/mcp/packs/document-pack.ts`.
- So a "restricted" document is readable by every signed-in user and every coworker. That includes its bytes, its renditions, its preview images and its semantic search hits.
- A write path makes it worse. `saveManagedDocument` sets `accessScope: input.accessScope || "organization"` and makes the saver the owner on every new version. A coworker that appends a version without naming a scope therefore makes a restricted document public and takes ownership of it.

There is also no upload control on `/workspace/documents` and no way to group documents. A file can only enter the store through `doc_save` with base64 content.

## Objectives

- **OBJ-DOC-ACCESS:** A restricted document is readable only by its owner, its creator, or a principal holding an unexpired grant on it, on every read and write path; an organization document stays readable across the organization.
- **OBJ-DOC-UPLOAD:** A member uploads a file from the documents workspace and it becomes a managed document with renditions, search and previews, through the existing store.
- **OBJ-DOC-COLLECTION:** A member groups documents into collections built on the existing document models, and collection navigation shows only documents the viewer may read.

## Research & Benchmarking

| System | Access model | What DPF takes |
|---|---|---|
| Alfresco Content Services | Each node inherits site permissions by default; inheritance can be broken and explicit ACEs set per authority. Search results are filtered by ACL at query time (`permission evaluation` in Solr/DB), never after paging. | Filter in the query, not after it, so counts, pages and search hits never include an unreadable item. |
| SharePoint / OneDrive | Items inherit the library's permissions; "Stop inheriting" makes an item unique, readable by the owner and explicit grantees. A denied item answers "not found or you don't have access" without confirming existence. | An organization-visible default plus an opt-in restricted scope; refusals are indistinguishable from not-found. |
| Google Drive | Owner plus explicit shares (with optional expiry); "anyone in the organization" is a link-sharing level. Folders are items that hold references; a file can sit in a folder you can see and still be hidden from you. | Grant expiry is honoured; folder membership never implies read access to the member. |

Standard: NIST SP 800-162 attribute-based access control describes the evaluation used here (subject = viewer principal; object attributes = scope, owner, creator; environment = current time against grant expiry). Postgres row-level security was considered and rejected: the platform connects as one database role with no per-request principal, so RLS would be a platform-wide infrastructure change for one model.

## Design

### One authorization helper (PR 1)

`apps/web/lib/documents/document-access.ts` is the single home of the rule.

- **`DocumentViewer`** is `{ principalId: string | null }`. `principalId` is the relational `Principal.id`, which is the value `Document.ownerPrincipalId`, `Document.createdByPrincipalId` and `DocumentAccessGrant.principalId` reference.
- **`resolveDocumentViewer(userId)`** resolves a signed-in user through the read-only `user` alias lookup (`resolvePrincipalRecordIdForSessionIdentity`). It never creates a principal. An unknown user resolves to `{ principalId: null }`.
- **`readableDocumentWhere(viewer, now)`** returns a `Prisma.DocumentWhereInput`:
  - `accessScope = "organization"`; or, when the viewer has a principal,
  - `ownerPrincipalId = viewer`, `createdByPrincipalId = viewer`, or some `accessGrants` row for the viewer whose `expiresAt` is null or later than `now`.
- Any scope other than `"organization"` is treated as restricted, so an unknown scope fails closed.

Every store function that reads a document takes a required `viewer` and adds the clause to its own query:

| Path | Enforcement |
|---|---|
| `/workspace/documents` list and `doc_search` | `searchManagedDocuments` ANDs the clause into its `findMany`. Full-text and Qdrant semantic hits only nominate `documentId`s for that same query, so they cannot surface an unreadable document. |
| `/workspace/documents/[documentId]` and `doc_load` | `loadManagedDocument` uses `findFirst` with the clause; a refused read is `null`, which is not-found. |
| `GET /api/documents/[documentId]/content` (original, PDF rendition, export) | `resolveDocumentContent` and `exportDocumentVersion` take the viewer and apply the clause before reading any blob or rendition. |
| `GET /api/documents/[documentId]/previews/[page]` and the page's preview list | `resolvePreviewImage` applies the clause. |
| `doc_version_list`, `doc_list_references` | `listManagedDocumentVersions` and `listManagedDocumentReferences` refuse an unreadable document and drop referenced documents the viewer cannot read, so a restricted title does not leak through a reference. |
| `doc_save` on an existing document, `doc_state_change`, `doc_link`, the page's state actions | The write first requires read access to the document (and, for a link, to a managed target). |
| `create_presentation` revising a deck or embedding a stored image | The pack checks read access to the revised document and every referenced image document before generation runs. |

MCP calls resolve the viewer from the acting user, never from the coworker's own principal. A coworker therefore reads exactly what the person it acts for may read, and one person's restricted documents never reach another person through a shared coworker.

`saveManagedDocument` stops overwriting access on a new version. An existing document keeps its scope, owner and creator unless the caller passes a scope or owner explicitly. Changing either on a restricted document requires the viewer to be its owner or creator. A coworker that saves a restricted document on a person's behalf makes that person the owner, so the person can open what their coworker made.

Refusals are not-found everywhere (`notFound()` on the page, 404 on the routes, "Document not found." from the tools), so a refusal never confirms that a document exists.

### Upload (PR 2)

A drop zone and file picker on `/workspace/documents` posts multipart form data to `POST /api/documents`. The route:

- requires a signed-in session;
- accepts the store's existing binary limit (`DOCUMENT_BINARY_SAVE_LIMIT_BYTES`, 20 MB) and the formats the store already understands, namely office formats from `officeSourceExtension`, PDF, and plain text or markdown;
- stores a `DocumentBlob` with `storeDocumentBlob`;
- calls `saveManagedDocument` with the uploader as owner and creator, the chosen scope (organization by default) and an optional collection.

The existing rendition trigger, full-text projection, semantic index and previews then follow with no new code. The page redirects to the new document.

### Collections (PR 2)

Tags cannot express a folder. They are flat, lowercase-normalised (`normalizeTags`) and capped at 50 per document, and they carry no access of their own, so a tag cannot be named, nested or restricted.

Collections reuse the document models instead:

- A collection is a `Document` with `documentKind: "collection"`, `contentFormat: "text/markdown"` and its description as content.
- Membership is a `DocumentReference` with `refType: "contains"` from the collection to the member. A member can sit in several collections, and a collection can contain a collection.
- Navigation (`/workspace/documents?collection=DOC-…`) lists members through `searchManagedDocuments` with the viewer clause. An unreadable member is absent, as is an unreadable collection.

There is no new table, no migration and no new MCP tool. `doc_save` creates a collection and `doc_link` with `refType: "contains"` files a document in one.

### Not in scope

- A grant-management UI (who may read a restricted document). Grants are created by the owner through a follow-up; this slice enforces them.
- Neo4j document-graph projections, which carry document titles for graph queries. They are filed as a follow-up when enforcement reaches the graph read tools.
- Organization-to-organization isolation beyond the viewer rule. A user is not bound to an organization in the schema; a single install serves one organization.

## Acceptance

| ID | Objectives | Statement |
|---|---|---|
| AC-DPF-1 | OBJ-DOC-ACCESS | A restricted document is refused as not-found to a viewer with no owner, creator or grant match on the documents list, the document page, the content route (original, PDF and export), the preview route, doc_load, doc_search in metadata, full-text and semantic modes, doc_version_list and doc_list_references; reference listings omit it. |
| AC-DPF-2 | OBJ-DOC-ACCESS | The owner, the creator and a principal with an unexpired grant read the restricted document on the same paths; an expired grant does not; an organization document stays readable to every viewer. |
| AC-DPF-3 | OBJ-DOC-ACCESS | Appending a version, changing state, linking or revising a presentation requires read access; a version saved without an explicit scope keeps the document's scope and owner. |
| AC-DPF-4 | OBJ-DOC-UPLOAD | Uploading a .docx or .pdf through the documents page creates a managed document whose version requests renditions. |
| AC-DPF-5 | OBJ-DOC-COLLECTION | A collection lists only the member documents the viewer may read, and an unreadable collection is not listed. |
