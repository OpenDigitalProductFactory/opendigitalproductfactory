---
status: draft
---

# Integrated office suite: roadmap plan

Umbrella: **BI-E86EB427**. Design: [integrated office suite roadmap](../specs/2026-10-14-integrated-office-suite-roadmap-design.md). Decision: **DI-F6A12669BCB7** (`native-surfaces-selective-craft-engines`).

Prior work:
- [the office engine plan](2026-09-22-office-document-conversion-plan.md), delivered;
- [the native productivity plan](2026-10-11-native-productivity-artcraft-absorption-plan.md), parked; its children are reused here.

**For agentic workers:**
- One backlog item, one branch, one PR.
- Claim each slice with its shape.
- Write the test first (`dpf-tdd`).
- Run the local-CI gate before push.
- Verify live on the dev install after release.
- A gate that could not run is not a pass.
- A Craft crate never enters runtime without its qualification record (AC-OS-009).

## Deliverable graph and traceability

| Slice | Live item | Depends on | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- | --- | --- |
| SEC calendar feed token | BI-051A74CE | none | OBJ-OS-COMMS | `app/api/calendar/feed/[userId]/route.ts` | F-OS-FEED | AC-OS-007 |
| A4 render-family tools | BI-012487AA | S6 renderDocument | OBJ-OS-EDIT | `lib/documents/generation/spec.ts`; document MCP pack | F-OS-GENERATE | AC-OS-003 |
| B4 workbook authoring tools | BI-FE8DF004 | none | OBJ-OS-STRUCT | `lib/mcp/packs/workbooks-pack.ts`; `workbook-service.ts` | F-OS-TRACKER | AC-OS-006 |
| A3 files and permissions | BI-957915CB | none | OBJ-OS-EDIT | `knowledge-docs.prisma` DocumentAccessGrant; `document-store.ts` | F-OS-UPLOAD | AC-OS-002, AC-OS-010 |
| A1 editor and version fence | BI-8ACA3A2D | A3 | OBJ-OS-EDIT | `document-store.ts`; document page | F-OS-EDIT | AC-OS-001, AC-OS-010 |
| A2 document comments | BI-FC8C8635 | A1 | OBJ-OS-EDIT | WorkItemMessage and mention plumbing | F-OS-REVIEW | AC-OS-001 |
| B1 workbook automations | BI-75225116 | B4 | OBJ-OS-STRUCT | Workbook* models; job engine | F-OS-AUTOMATE | AC-OS-004 |
| B3 forms | BI-F5E988C6 | B1 | OBJ-OS-STRUCT | DynamicForm; WorkbookRow | F-OS-FORM | AC-OS-005 |
| B2 timeline view | BI-A2003F34 | none | OBJ-OS-STRUCT | WorkbookView; column types | F-OS-TIMELINE | AC-OS-005 |
| B5 GridCraft formula qualification | BI-4F1E55E9 | none | OBJ-OS-ABSORB, OBJ-OS-STRUCT | `lib/workbooks/formula/` | F-OS-QUALIFY | AC-OS-009, AC-OS-010 |
| P-Q PdfCraft qualification | BI-5D5AB47E | none | OBJ-OS-ABSORB | `Dockerfile.doctools`; `tools/doctools/` | F-OS-QUALIFY | AC-OS-009, AC-OS-010 |
| P PDF packet operations | BI-3F319D83 | BI-5D5AB47E, A1 fence | OBJ-OS-EDIT, OBJ-OS-ABSORB | `document-store.ts`; `conversion/command.ts` | F-OS-PDF | AC-OS-001, AC-OS-009 |
| H artifact handoff | BI-EBDB6CAE | none | OBJ-OS-EDIT, OBJ-OS-STRUCT | `export-workbook.ts`; `view-drawing-export.ts` | F-OS-HANDOFF | AC-OS-010 |
| D2 marketing image generation | BI-01E49424 | none | OBJ-OS-CREATIVE | `routing/image-gen-adapter.ts`; `marketing/media-capabilities.ts` | F-OS-IMAGE | AC-OS-008 |
| D1 media library and edits | BI-07C38D5F | D2 | OBJ-OS-CREATIVE | MediaAsset; `lib/media/` | F-OS-MEDIA | AC-OS-008 |
| D3 branded templates | BI-3E20024B | A4, D1 | OBJ-OS-CREATIVE | dpf-render drawing family; brand masters | F-OS-TEMPLATE | AC-OS-008 |
| C1 scheduling and sync | BI-85AA624A | BI-051A74CE | OBJ-OS-COMMS | CalendarEvent; CalendarSync | F-OS-SCHEDULE | AC-OS-007 |
| E1 presence and soft locks | BI-64D95F71 | A1 | OBJ-OS-EDIT | WorkItemPresence pattern | F-OS-PRESENCE | AC-OS-001 |

Every slice maps to a live backlog item and ships independently. BI-C03605C4 stays the parent of P-Q, P and H. BI-E86EB427 is the umbrella for the roadmap and never enters implementation itself.

## Flows

- **F-OS-FEED:** a member creates a feed token, subscribes externally, and receives only events they may see. Rotating the token revokes the subscription.
- **F-OS-GENERATE:** a coworker outline becomes a validated spec, then a render, then a managed Document with renditions and previews, then a human revision.
- **F-OS-TRACKER:** a brief becomes a coworker-created table with typed columns and a view, then a member edits it.
- **F-OS-UPLOAD:** a member uploads a file into a folder or collection, it gets renditions and search, and only grantees can read it.
- **F-OS-EDIT:** a member opens a document, edits it, and saves against the expected version. The result is a new version or a conflict with recovery.
- **F-OS-REVIEW:** a comment with an @mention goes to a coworker, who revises; the result is a new version.
- **F-OS-AUTOMATE:** a row change matches a rule's condition, the action runs, and the run history records it.
- **F-OS-FORM:** a form link is submitted, validated, turned into a typed row, and optionally starts an automation.
- **F-OS-TIMELINE:** a table with dates and predecessors renders as a timeline; rescheduling shifts dependents, and the critical path is highlighted.
- **F-OS-QUALIFY:** pin a revision, inventory licenses and dependencies, build bounded, check against a corpus, record the footprint and what retires, then reach a go or no-go.
- **F-OS-PDF:** select authorized PDF versions, combine or reorder them, validate the output, and save a new version with provenance.
- **F-OS-HANDOFF:** a sheet or EA view produces a managed snapshot that links back to its source.
- **F-OS-IMAGE:** a brief goes to a catalog model through governed routing, producing a MediaAsset with provenance and alt text.
- **F-OS-MEDIA:** a library asset gets an edit (crop, preset or brand overlay) saved as a new rendition; the original is kept.
- **F-OS-TEMPLATE:** a brief plus media fills a template and renders a branded post or flyer.
- **F-OS-SCHEDULE:** find-a-time, then an invite, then an RSVP, with two-way sync.
- **F-OS-PRESENCE:** opening a record shows who else is there and warns the second editor.

## Order of work

1. **Wave 1, now:** BI-051A74CE, then A4 (BI-012487AA) and B4 (BI-FE8DF004), then A3 (BI-957915CB).
2. **Wave 2:** A1 (BI-8ACA3A2D) then A2 (BI-FC8C8635); B1 (BI-75225116) then B3 (BI-F5E988C6); B2 (BI-A2003F34); H (BI-EBDB6CAE); D2 (BI-01E49424).
3. **Qualification lane, parallel:** P-Q (BI-5D5AB47E) then P (BI-3F319D83); B5 (BI-4F1E55E9).
4. **Wave 3:** D1 (BI-07C38D5F), D3 (BI-3E20024B), C1 (BI-85AA624A).
5. **Deferred:** E1 (BI-64D95F71), until A1 ships and measured need justifies co-editing.

## Verification

- **Each runtime slice owes:**
  - behavior tests written first;
  - affected typechecks;
  - the local-CI gate;
  - live verification on the dev install after release.
- **Live verification covers** the happy path, a refusal path (authorization or conflict), and a UX fit review for any UI.
- **Qualification slices** produce a recorded go or no-go. A no-go is a valid outcome and keeps the existing path.
- **Tenant isolation and expected-version conflicts** are mandatory tests wherever records are written.

## Out of scope for this horizon

- A slide editor.
- Real-time CRDT co-editing.
- A video editor.
- Vector illustration.
- A personal mail client.
- General e-signature (BI-B88442F6 remains deferred).
- An embedded office suite.
- Microsoft 365 as editor of record.
- Consumer-account media clients.

Each is recorded so it is not re-proposed without new evidence.
