// Embedded objects in an OpenDocument package (BI-BFF142A1).
//
// dpf-convert keeps LibreOffice's DisableActiveContent on for customer files.
// Measured on the engine (2026-09-25): a zipped .ods or .odt with a chart still
// converts (the PDF shows the chart's stored picture; .docx/.xlsx drop it), but
// a flat ODS carrying an inline chart object is refused with a generic "could
// not be loaded" (exit 3). When a conversion fails, ingestion (S3) and
// renditions (S4) ask this module whether the file embeds objects, so the
// person is told why instead of "damaged" (BI-BFF142A1). The check is
// deterministic: the package's own inventory (META-INF/manifest.xml), or the
// object elements of a flat ODF document.
//
// Only the central directory and the one manifest entry are read; nothing else
// is inflated, and the manifest is inflated under a small output cap.

import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MANIFEST = "META-INF/manifest.xml";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ENTRIES = 65_535;

/** Sub-documents (charts, formulas, embedded documents) and OLE objects; pictures are not objects. */
const OBJECT_MEDIA_TYPE = /^application\/vnd\.(oasis\.opendocument\.[a-z-]+|sun\.star\.oleobject)$/;

export const EMBEDDED_OBJECTS_REASON =
  "This file contains embedded objects (such as charts) that DPF does not open, so its content was not extracted. Save a copy without the embedded objects, or as PDF, and upload it again.";

function toBuffer(input: Uint8Array): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

/** One entry of a ZIP by name, or null when the archive does not have it or cannot be read. */
function readZipEntry(zip: Buffer, name: string, maxBytes: number): Buffer | null {
  const searchFrom = Math.max(0, zip.length - 65_557);
  let eocd = -1;
  for (let at = zip.length - 22; at >= searchFrom; at -= 1) {
    if (zip.readUInt32LE(at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = Math.min(zip.readUInt16LE(eocd + 10), MAX_ENTRIES);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== CENTRAL_SIGNATURE) return null;
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const next = offset + 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
    if (zip.toString("utf8", offset + 46, offset + 46 + nameLength) === name) {
      const local = zip.readUInt32LE(offset + 42);
      if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL_SIGNATURE) return null;
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(start, start + compressedSize);
      if (method === 0) return raw.length <= maxBytes ? Buffer.from(raw) : null;
      if (method !== 8) return null;
      return inflateRawSync(raw, { maxOutputLength: maxBytes });
    }
    offset = next;
  }
  return null;
}

function attribute(tag: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

/** Object elements in a flat (single-XML) ODF document: `<draw:object>` and `<draw:object-ole>`. */
function flatOdfObjects(buffer: Buffer): string[] | null {
  const head = buffer.toString("utf8", 0, Math.min(buffer.length, 4096));
  if (!/<office:document[\s>]/.test(head)) return null;
  const count = buffer.toString("utf8").match(/<draw:object(?:-ole)?[\s>/]/g)?.length ?? 0;
  return Array.from({ length: count }, (_, index) => `inline object ${index + 1}`);
}

/**
 * The objects an OpenDocument file embeds: package paths from a zipped
 * package's manifest, or one entry per object element of a flat document.
 * Empty when it embeds none; null when neither can be read.
 */
export function odfEmbeddedObjects(input: Uint8Array): string[] | null {
  const buffer = toBuffer(input);
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== LOCAL_SIGNATURE) return flatOdfObjects(buffer);
  let manifest: Buffer | null;
  try {
    manifest = readZipEntry(buffer, MANIFEST, MAX_MANIFEST_BYTES);
  } catch {
    return null;
  }
  if (!manifest) return null;
  const objects: string[] = [];
  for (const [tag] of manifest.toString("utf8").matchAll(/<manifest:file-entry\b[^>]*>/g)) {
    const path = attribute(tag, "manifest:full-path");
    const mediaType = attribute(tag, "manifest:media-type");
    if (path && path !== "/" && mediaType && OBJECT_MEDIA_TYPE.test(mediaType)) objects.push(path);
  }
  return objects;
}

/** True when an OpenDocument file embeds at least one object. */
export function hasOdfEmbeddedObjects(input: Uint8Array): boolean {
  return (odfEmbeddedObjects(input)?.length ?? 0) > 0;
}
