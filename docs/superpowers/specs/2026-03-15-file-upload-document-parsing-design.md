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
3. Server validates:
   - Size limit: 10MB default (admin-configurable via `PlatformConfig` key `upload_max_size_mb`)
   - Allowed types: `.csv`, `.xlsx`, `.pdf`, `.docx`
   - MIME validation via magic bytes (not just client Content-Type header): PDF must start with `%PDF-`, XLSX/DOCX must be valid ZIP with expected internal files
   - Thread attachment count: max 20 per thread, checked in upload handler
   - Per-user storage quota: 200MB total (checked before write)
4. File saved with content-addressed naming: `{threadId}/{cuid}.{extension}` — original filename stored only in DB
5. `AgentAttachment` record created with `threadId`, `messageId`, file metadata, and `storageKey`
6. Parsing pipeline runs based on validated mime type
7. Parsed content stored as JSON on `AgentAttachment.parsedContent`
8. Result fed back to the LLM so the agent responds naturally

**Storage config:**
- `PlatformConfig` key: `upload_storage_path` — admin-configurable from `/admin` (separate "Platform Settings" section, not the API keys panel)
- Default: resolved from `UPLOAD_STORAGE_PATH` env var, falling back to `./data/uploads` relative to project root
- Absolute path recommended for production/Docker deployments
- S3/blob storage is a future enhancement

**API response contract:**

Success (200):
```json
{ "attachmentId": "cuid", "fileName": "data.xlsx", "parsedContent": { ... } }
```

Errors:
- 401: `{ "error": "Unauthorized" }`
- 413: `{ "error": "File exceeds 10MB limit" }`
- 415: `{ "error": "Unsupported file type. Allowed: csv, xlsx, pdf, docx" }`
- 422: `{ "error": "File content does not match its extension" }` (magic byte mismatch)
- 429: `{ "error": "Thread attachment limit (20) reached" }`
- 507: `{ "error": "Storage quota exceeded (200MB per user)" }`

**Next.js config:** Set `export const runtime = 'nodejs'` and body size limit in the route handler to support 10MB uploads.

---

## 2. Schema

```prisma
model AgentAttachment {
  id             String        @id @default(cuid())
  threadId       String
  thread         AgentThread   @relation(fields: [threadId], references: [id], onDelete: Cascade)
  messageId      String?
  message        AgentMessage? @relation(fields: [messageId], references: [id], onDelete: SetNull)
  fileName       String        // original filename for display
  mimeType       String
  sizeBytes      Int
  storageKey     String        // content-addressed: {threadId}/{cuid}.{ext}
  parsedContent  Json?         // extracted structure (columns, text, headings)
  parsedAt       DateTime?
  createdAt      DateTime      @default(now())

  @@index([threadId])
  @@index([messageId])
}
```

Add reverse relations:
```prisma
// On AgentThread:
  attachments  AgentAttachment[]

// On AgentMessage:
  attachments  AgentAttachment[]
```

**Client-side data contract** — extend `AgentMessageRow` in `agent-coworker-types.ts`:
```typescript
export type AttachmentInfo = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parsedSummary: string | null;  // from parsedContent.summary
};

// Add to AgentMessageRow:
  attachments?: AttachmentInfo[];
```

Attachments are linked to both thread (for listing) and message (for inline display). `getOrCreateThreadSnapshot` and `sendMessage` return `attachments` on each message that has them.

**Cleanup:** `clearConversation` must delete `AgentAttachment` records AND their files on disk before deleting messages:
```typescript
// In clearConversation:
const attachments = await prisma.agentAttachment.findMany({
  where: { threadId }, select: { storageKey: true },
});
await deleteFilesFromDisk(attachments.map(a => a.storageKey));
await prisma.agentAttachment.deleteMany({ where: { threadId } });
// then existing proposal + message deletion
```

---

## 3. Parsing Pipeline

Common return type for all parsers:

```typescript
type ParsedFileContent = {
  type: "spreadsheet" | "document";
  summary: string;           // "12 columns, 148 rows" or "15 pages, 4 sections"
  columns?: string[];        // max 200 entries, each truncated to 100 chars
  sampleRows?: string[][];   // first 5 rows, cell values truncated to 200 chars
  rowCount?: number;
  sections?: { heading: string; text: string }[];  // max 100 sections
  fullText?: string;         // plain text extraction (truncated to 20K chars)
};
// Total parsedContent JSON capped at 50KB
```

**Parsers:**

| Type | Library | What it extracts |
|------|---------|-----------------|
| CSV | built-in (line split) | columns, sample rows, row count |
| XLSX | `xlsx` (SheetJS) | first sheet columns + sample rows + row count; notes additional sheet count |
| PDF | `pdf-parse` | text per page, truncated to 20K chars |
| DOCX | `mammoth` | text with heading structure |

**Key decisions:**
- Parsing happens server-side at upload time — not deferred
- Parsed content stored on the attachment record for later LLM reference without re-reading the file
- Size caps on all parsed fields prevent oversized LLM context injection
- XLSX: parse first sheet by default, note "3 additional sheets" in summary
- Agent gets structured summary (not raw file content) for reasoning

---

## 4. Chat Upload UX

- **Paperclip button** next to Send button — opens file picker (single file per upload)
- **Drag and drop** onto the chat panel — highlights drop zone
- **Upload progress** — small inline indicator during upload + parse
- **Attachment pill** — after upload, a pill above the message input shows file name and a remove × button. User can type a message with it or send alone. One file per message.
- **In-conversation display** — uploaded files appear as a compact card in the message bubble: file name, type icon, size, parsed summary ("Spreadsheet: 12 columns, 148 rows"). Rendered by `AgentAttachmentCard` using the `attachments` field on `AgentMessageRow`.

**Agent response after upload:**
Parsed content fed to the LLM (same pattern as `search_portfolio_context` tool result feedback). Agent responds naturally: "I see your spreadsheet tracks Student Name, Course, Payment Status, and 9 other fields. This maps well to a student registration database. Want me to use these columns as the starting point?"

**Build Studio enhancement:**
When on `/build`, the Feature Brief panel shows an "Attachments" section listing all files from the thread (fetched via `AgentAttachment` records where `threadId` matches the build's `threadId`). Shows file name, type, and parsed summary. Data fetched by a new `getThreadAttachments(threadId)` React cache function, called from the build page and passed as a prop.

---

## 5. Files Affected

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/file-upload.ts` | Upload handling: validate (size, type, magic bytes, quota), store, create `AgentAttachment` |
| `apps/web/lib/file-parsers.ts` | CSV, XLSX, PDF, DOCX parsers returning `ParsedFileContent` |
| `apps/web/lib/file-parsers.test.ts` | Tests for each parser with sample data |
| `apps/web/app/api/upload/route.ts` | POST endpoint: multipart upload, auth, parse, respond with defined status codes |
| `apps/web/components/agent/AgentFileUpload.tsx` | Paperclip button, drag-drop zone, upload progress, attachment pill |
| `apps/web/components/agent/AgentAttachmentCard.tsx` | In-chat file card (name, type icon, size, summary) |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `AgentAttachment` model + reverse relations on `AgentThread` and `AgentMessage` |
| `apps/web/lib/agent-coworker-types.ts` | Add `AttachmentInfo` type + `attachments` field on `AgentMessageRow` |
| `apps/web/components/agent/AgentMessageInput.tsx` | Add paperclip button + drag-drop |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Handle file upload flow, pass parsed content to `sendMessage` |
| `apps/web/components/agent/AgentMessageBubble.tsx` | Render `AgentAttachmentCard` for messages with attachments |
| `apps/web/components/build/FeatureBriefPanel.tsx` | Show attachments section (receives data via props from build page) |
| `apps/web/components/admin/PlatformKeysPanel.tsx` | Rename to `PlatformSettingsPanel`; add storage path config as a separate section from API keys |
| `apps/web/lib/actions/agent-coworker.ts` | Accept `attachmentId` in `sendMessage`, inject parsed content into prompt; update `clearConversation` to clean up attachments + files |
| `apps/web/lib/feature-build-data.ts` | Add `getThreadAttachments(threadId)` React cache fetcher |

### Dependencies to Add

| Package | Purpose |
|---------|---------|
| `xlsx` | XLSX spreadsheet parsing (SheetJS) |
| `pdf-parse` | PDF text extraction (use `pdf-parse/lib/pdf-parse.js` to avoid bundled test PDF issue) |
| `mammoth` | DOCX to text with heading structure |

---

## 6. Testing Strategy

- **Unit tests for parsers**: CSV with headers, XLSX first sheet + multi-sheet summary, PDF text extraction, DOCX heading structure, size cap enforcement
- **Unit tests for upload validation**: size limits, allowed types, magic byte checking, path sanitization, quota enforcement
- **Unit tests for cleanup**: verify attachment records + files deleted on `clearConversation`
- **Manual smoke test**: upload each file type, verify parsed summary in chat, verify attachment in brief panel, verify cleanup on conversation clear

---

## 7. Not in Scope

- **S3/blob storage** — local filesystem for now, cloud storage is a future enhancement
- **Image uploads** — screenshots/diagrams deferred (would need OCR or vision model)
- **Email (.eml/.msg)** — can be added later with same pattern
- **Version tracking on attachments** — replace is fine for now, no diff history
- **Full-text search across attachments** — deferred to EP-DEDUP-001
- **Attachment download endpoint** — users cannot re-download uploaded files in v1; deferred
- **Multi-file per message** — one file per message in v1; multiple files require separate messages
- **Multi-sheet XLSX deep parsing** — first sheet parsed, others noted in summary count
