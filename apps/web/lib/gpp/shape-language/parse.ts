// apps/web/lib/gpp/shape-language/parse.ts
//
// Pipeline steps 1 and 2: strict parse, then schema. Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.1 ("strict JSON; reject duplicate keys and BOM"; "unknown fields fail");
// plan: docs/superpowers/plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md
// (PR-3b-1, BI-6DA17863).
//
// Strict means the text, not just the value, is checked:
// - A UTF-8 byte-order mark is refused (PARSE/BOM).
// - Any carriage return is refused (PARSE/CRLF): shape documents are LF only,
//   like every other checked-in text in the repo, so a compiled digest never
//   depends on the host's line endings.
// - A duplicate object key is refused (PARSE/DUPLICATE-KEY), at every level,
//   with the JSON Pointer of the duplicate. `JSON.parse` silently keeps the
//   last one, which would let two reviewers read two different documents in
//   one file. Keys are compared after decoding, so `"a"` and `"a"` are the
//   same key.
// - Anything after the top-level value is refused (PARSE/TRAILING-CONTENT).
// - Otherwise invalid JSON is PARSE/SYNTAX, with line and column.
// The duplicate-key check needs a scanner of its own because no built-in or
// existing dependency reports duplicates; it is a small RFC 8259 recognizer
// written here, so no package is added (plan, Constraints 2). The scanner only
// RECOGNIZES; values still come from `JSON.parse`, so number and escape
// semantics are the platform's, not a second implementation's.
//
// Every finding is reported (a BOM and a duplicate key in one file give two
// diagnostics), then the value is validated against gppShapeDocumentSchema and
// each Zod issue becomes a SCHEMA diagnostic on the nearest derived element
// id. Diagnostics are returned sorted (sortDiagnostics). Nothing throws.
// Results are discriminated on `accepted`, not `ok`: a refusal carries a list
// of diagnostics, not the single `error` string of the server-action
// ActionResult (lib/shared/action-result.ts), so it is a different contract.
//
// OFFLINE TOOLING in Phase 3b: nothing in the running app imports this module.

import type { z } from "zod";

import {
  GPP_DOCUMENT_ELEMENT_ID,
  sortDiagnostics,
  toJsonPointer,
  type GppDiagnostic,
  type GppParseCode,
  type GppSchemaCode,
} from "./diagnostics";
import { elementsOfValue, nearestElementId, type GppElement } from "./element-ids";
import { gppShapeDocumentSchema, type GppShapeDocument } from "./gpp-shape-schema";

export type GppJsonParseResult =
  | { accepted: true; value: unknown; diagnostics: [] }
  | { accepted: false; diagnostics: GppDiagnostic[] };

export type GppShapeParseResult =
  | { accepted: true; document: GppShapeDocument; diagnostics: [] }
  | { accepted: false; diagnostics: GppDiagnostic[] };

/** Deeper than any shape document can sensibly be; bounds the scanner's recursion. */
const MAX_DEPTH = 64;

type PathSegment = string | number;
type ZodIssue = z.ZodError["issues"][number];
type DuplicateKey = { path: PathSegment[]; line: number; column: number };

class ScanError extends Error {
  constructor(
    readonly offset: number,
    readonly path: PathSegment[],
    message: string,
  ) {
    super(message);
  }
}

/** 1-based line and column (in UTF-16 code units) of an offset. */
function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/**
 * An RFC 8259 recognizer that records duplicate keys. It accepts exactly what
 * `JSON.parse` accepts (carriage returns are treated as whitespace here; the
 * caller refuses them separately), so a text it passes always `JSON.parse`s.
 */
class StrictJsonScanner {
  private index = 0;
  readonly duplicates: DuplicateKey[] = [];

  constructor(private readonly text: string) {}

  /** Scans one value; returns the offset just past it and any trailing whitespace. */
  scanDocument(): number {
    this.skipWhitespace();
    this.scanValue([], 0);
    this.skipWhitespace();
    return this.index;
  }

  private fail(message: string, path: PathSegment[]): never {
    throw new ScanError(this.index, path, message);
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) this.index += 1;
      else break;
    }
  }

  private scanValue(path: PathSegment[], depth: number): void {
    if (depth > MAX_DEPTH) this.fail(`Nesting deeper than ${MAX_DEPTH} levels.`, path);
    const char = this.text[this.index];
    if (char === "{") return this.scanObject(path, depth);
    if (char === "[") return this.scanArray(path, depth);
    if (char === '"') {
      this.scanString(path);
      return;
    }
    if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) return this.scanNumber(path);
    for (const literal of ["true", "false", "null"]) {
      if (this.text.startsWith(literal, this.index)) {
        this.index += literal.length;
        return;
      }
    }
    this.fail(char === undefined ? "Unexpected end of input; expected a value." : `Unexpected ${JSON.stringify(char)}; expected a value.`, path);
  }

  private scanObject(path: PathSegment[], depth: number): void {
    this.index += 1; // {
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.fail("Expected a double-quoted object key.", path);
      const keyOffset = this.index;
      const key = this.scanString(path);
      if (seen.has(key)) this.duplicates.push({ path: [...path, key], ...lineAndColumn(this.text, keyOffset) });
      seen.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.fail(`Expected ":" after key ${JSON.stringify(key)}.`, path);
      this.index += 1;
      this.skipWhitespace();
      this.scanValue([...path, key], depth + 1);
      this.skipWhitespace();
      const next = this.text[this.index];
      if (next === ",") {
        this.index += 1;
        continue;
      }
      if (next === "}") {
        this.index += 1;
        return;
      }
      this.fail('Expected "," or "}" in object.', path);
    }
  }

  private scanArray(path: PathSegment[], depth: number): void {
    this.index += 1; // [
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return;
    }
    for (let position = 0; ; position += 1) {
      this.skipWhitespace();
      this.scanValue([...path, position], depth + 1);
      this.skipWhitespace();
      const next = this.text[this.index];
      if (next === ",") {
        this.index += 1;
        continue;
      }
      if (next === "]") {
        this.index += 1;
        return;
      }
      this.fail('Expected "," or "]" in array.', path);
    }
  }

  /** Scans a string token and returns its decoded value. */
  private scanString(path: PathSegment[]): string {
    const start = this.index;
    this.index += 1; // opening quote
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 0x22) {
        this.index += 1;
        return JSON.parse(this.text.slice(start, this.index)) as string;
      }
      if (code < 0x20) this.fail("Unescaped control character in string.", path);
      if (code === 0x5c) {
        const escape = this.text[this.index + 1];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(this.text.slice(this.index + 2, this.index + 6))) {
            this.fail("Invalid \\u escape in string.", path);
          }
          this.index += 6;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) this.fail("Invalid escape in string.", path);
        this.index += 2;
        continue;
      }
      this.index += 1;
    }
    this.index = start;
    return this.fail("Unterminated string.", path);
  }

  private scanNumber(path: PathSegment[]): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.index));
    if (!match) this.fail("Invalid number.", path);
    this.index += match[0].length;
  }
}

function diagnostic(
  code: GppParseCode | GppSchemaCode,
  elementId: string,
  path: PathSegment[],
  message: string,
): GppDiagnostic {
  return {
    rule: code.startsWith("PARSE/") ? "PARSE" : "SCHEMA",
    code,
    severity: "error",
    elementId,
    path: toJsonPointer(path),
    message,
  };
}

/**
 * Step 1 alone: strict JSON text → value. Exported so the layout sidecar
 * (W-ORPHAN-LAYOUT, PR-3b-3) is read under the same rules.
 */
export function parseStrictJson(text: string): GppJsonParseResult {
  const diagnostics: GppDiagnostic[] = [];
  let body = text;

  if (body.charCodeAt(0) === 0xfeff) {
    diagnostics.push(diagnostic("PARSE/BOM", GPP_DOCUMENT_ELEMENT_ID, [], "The document starts with a byte-order mark; save it as UTF-8 without a BOM."));
    body = body.slice(1);
  }

  const firstCr = body.indexOf("\r");
  if (firstCr !== -1) {
    const count = body.split("\r").length - 1;
    const { line } = lineAndColumn(body, firstCr);
    diagnostics.push(
      diagnostic(
        "PARSE/CRLF",
        GPP_DOCUMENT_ELEMENT_ID,
        [],
        `The document contains ${count} carriage return(s), first on line ${line}; shape documents use LF line endings only.`,
      ),
    );
  }

  if (body.trim() === "") {
    diagnostics.push(diagnostic("PARSE/EMPTY", GPP_DOCUMENT_ELEMENT_ID, [], "The document is empty."));
    return { accepted: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  const scanner = new StrictJsonScanner(body);
  let end: number;
  try {
    end = scanner.scanDocument();
  } catch (error) {
    if (!(error instanceof ScanError)) throw error;
    const { line, column } = lineAndColumn(body, error.offset);
    diagnostics.push(diagnostic("PARSE/SYNTAX", GPP_DOCUMENT_ELEMENT_ID, error.path, `Line ${line}, column ${column}: ${error.message}`));
    return { accepted: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  if (end < body.length) {
    const { line, column } = lineAndColumn(body, end);
    diagnostics.push(
      diagnostic("PARSE/TRAILING-CONTENT", GPP_DOCUMENT_ELEMENT_ID, [], `Line ${line}, column ${column}: content after the document's top-level value.`),
    );
    return { accepted: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  // The scanner accepted the text, so JSON.parse does too (duplicates keep the last value).
  const value: unknown = JSON.parse(body);
  if (scanner.duplicates.length > 0) {
    const elements = elementsOfValue(value);
    for (const duplicate of scanner.duplicates) {
      const key = duplicate.path[duplicate.path.length - 1];
      diagnostics.push(
        diagnostic(
          "PARSE/DUPLICATE-KEY",
          nearestElementId(elements, duplicate.path),
          duplicate.path,
          `Line ${duplicate.line}, column ${duplicate.column}: duplicate key ${JSON.stringify(key)}; JSON.parse would silently keep only the last value.`,
        ),
      );
    }
  }

  if (diagnostics.length > 0) return { accepted: false, diagnostics: sortDiagnostics(diagnostics) };
  return { accepted: true, value, diagnostics: [] };
}

/** Zod issues → SCHEMA diagnostics, each on the nearest derived element of the (invalid) value. */
export function schemaDiagnostics(value: unknown, issues: readonly ZodIssue[]): GppDiagnostic[] {
  const elements: GppElement[] = elementsOfValue(value);
  const diagnostics: GppDiagnostic[] = [];
  for (const issue of issues) {
    const path = issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment)));
    const code = `SCHEMA/${issue.code}` as GppSchemaCode;
    if (issue.code === "unrecognized_keys") {
      // One finding per unknown key, pointing AT the key, so an editor lands on it.
      for (const key of issue.keys) {
        const keyPath = [...path, key];
        diagnostics.push(diagnostic(code, nearestElementId(elements, keyPath), keyPath, `Unknown field ${JSON.stringify(key)}.`));
      }
      continue;
    }
    diagnostics.push(diagnostic(code, nearestElementId(elements, path), path, issue.message));
  }
  return diagnostics;
}

/** Steps 1 and 2: strict text → schema-valid shape document, or every finding. */
export function parseShapeDocument(text: string): GppShapeParseResult {
  const parsed = parseStrictJson(text);
  if (!parsed.accepted) return parsed;
  const result = gppShapeDocumentSchema.safeParse(parsed.value);
  if (!result.success) {
    return { accepted: false, diagnostics: sortDiagnostics(schemaDiagnostics(parsed.value, result.error.issues)) };
  }
  return { accepted: true, document: result.data, diagnostics: [] };
}
