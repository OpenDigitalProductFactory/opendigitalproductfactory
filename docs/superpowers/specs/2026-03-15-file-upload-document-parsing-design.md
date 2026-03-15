# EP-UPLOAD-001: File Upload + Document Parsing for Build Studio — Design Spec

**Date:** 2026-03-15
**Goal:** Enable any AI Coworker agent to accept file uploads (spreadsheets, documents) during conversation. Files are parsed to extract structure, the agent uses findings to inform feature design, and files persist as references throughout the build lifecycle. Airtable-style: upload a spreadsheet → platform reads it → suggests a data model.

**Target user:** Non-technical users who have existing spreadsheets, Word docs, or PDFs describing their current processes, data structures, or requirements.

---

## 1. File Upload Infrastructure (Shared)

Built at the agent co-worker level — every agent on every route can receive files.

**Upload flow:**
1. User drags/drops or clicks paperclip in the co-worker chat input
2. File posted to `/api/upload` endpoint (multipart form data)
3. Server validates: size limit (10MB default, admin-configurable), allowed types (csv, xlsx, pdf, docx)
4. File saved to configurable storage path (admin-settable via PlatformConfig, defaults to `./data/uploads/`)
5. `AgentAttachment` record created with `threadId`, file metadata, and `storageKey`
6. Parsing pipeline runs based on mime type
7. Parsed content stored as JSON on `AgentAttachment.parsedContent`
8. Result fed back to the LLM so the agent responds naturally

**Storage config:**
- `PlatformConfig` key: `upload_storage_path` — admin-configurable from `/admin`
- Default: `./data/uploads` (relative to project root)
- File naming: `{threadId}/{timestamp}-{sanitized-filename}`
- S3/blob storage is a future enhancement

**Limits:**
- 10MB per file (configurable via `PlatformConfig` key `upload_max_size_mb`)
- Allowed types: `.csv`, `.xlsx`, `.pdf`, `.docx`
- Max 20 files per thread

---

## 2. Schema

```prisma
model AgentAttachment {
  id             String       @id @default(cuid())
  threadId       String
  thread         AgentThread  @relation(fields: [threadId], references: [id], onDelete: Cascade)
  fileName       String
  mimeType       String
  sizeBytes      Int
  storageKey     String       // relative path within configured upload directory
  parsedContent  Json?        // extracted structure (columns, text, headings)
  parsedAt       DateTime?
  createdAt      DateTime     @default(now())

  @@index([threadId])
}
```

Add reverse relation to `AgentThread`:
```prisma
  attachments  AgentAttachment[]
```

No changes to `FeatureBuild` — attachments are linked through the thread (`FeatureBuild.threadId` → `AgentThread.id` → `AgentAttachment[]`). Any agent conversation gets attachment support, not just builds.

---

## 3. Parsing Pipeline

Common return type for all parsers:

```typescript
type ParsedFileContent = {
  type: "spreadsheet" | "document";
  summary: string;           // "12 columns, 148 rows" or "15 pages, 4 sections"
  columns?: string[];        // spreadsheet column names
  sampleRows?: string[][];   // first 5 rows of data
  rowCount?: number;
  sections?: { heading: string; text: string }[];  // document headings + content
  fullText?: string;         // plain text extraction (truncated to 20K chars)
};
```

**Parsers:**

| Type | Library | What it extracts |
|------|---------|-----------------|
| CSV | built-in (line split) | columns, sample rows, row count |
| XLSX | `xlsx` (SheetJS) | sheet names, columns, sample rows, row count |
| PDF | `pdf-parse` | text per page, truncated to 20K chars |
| DOCX | `mammoth` | text with heading structure |

**Key decisions:**
- Parsing happens server-side at upload time — not deferred
- Parsed content stored on the attachment record for later LLM reference without re-reading the file
- Full text truncated to 20K characters for LLM context management
- Agent gets structured summary (not raw file content) for reasoning

---

## 4. Chat Upload UX

- **Paperclip button** next to Send button — opens file picker
- **Drag and drop** onto the chat panel — highlights drop zone
- **Upload progress** — small inline indicator during upload + parse
- **Attachment pill** — after upload, a pill above the message input shows file name. User can type a message with it or send alone
- **In-conversation display** — uploaded files appear as a compact card: file name, type icon, size, parsed summary ("Spreadsheet: 12 columns, 148 rows")

**Agent response after upload:**
Parsed content fed to the LLM (same pattern as `search_portfolio_context` tool result feedback). Agent responds naturally: "I see your spreadsheet tracks Student Name, Course, Payment Status, and 9 other fields. This maps well to a student registration database. Want me to use these columns as the starting point?"

**Build Studio enhancement:**
When on `/build`, uploaded files also appear in the Feature Brief panel under an "Attachments" section — file name, type, parsed summary. Persists across conversation so files don't get lost in chat history.

---

## 5. Files Affected

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/file-upload.ts` | Upload handling: validate, store, create `AgentAttachment` |
| `apps/web/lib/file-parsers.ts` | CSV, XLSX, PDF, DOCX parsers returning `ParsedFileContent` |
| `apps/web/lib/file-parsers.test.ts` | Tests for each parser with sample data |
| `apps/web/app/api/upload/route.ts` | POST endpoint: multipart upload, auth, parse, respond |
| `apps/web/components/agent/AgentFileUpload.tsx` | Paperclip button, drag-drop zone, upload progress, attachment pill |
| `apps/web/components/agent/AgentAttachmentCard.tsx` | In-chat file card (name, type icon, size, summary) |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `AgentAttachment` model + `attachments` on `AgentThread` |
| `apps/web/components/agent/AgentMessageInput.tsx` | Add paperclip button + drag-drop |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Handle file upload flow, pass parsed content to `sendMessage` |
| `apps/web/components/agent/AgentMessageBubble.tsx` | Render attachment cards in chat |
| `apps/web/components/build/FeatureBriefPanel.tsx` | Show attachments section when on `/build` |
| `apps/web/components/admin/PlatformKeysPanel.tsx` | Add upload storage path config entry |
| `apps/web/lib/actions/agent-coworker.ts` | Accept `attachmentId` in `sendMessage`, inject parsed content into prompt |

### Dependencies to Add

| Package | Purpose |
|---------|---------|
| `xlsx` | XLSX spreadsheet parsing (SheetJS) |
| `pdf-parse` | PDF text extraction |
| `mammoth` | DOCX to text with heading structure |

---

## 6. Testing Strategy

- **Unit tests for parsers**: CSV with headers, XLSX with multiple sheets, PDF text extraction, DOCX heading structure
- **Unit tests for upload validation**: size limits, allowed types, path sanitization
- **Manual smoke test**: upload each file type, verify parsed summary in chat, verify attachment in brief panel

---

## 7. Not in Scope

- **S3/blob storage** — local filesystem for now, cloud storage is a future enhancement
- **Image uploads** — screenshots/diagrams deferred (would need OCR or vision model)
- **Email (.eml/.msg)** — can be added later with same pattern
- **Version tracking on attachments** — replace is fine for now, no diff history
- **Full-text search across attachments** — deferred to EP-DEDUP-001
