# EP-UPLOAD-001: File Upload + Document Parsing — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable file uploads (CSV, XLSX, PDF, DOCX) in any AI Coworker conversation, with server-side parsing and LLM integration.

**Architecture:** Upload API endpoint stores files to admin-configurable path, creates `AgentAttachment` records with parsed content. Parsers extract structure (columns, text, headings) into a common `ParsedFileContent` type. Chat UI gets paperclip button + drag-drop + attachment cards. Parsed content injected into LLM prompt for natural responses.

**Tech Stack:** Next.js 14 App Router, Prisma 5, TypeScript strict, Vitest, xlsx (SheetJS), pdf-parse, mammoth.

**Spec:** `docs/superpowers/specs/2026-03-15-file-upload-document-parsing-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/file-upload.ts` | Validate, store, create AgentAttachment |
| `apps/web/lib/file-parsers.ts` | CSV, XLSX, PDF, DOCX parsers |
| `apps/web/lib/file-parsers.test.ts` | Parser tests |
| `apps/web/app/api/upload/route.ts` | POST endpoint |
| `apps/web/components/agent/AgentFileUpload.tsx` | Paperclip + drag-drop + pill |
| `apps/web/components/agent/AgentAttachmentCard.tsx` | In-chat file card |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `AgentAttachment` model |
| `apps/web/lib/agent-coworker-types.ts` | Add `AttachmentInfo` type |
| `apps/web/components/agent/AgentMessageInput.tsx` | Integrate file upload button |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Handle upload flow |
| `apps/web/components/agent/AgentMessageBubble.tsx` | Render attachment cards |
| `apps/web/lib/actions/agent-coworker.ts` | Accept attachmentId, inject parsed content, cleanup |
| `apps/web/components/build/FeatureBriefPanel.tsx` | Show attachments section |

---

## Chunk 1: Schema + Types + Dependencies

### Task 1: Schema Migration

**Files:** `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add AgentAttachment model**

Add after the `AgentActionProposal` model:

```prisma
model AgentAttachment {
  id             String        @id @default(cuid())
  threadId       String
  thread         AgentThread   @relation(fields: [threadId], references: [id], onDelete: Cascade)
  messageId      String?
  message        AgentMessage? @relation(fields: [messageId], references: [id], onDelete: SetNull)
  fileName       String
  mimeType       String
  sizeBytes      Int
  storageKey     String
  parsedContent  Json?
  parsedAt       DateTime?
  createdAt      DateTime      @default(now())

  @@index([threadId])
  @@index([messageId])
}
```

Add `attachments AgentAttachment[]` to both `AgentThread` and `AgentMessage` models.

- [ ] **Step 2: Create and apply migration**

```bash
mkdir -p packages/db/prisma/migrations/20260315200000_add_agent_attachment
cat > packages/db/prisma/migrations/20260315200000_add_agent_attachment/migration.sql << 'SQLEOF'
-- CreateTable
CREATE TABLE "AgentAttachment" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "parsedContent" JSONB,
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentAttachment_threadId_idx" ON "AgentAttachment"("threadId");
CREATE INDEX "AgentAttachment_messageId_idx" ON "AgentAttachment"("messageId");

-- AddForeignKey
ALTER TABLE "AgentAttachment" ADD CONSTRAINT "AgentAttachment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentAttachment" ADD CONSTRAINT "AgentAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AgentMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
SQLEOF
cd packages/db && npx prisma migrate deploy && npx prisma generate
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/
git commit -m "feat(schema): add AgentAttachment model for file uploads"
```

### Task 2: Add Types + Install Dependencies

**Files:** `apps/web/lib/agent-coworker-types.ts`

- [ ] **Step 1: Add AttachmentInfo type**

Add to `apps/web/lib/agent-coworker-types.ts`:

```typescript
export type AttachmentInfo = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parsedSummary: string | null;
};
```

Add `attachments?: AttachmentInfo[];` to the `AgentMessageRow` type.

- [ ] **Step 2: Install parser dependencies**

```bash
cd apps/web && pnpm add xlsx pdf-parse mammoth
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/agent-coworker-types.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat: add AttachmentInfo type and parser dependencies"
```

---

## Chunk 2: File Parsers (TDD)

### Task 3: File Parsers

**Files:**
- Create: `apps/web/lib/file-parsers.ts`
- Create: `apps/web/lib/file-parsers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/file-parsers.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseCsv, parseFileContent, type ParsedFileContent } from "./file-parsers";

describe("parseCsv", () => {
  it("extracts columns and sample rows", () => {
    const csv = "Name,Email,Course\nAlice,a@test.com,Math\nBob,b@test.com,Science\n";
    const result = parseCsv(Buffer.from(csv));
    expect(result.type).toBe("spreadsheet");
    expect(result.columns).toEqual(["Name", "Email", "Course"]);
    expect(result.sampleRows).toHaveLength(2);
    expect(result.rowCount).toBe(2);
    expect(result.summary).toContain("3 columns");
  });

  it("handles empty CSV", () => {
    const result = parseCsv(Buffer.from(""));
    expect(result.columns).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it("truncates columns at 200", () => {
    const headers = Array.from({ length: 250 }, (_, i) => `col${i}`).join(",");
    const result = parseCsv(Buffer.from(headers + "\n"));
    expect(result.columns!.length).toBeLessThanOrEqual(200);
  });

  it("truncates cell values at 200 chars", () => {
    const longVal = "x".repeat(300);
    const csv = `Name\n${longVal}\n`;
    const result = parseCsv(Buffer.from(csv));
    expect(result.sampleRows![0]![0]!.length).toBeLessThanOrEqual(200);
  });
});

describe("parseFileContent", () => {
  it("routes CSV by mime type", async () => {
    const csv = "A,B\n1,2\n";
    const result = await parseFileContent(Buffer.from(csv), "text/csv", "test.csv");
    expect(result.type).toBe("spreadsheet");
    expect(result.columns).toEqual(["A", "B"]);
  });

  it("returns null for unsupported type", async () => {
    const result = await parseFileContent(Buffer.from("hello"), "text/plain", "test.txt");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/file-parsers.test.ts
```

- [ ] **Step 3: Implement file-parsers.ts**

Create `apps/web/lib/file-parsers.ts`:

```typescript
export type ParsedFileContent = {
  type: "spreadsheet" | "document";
  summary: string;
  columns?: string[];
  sampleRows?: string[][];
  rowCount?: number;
  sections?: { heading: string; text: string }[];
  fullText?: string;
};

const MAX_COLUMNS = 200;
const MAX_COLUMN_LEN = 100;
const MAX_CELL_LEN = 200;
const MAX_SAMPLE_ROWS = 5;
const MAX_SECTIONS = 100;
const MAX_TEXT_LEN = 20_000;
const MAX_PARSED_JSON_SIZE = 50_000;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

export function parseCsv(buffer: Buffer): ParsedFileContent {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { type: "spreadsheet", summary: "Empty spreadsheet", columns: [], rowCount: 0 };
  }

  const headerLine = lines[0]!;
  const allColumns = headerLine.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const columns = allColumns.slice(0, MAX_COLUMNS).map((c) => truncate(c, MAX_COLUMN_LEN));

  const dataLines = lines.slice(1);
  const sampleRows = dataLines.slice(0, MAX_SAMPLE_ROWS).map((line) =>
    line.split(",").slice(0, MAX_COLUMNS).map((cell) => truncate(cell.trim().replace(/^"|"$/g, ""), MAX_CELL_LEN)),
  );

  return {
    type: "spreadsheet",
    summary: `${columns.length} columns, ${dataLines.length} rows`,
    columns,
    sampleRows,
    rowCount: dataLines.length,
  };
}

export async function parseXlsx(buffer: Buffer): Promise<ParsedFileContent> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { type: "spreadsheet", summary: "Empty workbook", columns: [], rowCount: 0 };
  }

  const sheet = workbook.Sheets[sheetName]!;
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as string[][];

  const headerRow = rows[0] ?? [];
  const columns = headerRow.slice(0, MAX_COLUMNS).map((c) => truncate(String(c), MAX_COLUMN_LEN));
  const dataRows = rows.slice(1);
  const sampleRows = dataRows.slice(0, MAX_SAMPLE_ROWS).map((row) =>
    row.slice(0, MAX_COLUMNS).map((cell) => truncate(String(cell), MAX_CELL_LEN)),
  );

  const extraSheets = workbook.SheetNames.length - 1;
  const sheetNote = extraSheets > 0 ? ` (${extraSheets} additional sheet${extraSheets !== 1 ? "s" : ""})` : "";

  return {
    type: "spreadsheet",
    summary: `${columns.length} columns, ${dataRows.length} rows${sheetNote}`,
    columns,
    sampleRows,
    rowCount: dataRows.length,
  };
}

export async function parsePdf(buffer: Buffer): Promise<ParsedFileContent> {
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  const fullText = truncate(data.text, MAX_TEXT_LEN);
  const pages = data.numpages;

  return {
    type: "document",
    summary: `${pages} page${pages !== 1 ? "s" : ""}, ${data.text.length} characters`,
    fullText,
  };
}

export async function parseDocx(buffer: Buffer): Promise<ParsedFileContent> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const fullText = truncate(result.value, MAX_TEXT_LEN);

  // Simple heading extraction from HTML output
  const htmlResult = await mammoth.convertToHtml({ buffer });
  const headingRe = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi;
  const sections: { heading: string; text: string }[] = [];
  let match;
  while ((match = headingRe.exec(htmlResult.value)) !== null && sections.length < MAX_SECTIONS) {
    sections.push({ heading: match[1]!.replace(/<[^>]*>/g, ""), text: "" });
  }

  return {
    type: "document",
    summary: `${sections.length} section${sections.length !== 1 ? "s" : ""}, ${result.value.length} characters`,
    sections: sections.length > 0 ? sections : undefined,
    fullText,
  };
}

export async function parseFileContent(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ParsedFileContent | null> {
  const ext = fileName.split(".").pop()?.toLowerCase();

  if (mimeType === "text/csv" || ext === "csv") {
    return parseCsv(buffer);
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || ext === "xlsx") {
    return parseXlsx(buffer);
  }
  if (mimeType === "application/pdf" || ext === "pdf") {
    return parsePdf(buffer);
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === "docx") {
    return parseDocx(buffer);
  }

  return null;
}

export function capParsedContentSize(content: ParsedFileContent): ParsedFileContent {
  const json = JSON.stringify(content);
  if (json.length <= MAX_PARSED_JSON_SIZE) return content;
  // Truncate fullText further if over budget
  if (content.fullText) {
    const excess = json.length - MAX_PARSED_JSON_SIZE;
    content.fullText = content.fullText.slice(0, Math.max(1000, content.fullText.length - excess));
  }
  return content;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/file-parsers.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/file-parsers.ts apps/web/lib/file-parsers.test.ts
git commit -m "feat: file parsers for CSV, XLSX, PDF, DOCX with size caps"
```

---

## Chunk 3: Upload Handler + API Route

### Task 4: File Upload Handler

**Files:**
- Create: `apps/web/lib/file-upload.ts`
- Create: `apps/web/app/api/upload/route.ts`

- [ ] **Step 1: Create file-upload.ts**

```typescript
import { prisma } from "@dpf/db";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { parseFileContent, capParsedContentSize } from "./file-parsers";

const ALLOWED_EXTENSIONS = new Set(["csv", "xlsx", "pdf", "docx"]);
const DEFAULT_MAX_SIZE_MB = 10;
const MAX_ATTACHMENTS_PER_THREAD = 20;
const MAX_USER_STORAGE_BYTES = 200 * 1024 * 1024; // 200MB

// Magic byte signatures
const MAGIC_BYTES: Record<string, number[]> = {
  pdf: [0x25, 0x50, 0x44, 0x46],     // %PDF
  xlsx: [0x50, 0x4b, 0x03, 0x04],    // PK (ZIP)
  docx: [0x50, 0x4b, 0x03, 0x04],    // PK (ZIP)
};

async function getUploadStoragePath(): Promise<string> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "upload_storage_path" },
    select: { value: true },
  });
  if (config && typeof config.value === "string" && config.value.length > 0) {
    return config.value;
  }
  return process.env.UPLOAD_STORAGE_PATH ?? "./data/uploads";
}

async function getMaxSizeMb(): Promise<number> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "upload_max_size_mb" },
    select: { value: true },
  });
  if (config && typeof config.value === "number") return config.value;
  return DEFAULT_MAX_SIZE_MB;
}

function validateMagicBytes(buffer: Buffer, ext: string): boolean {
  const expected = MAGIC_BYTES[ext];
  if (!expected) return true; // CSV has no magic bytes
  if (buffer.length < expected.length) return false;
  return expected.every((byte, i) => buffer[i] === byte);
}

export type UploadResult = {
  attachmentId: string;
  fileName: string;
  parsedContent: unknown;
};

export type UploadError = {
  error: string;
  status: number;
};

export async function handleFileUpload(
  file: File,
  threadId: string,
  userId: string,
): Promise<UploadResult | UploadError> {
  // Validate extension
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { error: "Unsupported file type. Allowed: csv, xlsx, pdf, docx", status: 415 };
  }

  // Validate size
  const maxSize = await getMaxSizeMb();
  if (file.size > maxSize * 1024 * 1024) {
    return { error: `File exceeds ${maxSize}MB limit`, status: 413 };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Validate magic bytes
  if (!validateMagicBytes(buffer, ext)) {
    return { error: "File content does not match its extension", status: 422 };
  }

  // Check thread attachment limit
  const attachmentCount = await prisma.agentAttachment.count({ where: { threadId } });
  if (attachmentCount >= MAX_ATTACHMENTS_PER_THREAD) {
    return { error: `Thread attachment limit (${MAX_ATTACHMENTS_PER_THREAD}) reached`, status: 429 };
  }

  // Check user storage quota
  const thread = await prisma.agentThread.findUnique({
    where: { id: threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== userId) {
    return { error: "Unauthorized", status: 401 };
  }

  const userThreads = await prisma.agentThread.findMany({
    where: { userId },
    select: { id: true },
  });
  const totalStorage = await prisma.agentAttachment.aggregate({
    where: { threadId: { in: userThreads.map((t) => t.id) } },
    _sum: { sizeBytes: true },
  });
  if ((totalStorage._sum.sizeBytes ?? 0) + file.size > MAX_USER_STORAGE_BYTES) {
    return { error: "Storage quota exceeded (200MB per user)", status: 507 };
  }

  // Store file
  const storagePath = await getUploadStoragePath();
  const { randomUUID } = await import("crypto");
  const storageKey = `${threadId}/${randomUUID()}.${ext}`;
  const fullPath = join(storagePath, storageKey);
  await mkdir(join(storagePath, threadId), { recursive: true });
  await writeFile(fullPath, buffer);

  // Parse
  let parsedContent = await parseFileContent(buffer, file.type, file.name);
  if (parsedContent) {
    parsedContent = capParsedContentSize(parsedContent);
  }

  // Create record
  const attachment = await prisma.agentAttachment.create({
    data: {
      threadId,
      fileName: file.name,
      mimeType: file.type || `application/${ext}`,
      sizeBytes: file.size,
      storageKey,
      parsedContent: parsedContent as import("@dpf/db").Prisma.InputJsonValue ?? undefined,
      parsedAt: parsedContent ? new Date() : null,
    },
    select: { id: true },
  });

  return {
    attachmentId: attachment.id,
    fileName: file.name,
    parsedContent,
  };
}

export async function deleteAttachmentsForThread(threadId: string): Promise<void> {
  const attachments = await prisma.agentAttachment.findMany({
    where: { threadId },
    select: { storageKey: true },
  });

  const storagePath = await getUploadStoragePath();
  const { unlink } = await import("fs/promises");

  for (const att of attachments) {
    await unlink(join(storagePath, att.storageKey)).catch(() => {});
  }

  await prisma.agentAttachment.deleteMany({ where: { threadId } });
}
```

- [ ] **Step 2: Create API route**

Create `apps/web/app/api/upload/route.ts`:

```typescript
import { auth } from "@/lib/auth";
import { handleFileUpload } from "@/lib/file-upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const threadId = formData.get("threadId") as string | null;

  if (!file || !threadId) {
    return NextResponse.json({ error: "file and threadId required" }, { status: 400 });
  }

  const result = await handleFileUpload(file, threadId, session.user.id);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result);
}
```

- [ ] **Step 3: Update clearConversation to clean up attachments**

In `apps/web/lib/actions/agent-coworker.ts`, add import and cleanup before the existing proposal/message deletion:

```typescript
import { deleteAttachmentsForThread } from "@/lib/file-upload";

// In clearConversation, before deleting proposals:
await deleteAttachmentsForThread(input.threadId);
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/file-upload.ts apps/web/app/api/upload/ apps/web/lib/actions/agent-coworker.ts
git commit -m "feat: file upload handler with validation, storage, and cleanup"
```

---

## Chunk 4: Chat UI Components

### Task 5: Upload UI + Attachment Card

**Files:**
- Create: `apps/web/components/agent/AgentFileUpload.tsx`
- Create: `apps/web/components/agent/AgentAttachmentCard.tsx`
- Modify: `apps/web/components/agent/AgentMessageInput.tsx`
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`
- Modify: `apps/web/components/agent/AgentMessageBubble.tsx`

- [ ] **Step 1: Create AgentAttachmentCard**

```typescript
// apps/web/components/agent/AgentAttachmentCard.tsx
"use client";

import type { AttachmentInfo } from "@/lib/agent-coworker-types";

const TYPE_ICONS: Record<string, string> = {
  "text/csv": "\u{1F4CA}",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "\u{1F4CA}",
  "application/pdf": "\u{1F4C4}",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "\u{1F4DD}",
};

export function AgentAttachmentCard({ attachment }: { attachment: AttachmentInfo }) {
  const icon = TYPE_ICONS[attachment.mimeType] ?? "\u{1F4CE}";
  const sizeKb = Math.round(attachment.sizeBytes / 1024);
  const sizeLabel = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)}MB` : `${sizeKb}KB`;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-xs mt-1 mb-1">
      <span className="text-base">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-white truncate">{attachment.fileName}</div>
        <div className="text-[var(--dpf-muted)] text-[10px]">
          {sizeLabel}
          {attachment.parsedSummary && <span> &middot; {attachment.parsedSummary}</span>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create AgentFileUpload**

```typescript
// apps/web/components/agent/AgentFileUpload.tsx
"use client";

import { useRef, useState } from "react";

type Props = {
  threadId: string | null;
  disabled: boolean;
  onUploaded: (result: { attachmentId: string; fileName: string; parsedContent: unknown }) => void;
};

export function AgentFileUpload({ threadId, disabled, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!threadId) return;
    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("threadId", threadId);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed");
      } else {
        onUploaded(data);
      }
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.pdf,.docx"
        onChange={handleChange}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading || !threadId}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        title="Upload a file"
        style={{
          background: "transparent",
          border: "none",
          color: uploading ? "var(--dpf-accent)" : "var(--dpf-muted)",
          fontSize: 16,
          cursor: disabled || uploading ? "not-allowed" : "pointer",
          padding: "6px",
          opacity: disabled ? 0.5 : 1,
          flexShrink: 0,
        }}
      >
        {uploading ? "\u23F3" : "\u{1F4CE}"}
      </button>
      {error && (
        <div className="text-[10px] text-[#f87171] absolute bottom-full left-0 mb-1 px-2">
          {error}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Integrate into AgentMessageInput**

In `apps/web/components/agent/AgentMessageInput.tsx`, add the upload button next to Send. The component needs `threadId` and `onFileUploaded` props. Add them to the Props type and render `AgentFileUpload` before the Send button.

- [ ] **Step 4: Wire upload in AgentCoworkerPanel**

In `AgentCoworkerPanel.tsx`:
- Add state: `const [pendingAttachment, setPendingAttachment] = useState<{ attachmentId: string; fileName: string; parsedContent: unknown } | null>(null);`
- Pass `onFileUploaded` to `AgentMessageInput` that sets `pendingAttachment`
- When sending a message with a pending attachment, include `attachmentId` in the `sendMessage` call
- After send, clear `pendingAttachment`
- Show attachment pill above the input when pending

- [ ] **Step 5: Render attachment cards in AgentMessageBubble**

In `AgentMessageBubble.tsx`, check `message.attachments` and render `AgentAttachmentCard` for each.

- [ ] **Step 6: Update sendMessage to inject parsed content**

In `apps/web/lib/actions/agent-coworker.ts`:
- Accept optional `attachmentId?: string` in `sendMessage` input
- If present, fetch the attachment's `parsedContent` and inject into prompt sections
- Link the attachment to the user message: `await prisma.agentAttachment.update({ where: { id: attachmentId }, data: { messageId: userMsg.id } })`

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/agent/ apps/web/lib/actions/agent-coworker.ts
git commit -m "feat: file upload UI — paperclip button, attachment cards, LLM injection"
```

---

## Chunk 5: Build Studio Integration + Final

### Task 6: Feature Brief Attachments

**Files:** `apps/web/components/build/FeatureBriefPanel.tsx`, `apps/web/lib/feature-build-data.ts`

- [ ] **Step 1: Add getThreadAttachments fetcher**

In `apps/web/lib/feature-build-data.ts`:

```typescript
export const getThreadAttachments = cache(async (threadId: string): Promise<AttachmentInfo[]> => {
  const rows = await prisma.agentAttachment.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, parsedContent: true },
  });
  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    parsedSummary: (r.parsedContent as { summary?: string } | null)?.summary ?? null,
  }));
});
```

- [ ] **Step 2: Show attachments in FeatureBriefPanel**

Add an `attachments` prop to `FeatureBriefPanel` and render an "Attachments" section when there are files. Use `AgentAttachmentCard` for each.

- [ ] **Step 3: Pass attachments from build page**

In `apps/web/app/(shell)/build/page.tsx`, fetch `getThreadAttachments` when the build has a `threadId` and pass to `BuildStudio` → `FeatureBriefPanel`.

- [ ] **Step 4: Add storage path to admin settings**

In `apps/web/components/admin/PlatformKeysPanel.tsx`, add a second entry for `upload_storage_path` with `label: "File Upload Storage Path"`, `description: "Directory for uploaded files. Use an absolute path in production."`, `placeholder: "./data/uploads"`. This entry should NOT use masked input (it's a path, not a secret).

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat: Build Studio attachment display + admin storage path config"
```

### Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Smoke test**

1. Go to `/admin`, verify "File Upload Storage Path" setting appears
2. Go to `/build`, create a new feature
3. In the co-worker panel, click the paperclip and upload a CSV
4. Verify: attachment card appears in chat, agent responds with column analysis
5. Upload a PDF — verify text extraction summary
6. Check Feature Brief panel — attachments listed
7. Clear conversation — verify files deleted from disk

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "chore: final adjustments for EP-UPLOAD-001"
```
