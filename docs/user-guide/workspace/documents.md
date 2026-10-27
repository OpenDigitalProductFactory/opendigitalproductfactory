---
title: "Managed Documents"
area: workspace
order: 2
---

## Use This Doc For

- `/workspace/documents`
- `/workspace/documents/[documentId]`
- Document search, lifecycle state, version review, references, and publication status

## Workflow

1. Open Managed Documents from Workspace when you need the maintained copy of a policy, operating note, internal guide, or imported source.
2. Filter by owner, kind, state, or search text before opening individual records.
3. Review the current version, lifecycle events, and references before publishing or archiving.
4. Publish only when the content is ready to be treated as the current operating record.
5. Archive documents that should remain discoverable as history but should not guide current work.

## Add a File

Drop a file on the box at the top of Managed Documents, or select **Choose file**. Word, Excel, PowerPoint, OpenDocument, RTF, PDF, text and markdown files up to 20 MB are accepted (hover over **Choose file** to see the list). The file becomes a managed document that you own, and the page opens it. Its PDF, searchable text and previews appear as soon as the background conversion finishes, exactly as for a file a coworker saved.

A file you drop while a collection marked **Only me** is open is a restricted document too (see below). Otherwise everyone who can open Managed Documents can read it.

## Collections

A collection groups documents, like a folder. The collections you can open are listed above the search box; select one to see only its documents, or **All documents** to see everything.

- **New collection** creates one. Tick **Only me** to make the collection itself restricted.
- A file you drop while a collection is open is added to that collection.
- A collection only shows the documents you may read. A restricted document in a shared collection stays hidden from people who may not read it, and a restricted collection is hidden as a whole.

An AI coworker files a document in a collection with `doc_link` and the reference type `contains`.

## Who Can Read a Document

Every document has an access setting.

- **Organization** (the default): everyone who can open Managed Documents can read it.
- **Restricted**: only its owner, the person who created it, and anyone given access to it can read it. Access given to a person can have an end date; after that date it no longer counts.

A restricted document you may not read does not appear anywhere for you: not in the list, in search results (including searches by meaning), in another document's references, or as a file, PDF, slide preview or export. Opening its address answers "not found", the same as a document that does not exist.

AI coworkers follow the same rule for the person they act for. A coworker working for you sees exactly the documents you may read, and a restricted document a coworker saves for you is owned by you. Saving a new version keeps the document's access setting and owner; only the owner or creator can change who may read a restricted document.

## Office Files

A document can be a stored file: a Word, Excel, PowerPoint, OpenDocument or RTF file saved by a coworker or an integration. After it is saved, the platform converts it in the background into a PDF and a plain-text copy.

- **View PDF** opens that PDF in a new tab, so you can read the file without an office suite.
- **Download original** gives you the file exactly as it was stored. To change it, edit it in your own office suite and save it back as a new version; the new version is converted the same way.
- The extracted text appears on the page and makes the body of the file findable in document search.

While the conversion runs, the page says it is preparing the PDF and searchable text. If the file cannot be converted, the page says why in plain words, and the reason is also recorded in the document's lifecycle history. On an install where document conversion is not set up, nothing is converted and **Download original** still works; the files are converted once conversion becomes available.

## Export

**Export** in the Current Version panel downloads the version as a Word (.docx), OpenDocument (.odt) or PDF file. It works for written documents (markdown, plain text, HTML) and for stored Word-processing files. Other office files, such as spreadsheets and presentations, export to PDF only.

- Headings, tables, lists, links and embedded pictures carry over. A picture that the document only links to (a web address) appears as its description, because conversion never fetches anything from the internet.
- The first export of a version takes a few seconds. The file is kept with that version, so exporting the same version again is immediate.
- On an install where document conversion is not set up, the panel says so instead of offering the menu.

An AI coworker can ask for the same file: `doc_load` accepts an `exportFormat` of `docx`, `odt` or `pdf`.

## Slide Previews

A presentation a coworker produced (see [Marketing](../customers/marketing.md#ask-for-a-presentation)) shows a preview of every slide in the Current Version panel, so you can read the deck without downloading it. Select a slide to open it at full size. The previews belong to the version you are looking at: when the coworker revises the deck, the new version brings its own previews and the version history keeps the earlier ones.

A presentation you upload yourself has a PDF and searchable text but no slide previews; use **View PDF** to read it.

## Authoritative State

The managed document record is authoritative for lifecycle state, owner, current version, references, and audit history. A document's source material can still live elsewhere, but the platform record is the place operators check before relying on it.

## AI Coworker Support

The AI coworker can summarize a document, identify stale references, draft lifecycle notes, and suggest where a document should be linked. It must not treat a draft as published or replace owner approval for publication.

## What To Watch

- similar documents with different owners or states
- published documents without clear references to the source they interpret
- archived documents still linked from current operating pages
- AI-generated summaries being used as the record instead of the stored version
