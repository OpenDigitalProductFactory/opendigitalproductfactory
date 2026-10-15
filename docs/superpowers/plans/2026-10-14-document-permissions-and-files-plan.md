---
status: draft
---

# Documents workspace: enforced permissions, upload and collections — implementation plan

- **Backlog item:** `BI-957915CB`
- **Epic:** `EP-8DC217EB`
- **Design:** [2026-10-14-document-permissions-and-files-design.md](../specs/2026-10-14-document-permissions-and-files-design.md)

> **For agentic workers:** one BI, one branch per PR. Use `dpf-tdd` red-green for each phase: the isolation test is written and seen failing before the enforcement it proves. Run the pregate before push and use `dpf-pr-with-dco` for handoff.

## Backlog coverage

- Parent: `BI-957915CB`
- Decision: atomic
- Delivery: two PRs in order. PR 1 (`feat/document-permissions-and-files`) closes the security gap; PR 2 (`feat/document-permissions-and-files-2`) adds upload and collections on top of the enforced store.
- Baseline: the spec-approval baseline minted from the design's objective and acceptance markers
- Receipt: blocked-by: record_plan_backlog_coverage binds the immutable blob of this exact file, so the receipt is minted after this commit is pushed and is held in the live backlog against BI-957915CB
- Rationale: upload and collections are only safe once the store enforces access, and both read through the same viewer clause, so they are one deliverable shipped in a dependency order rather than separate items.
- Dependencies: none open. The document store, renditions and previews are on main.

### Traceability

| Deliverable | Objectives | Contracts | Flow | Acceptance |
|---|---|---|---|---|
| document-permissions-and-files (`BI-957915CB`, phases 1–4) | OBJ-DOC-ACCESS, OBJ-DOC-UPLOAD, OBJ-DOC-COLLECTION | `apps/web/lib/documents/document-access.ts`, `apps/web/lib/documents/document-store.ts`, `apps/web/lib/mcp/packs/document-pack.ts` | A member uploads a file into a collection, it gets renditions and search, and only grantees can read it | AC-DPF-1, AC-DPF-2, AC-DPF-3, AC-DPF-4, AC-DPF-5 |

## Phase 1 — The access rule (PR 1)

- `apps/web/lib/documents/document-access.ts`: `DocumentViewer`, `resolveDocumentViewer`, `readableDocumentWhere`, and `canManageDocumentAccess` for scope and owner changes.
- **Tests first** (`document-access.test.ts`): organization scope readable by anyone, including a viewer with no principal; restricted readable by owner, creator and an unexpired grantee; refused for an expired grant, a grant to someone else, and an unknown scope.

## Phase 2 — Every read and write path (PR 1)

- `apps/web/lib/documents/document-store.ts`: a required `viewer` on `loadManagedDocument`, `searchManagedDocuments`, `listManagedDocumentVersions`, `listManagedDocumentReferences`, `changeManagedDocumentState` and `linkManagedDocuments`; an optional `viewer` on `saveManagedDocument` for existing documents; scope and owner preserved on a new version.
- `document-content.ts`, `document-previews.ts` and `document-office-export.ts` take the viewer and apply the clause before reading blobs.
- The two API routes and the two pages resolve the viewer from the session.
- `apps/web/lib/mcp/packs/document-pack.ts` resolves the viewer from the acting user for every `doc_*` tool and for `create_presentation` document references.
- **Tests first** (`document-isolation.test.ts`, one in-memory store with an owner, a grantee, an expired grantee and a stranger): every path in the design's enforcement table, refused for the stranger and served to the others, including `doc_search` with semantic and full-text hits that nominate a restricted document.

## Phase 3 — Upload (PR 2)

- `POST /api/documents` (multipart): session required, the 20 MB binary limit, supported formats only; stores the blob and saves the document with the uploader as owner and creator.
- A drop zone and file picker on `/workspace/documents` with progress, error and success states, built from theme tokens.
- **Tests first:** the route refuses no session, an empty file, an oversized file and an unsupported format; a .docx and a .pdf upload save a managed document whose version requests renditions.

## Phase 4 — Collections (PR 2)

- A collection is a `Document` of kind `collection`; membership is a `contains` `DocumentReference`.
- The documents page lists collections, filters by `?collection=`, creates a collection, and files an uploaded document into the current collection.
- **Tests first:** collection listing goes through the viewer clause, so a restricted member and a restricted collection are absent for a stranger and present for a grantee.
- UX fit review (`dpf-ux-fit-review`) in light and dark themes and at phone width; the documents user guide covers upload, collections and restricted documents.
