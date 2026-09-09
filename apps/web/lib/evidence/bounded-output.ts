// apps/web/lib/evidence/bounded-output.ts
//
// BI-39AAE9B8 (EP-A33A5C61 slice 2) — keep evidence PAYLOADS out of ledger
// JSON columns.
//
// THE PROBLEM: a local-CI run's full console output (up to 8 MB uncompressed,
// 2.5 MB after TOAST) was stored inline in ExternalEvidenceRecord.details.
// evidence.output AND, because the MCP call that carried it is itself audited,
// again in ToolExecution.parameters. On one 16-day-old install that was ~560 MB
// (32% of the database) of the same text held twice on two audit ledgers,
// growing ~6.5 GB/year per copy.
//
// THE DESIGN: the platform already has a content-addressed, deduplicating blob
// store (lib/documents/blob-storage.ts, sha256-keyed files under the upload
// storage root, tracked by DocumentBlob rows that the storage-GC door and the
// initiative retention pins understand). Text above a ceiling is written there
// ONCE — both ledger copies collapse to the same sha256 — and the JSON keeps a
// bounded excerpt (head + tail) plus a reference {sha256, storageKey, sizeBytes}.
// Readers that only need a string still get one (the excerpt keeps the tail,
// which is where a failing command reports); readers that need the whole log
// resolve the reference through readDocumentBlob.
//
// Two entry points:
//   • boundLargeStrings  — PURE. Replaces any string leaf above the ceiling with
//                          a bounded marker object carrying digest + head. Used
//                          by the tool-execution ledger writer, which must never
//                          do I/O beyond its own insert.
//   • offloadEvidenceOutput — writes evidence.output to the blob store and
//                          rewrites the evidence object. Used by the evidence
//                          writer (recordLocalIntegrationResult), where the full
//                          log is the durable artefact.

import { createHash } from "node:crypto";

/** Above this many UTF-8 bytes a string leaf leaves the JSON column. */
export const EVIDENCE_INLINE_CEILING_BYTES = 64 * 1024;
/** Bytes of head and of tail kept inline when a string is offloaded. */
export const EVIDENCE_EXCERPT_HEAD_BYTES = 8 * 1024;
export const EVIDENCE_EXCERPT_TAIL_BYTES = 24 * 1024;

export type OffloadedTextReference = {
  sha256: string;
  storageKey: string;
  sizeBytes: number;
  mimeType: "text/plain";
};

export type BoundedStringMarker = {
  __dpfBounded: true;
  sha256: string;
  byteLength: number;
  head: string;
};

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Head + tail excerpt with an explicit omission line naming the full-log digest. */
export function excerptText(text: string, sha256: string, byteLength: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= EVIDENCE_EXCERPT_HEAD_BYTES + EVIDENCE_EXCERPT_TAIL_BYTES) return text;
  const head = buf.subarray(0, EVIDENCE_EXCERPT_HEAD_BYTES).toString("utf8");
  const tail = buf.subarray(buf.byteLength - EVIDENCE_EXCERPT_TAIL_BYTES).toString("utf8");
  const omitted = byteLength - EVIDENCE_EXCERPT_HEAD_BYTES - EVIDENCE_EXCERPT_TAIL_BYTES;
  return `${head}\n…[${omitted} bytes omitted — full output sha256:${sha256}]…\n${tail}`;
}

/**
 * PURE: walk a JSON-ish value and replace every string leaf whose UTF-8 length
 * exceeds `ceilingBytes` with a BoundedStringMarker. Objects and arrays are
 * copied only along paths that change, so an unchanged input returns the same
 * reference (cheap for the common small case).
 */
export function boundLargeStrings<T>(value: T, ceilingBytes = EVIDENCE_INLINE_CEILING_BYTES): T {
  if (typeof value === "string") {
    const byteLength = utf8ByteLength(value);
    if (byteLength <= ceilingBytes) return value;
    const marker: BoundedStringMarker = {
      __dpfBounded: true,
      sha256: sha256Hex(value),
      byteLength,
      head: Buffer.from(value, "utf8").subarray(0, 4 * 1024).toString("utf8"),
    };
    return marker as unknown as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const bounded = boundLargeStrings(entry, ceilingBytes);
      if (bounded !== entry) changed = true;
      return bounded;
    });
    return (changed ? next : value) as T;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const bounded = boundLargeStrings(v, ceilingBytes);
      if (bounded !== v) changed = true;
      next[k] = bounded;
    }
    return (changed ? next : value) as T;
  }
  return value;
}

export type EvidenceBlobWriter = (text: string) => Promise<OffloadedTextReference>;

/**
 * Default writer: content-addressed file via lib/documents/blob-storage plus a
 * DocumentBlob row (upsert on sha256) so the bytes are visible to the storage-GC
 * door and to retention pins. Two ledgers carrying the same log converge on ONE
 * file and ONE row.
 */
export async function writeEvidenceTextBlob(text: string): Promise<OffloadedTextReference> {
  const { writeDocumentBlob } = await import("@/lib/documents/blob-storage");
  const { prisma } = await import("@dpf/db");
  const written = await writeDocumentBlob({ content: text });
  await prisma.documentBlob.upsert({
    where: { sha256: written.sha256 },
    create: {
      sha256: written.sha256,
      storageKey: written.storageKey,
      sizeBytes: written.sizeBytes,
      mimeType: "text/plain",
    },
    update: {},
  });
  return {
    sha256: written.sha256,
    storageKey: written.storageKey,
    sizeBytes: written.sizeBytes,
    mimeType: "text/plain",
  };
}

/**
 * If `evidence.output` is a string above the ceiling, write it to the blob store
 * and return a new evidence object whose `output` is the bounded excerpt and
 * whose `outputBlob` is the reference. Anything else is returned untouched (same
 * reference), so small evidence costs nothing and idempotent re-application is
 * a no-op (an already-offloaded excerpt is below the ceiling by construction).
 */
export async function offloadEvidenceOutput<T>(
  evidence: T,
  options: { ceilingBytes?: number; writeBlob?: EvidenceBlobWriter } = {},
): Promise<T> {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return evidence;
  const record = evidence as Record<string, unknown>;
  const output = record.output;
  if (typeof output !== "string") return evidence;
  const ceiling = options.ceilingBytes ?? EVIDENCE_INLINE_CEILING_BYTES;
  const byteLength = utf8ByteLength(output);
  if (byteLength <= ceiling) return evidence;
  const writer = options.writeBlob ?? writeEvidenceTextBlob;
  const reference = await writer(output);
  return {
    ...record,
    output: excerptText(output, reference.sha256, byteLength),
    outputBlob: reference,
    outputTruncated: true,
  } as T;
}
