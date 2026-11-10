---
status: draft
---

# Integrated office suite: roadmap design

Date: 2026-10-14. Umbrella: **BI-E86EB427**. Epic: **EP-8DC217EB**. Decision: **DI-F6A12669BCB7**.

This design extends two others:
- [The office document engine](2026-09-22-office-document-conversion-design.md) (BI-815D40C6, delivered, live on v2026.10.05).
- [Native productivity](2026-10-11-native-productivity-artcraft-absorption-design.md) (BI-C03605C4, parked: PdfCraft packet editing).

It sets the next horizon. It doesn't replace either.

## 1. Intent and decision

The founder asked for DPF to cover most organizations' office needs. That means a hybrid of Microsoft 365-style documents, sheets, slides, PDF and calendar; Smartsheet-style structured work, which Workbooks already provides; and light Adobe-style creative work. The Microsoft 365 coverage matters most, because it integrates with DPF records and AI coworkers.

**Decision:** WWMD scored four options and chose `native-surfaces-selective-craft-engines`, with high confidence, a 3.58 margin and autonomy eligibility.
- DPF builds native editors and surfaces over its own canonical records.
- It absorbs headless engine crates from the storytold *Craft family only after per-crate qualification.
- The Craft GUIs are never embedded.

**Rejected:**
- Embedding Collabora Online or ONLYOFFICE. This was also rejected in 09-22.
- Microsoft 365 as editor of record. It means vendor lock-in and data leaving the platform.
- Shipping the Craft desktop apps beside DPF. They have no record or coworker integration.

The strongest contributors were *Absorb, Don't Adopt*, *Research and Use Standards*, *Single Source of Truth* and *Ground New Work In Existing Platform*.

## 2. Objectives

- **OBJ-OS-EDIT:** People and coworkers create and revise documents, sheets, slides and drawings in DPF. Every save is a versioned, authorized and conflict-safe record.
- **OBJ-OS-STRUCT:** Workbooks reach Smartsheet depth (automations, timeline, forms, coworker authoring) without a second data store.
- **OBJ-OS-COMMS:** Calendar and scheduling work with external calendars. No business data is exposed without authorization.
- **OBJ-OS-CREATIVE:** The marketing coworker and members produce on-brand images, posts and flyers from governed providers and templates.
- **OBJ-OS-ABSORB:** External engines enter only as qualified, pinned and measured crates behind existing contracts. Each one names what it retires.

## 3. Current state and gaps

An inventory of origin/main `f29ea81970d` set the baseline.
- **Real:**
  - The document store (versions, blobs, renditions, conversion, export and search).
  - Workbooks (22 column types, about 30 functions, grid, gallery, calendar, kanban and pivot views, xlsx/ods import and export).
  - Deck generation.
  - The EA canvas with Visio/Draw exchange.
  - The Mailroom.
  - A merged calendar.
- **Missing:**
  - Any document editor, document comments, uploads and folders, and enforced document permissions (`DocumentAccessGrant` is never read).
  - Workbook automations, a Gantt view, forms and coworker authoring.
  - Coworker tools for the report, letter, sheet and drawing render families.
  - PDF viewing and page operations, and e-signature beyond invoices.
  - Scheduling and two-way calendar sync.
  - A media library and image editing, plus marketing image generation.
  - Co-editing.
- **Security:** The calendar `.ics` feed is unauthenticated (BI-051A74CE). It must ship before C1.

## 4. Capability map

| Track | Microsoft 365 / Smartsheet / Adobe analogue | DPF owner | Slices |
| --- | --- | --- | --- |
| A Documents and files | Word, OneDrive/SharePoint | Document, DocumentVersion, DocumentAccessGrant | A1 editor and fence; A2 comments; A3 files and permissions; A4 render-family tools |
| P PDF | Acrobat | Document store + doctools | BI-5D5AB47E qualify PdfCraft; BI-3F319D83 packet ops; BI-EBDB6CAE handoff |
| B Structured work | Smartsheet, Excel, Forms | Workbook* models | B1 automations; B2 timeline; B3 forms; B4 coworker authoring; B5 formula engine qualification |
| C Time | Outlook calendar | CalendarEvent, CalendarSync | BI-051A74CE first; C1 scheduling and sync |
| D Creative | Photoshop/Express, InDesign-lite | MediaAsset, BrandingConfig, dpf-render | D1 media library and edits; D2 image generation; D3 branded templates |
| E Collaboration | Live co-authoring | presence, A1's fence | E1 presence and soft locks (deferred) |

Slides stay in generation (`create_presentation`) for this horizon. A slide editor is out of scope until A1 proves the editor pattern. E-signature beyond invoices stays with the deferred BI-B88442F6.

## 5. Principles for every slice

- **Canonical records stay canonical.** Workbook, EaView, Document and MediaAsset keep ownership. No generic asset store, editor-session table or parallel suite account system is added. Before adding schema, prove the existing models can't express the need.
- **One governed path.** People and coworkers share authorization, input validation, execution bounds, expected-version fencing and receipts. Engine discovery never grants authority.
- **Engines through the doctools boundary.** Server work runs in the pinned, non-root, no-network, one-shot doctools image (S1/S2). Browser work runs as WASM in a worker with no network access. Long-lived services are not added.
- **Qualify before absorbing.** A Craft crate enters only with:
  - an immutable revision;
  - a license, asset and transitive inventory;
  - a security review;
  - a fidelity corpus;
  - a footprint ledger;
  - a named retirement of what it replaces.

  The Craft projects are 1–2 weeks old (v0.7–v0.11), so treat them as unproven until a corpus says otherwise. This follows BI-5D5AB47E's pattern.
- **No consumer-account clients.** ArtCraft's browser-emulation and Cloudflare-mitigation clients for Midjourney, Grok, Sora and World Labs are rejected. Media generation goes through governed provider APIs in the inference router.
- **Refactor share.** At least about 20% of each slice goes into consolidating shared contracts and retiring duplicate paths. This is the founder's 10-11 direction.

## 6. Research

| Comparator | Adopt | Reject or defer |
| --- | --- | --- |
| [storytold *Craft](https://github.com/storytold) (WordCraft, GridCraft, DeckCraft, PdfCraft, PhotoCraft; MIT/Apache) | Headless engine crates (formula, xlsx, docx, layout, pdf) behind DPF contracts; the per-app MCP/CLI control pattern as evaluation evidence | egui GUIs, desktop distribution, unqualified crates |
| [ArtCraft](https://github.com/storytold/artcraft) | The typed media-model catalog and "compose before generate" control patterns for D2/D3 | Its paid cloud provider, consumer-account clients, the Tauri app |
| [Smartsheet automations](https://help.smartsheet.com/learning-track/smartsheet-intermediate/workflow-automation) | Trigger, condition, action rules with a run history | A separate automation engine; B1 uses DPF's job engine |
| [Microsoft Forms](https://support.microsoft.com/office/create-a-form-with-microsoft-forms) / Smartsheet forms | Forms generated from table columns; submissions as typed rows | Standalone response stores |
| [RFC 5545 iCalendar](https://www.rfc-editor.org/rfc/rfc5545) | Per-user secret feed URLs and ICS invites with RSVP | Id-only feeds |
| Collabora / ONLYOFFICE | Not adopted (see §1) | In-browser office embedding |

## 7. Acceptance contract

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-OS-001 | OBJ-OS-EDIT | A member edits and saves a document in the browser; a new version is created, and a stale save is refused without overwrite. |
| AC-OS-002 | OBJ-OS-EDIT | Restricted documents are refused on every read path, including search, previews and MCP, to users without a grant. |
| AC-OS-003 | OBJ-OS-EDIT | Coworkers produce branded reports, letters, sheets and drawings as managed documents. |
| AC-OS-004 | OBJ-OS-STRUCT | A Workbook rule fires once per change, and its run history shows the action and outcome. |
| AC-OS-005 | OBJ-OS-STRUCT | A form submission becomes a typed row, and a timeline view shows dependencies and the critical path. |
| AC-OS-006 | OBJ-OS-STRUCT | A coworker builds a tracker table with typed columns and a view from a brief. |
| AC-OS-007 | OBJ-OS-COMMS | Calendar feeds need a per-user revocable token, and find-a-time and two-way sync work against an external calendar. |
| AC-OS-008 | OBJ-OS-CREATIVE | The marketing coworker produces an on-brand image, post and flyer through governed providers and templates. |
| AC-OS-009 | OBJ-OS-ABSORB | Every absorbed engine has a qualification record (revision, licenses, corpus, footprint, retirement); a no-go keeps the existing path. |
| AC-OS-010 | OBJ-OS-ABSORB | No embedded office suite, always-on engine service or second artifact store is added. |

## 8. Sequencing

1. **Now:**
   - BI-051A74CE (security).
   - A4 and B4: small tools that make coworkers useful immediately.
   - A3 (permissions first, then uploads).
2. **Next:**
   - A1, then A2.
   - B1, then B3, then B2.
   - BI-EBDB6CAE handoff.
   - D2, then D1, then D3.
3. **Qualification lane, parallel:**
   - BI-5D5AB47E (PdfCraft), then BI-3F319D83.
   - B5 (GridCraft formula engine).
4. **Later:**
   - C1, after BI-051A74CE.
   - E1, after A1.

Each slice is its own backlog item, branch and PR, with test-first and live verification. The plan maps slices to live items.
