// apps/web/lib/gpp/shape-language/diagnostics.ts
//
// Compiler findings as data. Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §7.1 (pipeline), §7.2
// ("each finding has a rule id, a severity, the element id and a message"),
// §9.1 (element ids), §13 (the AWS ValidateStateMachineDefinition diagnostic
// precedent: severity, code, message, location); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-1, BI-6DA17863).
//
// Every stage of the pipeline (parse, schema, resolve, the DRC that PR-3b-3
// adds) reports through this one type. A finding is never a thrown error and
// never free text: a caller filters on `rule` / `code`, a canvas attaches it
// to `elementId`, and a text editor jumps to `path`.
//
// - `rule` is the closed set of rule ids §7.2 names. Each id is a stable code;
//   renaming one is a breaking change for every consumer.
// - `code` refines `rule` where one rule has several distinct failures (a
//   PARSE finding is a BOM, a CRLF, a duplicate key, ...; a C-7 finding is
//   one of three clauses; an E-NOT-EXECUTABLE finding names its construct).
//   It is also closed.
// - `path` is an RFC 6901 JSON Pointer into the document text as written
//   ("" is the whole document).
// - `elementId` is the nearest §9.1 derived element id, so the same finding
//   lands on the same node in the design view and the room view.
//
// OFFLINE TOOLING in Phase 3b: nothing in the running app imports this module.

import { GPP_CONSTRUCTS, type GppConstruct } from "./executable-constructs";

/** Severities. `not-evaluated` is a check that could not run, never a pass (spec §7.2, C-5). */
export const GPP_DIAGNOSTIC_SEVERITIES = ["error", "warning", "info", "not-evaluated"] as const;
export type GppDiagnosticSeverity = (typeof GPP_DIAGNOSTIC_SEVERITIES)[number];

/** The rule ids of spec §7.2, plus PARSE and SCHEMA for pipeline steps 1 and 2. Closed. */
export const GPP_RULE_IDS = [
  "PARSE",
  "SCHEMA",
  "C-1",
  "C-2",
  "C-3",
  "C-4",
  "C-5",
  "C-6",
  "C-7",
  "C-8",
  "C-9",
  "S-1",
  "S-2",
  "S-3",
  "S-4",
  "S-5",
  "S-6",
  "D-1",
  "D-2",
  "D-3",
  "D-4",
  "D-5",
  "D-6",
  "D-7",
  "D-8",
  // GPP Phase 3c PR-3c-5 (BI-8875C9DF): sub-shape widening and sub-shape resolution.
  "D-9",
  "D-10",
  "E-NOT-EXECUTABLE",
  "W-ORPHAN-LAYOUT",
] as const;
export type GppRuleId = (typeof GPP_RULE_IDS)[number];

/** PARSE refinements. Closed. */
export const GPP_PARSE_CODES = [
  "PARSE/BOM",
  "PARSE/CRLF",
  "PARSE/DUPLICATE-KEY",
  "PARSE/SYNTAX",
  "PARSE/TRAILING-CONTENT",
  "PARSE/EMPTY",
] as const;
export type GppParseCode = (typeof GPP_PARSE_CODES)[number];

/** SCHEMA refinements: one per Zod 4 issue code, so the mapping is total. Closed. */
export const GPP_SCHEMA_CODES = [
  "SCHEMA/invalid_type",
  "SCHEMA/too_big",
  "SCHEMA/too_small",
  "SCHEMA/invalid_format",
  "SCHEMA/not_multiple_of",
  "SCHEMA/unrecognized_keys",
  "SCHEMA/invalid_union",
  "SCHEMA/invalid_key",
  "SCHEMA/invalid_element",
  "SCHEMA/invalid_value",
  "SCHEMA/custom",
] as const;
export type GppSchemaCode = (typeof GPP_SCHEMA_CODES)[number];

/**
 * C-7 Mode honesty refinements (spec §7.2): an enforced binding with no entry
 * in GPP_BINDING_ENFORCEMENT; an enforced doctrine gate that names no
 * resolver; and the build-sandbox containment clause, which is always
 * `not-evaluated` until Build Studio is modelled (Phase 5). Closed.
 */
export const GPP_C7_CODES = ["C-7/ENFORCEMENT-ENTRY", "C-7/RESOLVER", "C-7/SANDBOX-CONTAINMENT"] as const;
export type GppC7Code = (typeof GPP_C7_CODES)[number];

/**
 * E-NOT-EXECUTABLE refinements: one per notation construct (spec §5,
 * executable-constructs.ts), so the set is total over constructs and does not
 * change when a flag flips. Closed.
 */
export const GPP_NOT_EXECUTABLE_CODES = GPP_CONSTRUCTS.map((construct) => `E-NOT-EXECUTABLE/${construct}` as const);
export type GppNotExecutableCode = `E-NOT-EXECUTABLE/${GppConstruct}`;

/** The code of a finding whose rule has a single failure mode is the rule id itself. */
export type GppDiagnosticCode =
  | GppParseCode
  | GppSchemaCode
  | GppC7Code
  | GppNotExecutableCode
  | Exclude<GppRuleId, "PARSE" | "SCHEMA" | "C-7" | "E-NOT-EXECUTABLE">;

/** The element id used when no derived element can be named (for example, the text is not JSON). */
export const GPP_DOCUMENT_ELEMENT_ID = "document";

export type GppDiagnostic = {
  rule: GppRuleId;
  code: GppDiagnosticCode;
  severity: GppDiagnosticSeverity;
  /** Nearest §9.1 derived element id, or GPP_DOCUMENT_ELEMENT_ID. */
  elementId: string;
  /** RFC 6901 JSON Pointer into the document; "" is the whole document. */
  path: string;
  message: string;
};

/** Escape one reference token per RFC 6901 §3 ("~" → "~0", "/" → "~1"). */
export function escapeJsonPointerToken(token: string | number): string {
  return String(token).replace(/~/g, "~0").replace(/\//g, "~1");
}

/** An RFC 6901 JSON Pointer for a path of keys and indexes. `[]` is "". */
export function toJsonPointer(segments: ReadonlyArray<string | number>): string {
  return segments.map((segment) => `/${escapeJsonPointerToken(segment)}`).join("");
}

function byCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Stable order: element id, then rule, then message (plan PR-3b-1), then path
 * and code as tie-breakers so two findings never compare equal unless they are
 * the same finding. Code-unit comparison, never `localeCompare`, so the order
 * does not depend on the host locale. Returns a new array.
 */
export function sortDiagnostics(diagnostics: readonly GppDiagnostic[]): GppDiagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      byCodeUnit(left.elementId, right.elementId) ||
      byCodeUnit(left.rule, right.rule) ||
      byCodeUnit(left.message, right.message) ||
      byCodeUnit(left.path, right.path) ||
      byCodeUnit(left.code, right.code),
  );
}

/** True when any finding stops emission (spec §7.2: errors stop emission). */
export function hasBlockingDiagnostic(diagnostics: readonly GppDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
