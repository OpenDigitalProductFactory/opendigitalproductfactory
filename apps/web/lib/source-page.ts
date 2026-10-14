import { createHash } from "node:crypto";
import {
  SOURCE_READ_DEFAULT_MAX_CHARS as DEFAULT_READ_MAX_CHARS,
  SOURCE_READ_DEFAULT_MAX_LINES as DEFAULT_READ_MAX_LINES,
  SOURCE_READ_MAX_CHARS as MAX_READ_CHARS,
  SOURCE_READ_MAX_LINES as MAX_READ_LINES,
} from "./source-page-lines";
type ReadCursor = { v: 1; offset: number; binding: string };
type SourcePage = {
  path: string;
  version: string;
  blobId: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  /** Whole-artifact size, so a bounded reviewer can size its read budget (BI-E8237EAE). */
  totalChars: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function blobBinding(ref: string, path: string, blobId: string): string {
  return createHash("sha256").update(`${ref}\0${path}\0${blobId}`).digest("hex");
}

function encodeReadCursor(cursor: ReadCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeReadCursor(value: unknown, binding: string): ReadCursor | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ReadCursor>;
    return parsed.v === 1
      && Number.isSafeInteger(parsed.offset)
      && (parsed.offset ?? -1) >= 0
      && parsed.binding === binding
      ? parsed as ReadCursor
      : null;
  } catch {
    return null;
  }
}

function countSourceLines(content: string): number {
  if (content.length === 0) return 0;
  const newlines = content.match(/\n/g)?.length ?? 0;
  return newlines + (content.endsWith("\n") ? 0 : 1);
}

function offsetForLine(content: string, line: number): number | null {
  if (line <= 1) return 0;
  let current = 1;
  for (let index = 0; index < content.length; index++) {
    if (content[index] !== "\n") continue;
    current++;
    if (current === line) return index + 1;
  }
  return null;
}

function lineAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < Math.min(offset, content.length); index++) {
    if (content[index] === "\n") line++;
  }
  return line;
}

function endOffsetForLines(content: string, offset: number, maxLines: number): number {
  let lines = 0;
  for (let index = offset; index < content.length; index++) {
    if (content[index] !== "\n") continue;
    lines++;
    if (lines === maxLines) return index + 1;
  }
  return content.length;
}

export function pageSource(input: {
  content: string;
  ref: string;
  path: string;
  blobId: string;
  cursor?: unknown;
  startLine?: unknown;
  maxLines?: unknown;
  maxChars?: unknown;
}): { error: string } | SourcePage {
  const binding = blobBinding(input.ref, input.path, input.blobId);
  const decoded = input.cursor === undefined ? null : decodeReadCursor(input.cursor, binding);
  if (input.cursor !== undefined && !decoded) return { error: "invalid_cursor" };
  const requestedLine = boundedInteger(input.startLine, 1, 1, Number.MAX_SAFE_INTEGER);
  const startOffset = decoded?.offset ?? offsetForLine(input.content, requestedLine);
  if (startOffset === null || startOffset > input.content.length) return { error: "invalid_source_range" };
  const maxLines = boundedInteger(input.maxLines, DEFAULT_READ_MAX_LINES, 1, MAX_READ_LINES);
  const maxChars = boundedInteger(input.maxChars, DEFAULT_READ_MAX_CHARS, 1, MAX_READ_CHARS);
  const endOffset = Math.min(
    input.content.length,
    startOffset + maxChars,
    endOffsetForLines(input.content, startOffset, maxLines),
  );
  const content = input.content.slice(startOffset, endOffset);
  const startLine = lineAtOffset(input.content, startOffset);
  const newlineCount = content.match(/\n/g)?.length ?? 0;
  const endLine = content.length === 0
    ? Math.max(0, startLine - 1)
    : startLine + newlineCount - (content.endsWith("\n") ? 1 : 0);
  const hasMore = endOffset < input.content.length;
  return {
    path: input.path,
    version: input.ref,
    blobId: input.blobId,
    content,
    startLine,
    endLine,
    totalLines: countSourceLines(input.content),
    totalChars: input.content.length,
    hasMore,
    nextCursor: hasMore
      ? encodeReadCursor({ v: 1, offset: endOffset, binding })
      : null,
  };
}

