// Strict parse and schema diagnostics (PR-3b-1, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.1 steps 1-2, §7.2 (findings as data), §9.1 (element ids); plan:
// docs/superpowers/plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md
// (PR-3b-1). Failing before: parse.ts, diagnostics.ts and element-ids.ts did
// not exist.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { describe, expect, it } from "vitest";

import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { listWorkShapes, type WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import { serializeStableJson } from "../../../scripts/registry-generator-support";
import { decompile } from "./decompile";
import {
  GPP_DOCUMENT_ELEMENT_ID,
  GPP_PARSE_CODES,
  GPP_RULE_IDS,
  GPP_SCHEMA_CODES,
  sortDiagnostics,
  toJsonPointer,
  type GppDiagnostic,
} from "./diagnostics";
import { parseShapeDocument, parseStrictJson } from "./parse";

const WORKED_EXAMPLE_TEXT = readFileSync(
  join(__dirname, "__fixtures__", "inquiry-response-watch.worked-example.gpp.json"),
  "utf8",
);
const WORKED_EXAMPLE = JSON.parse(WORKED_EXAMPLE_TEXT) as Record<string, unknown>;
const SHAPE_ID = "shape:inquiry-response-watch@1.0.0";

const ALL_DEFINITIONS: readonly WorkShapeDefinition[] = [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS];
const CASES = ALL_DEFINITIONS.map((definition) => [`${definition.key}@${definition.version}`, definition] as const);

function failure(text: string): GppDiagnostic[] {
  const result = parseShapeDocument(text);
  expect(result.accepted, JSON.stringify(result.diagnostics)).toBe(false);
  return result.diagnostics;
}

/** Inserts `insertion` immediately after the first occurrence of `anchor` in `text`. */
function insertAfter(text: string, anchor: string, insertion: string): string {
  const at = text.indexOf(anchor);
  expect(at, `anchor ${anchor}`).toBeGreaterThanOrEqual(0);
  return `${text.slice(0, at + anchor.length)}${insertion}${text.slice(at + anchor.length)}`;
}

/** A deep copy with `value` written at `path` (the last segment created if absent). */
function withValue(document: unknown, path: Array<string | number>, value: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(document)) as Record<string | number, unknown>;
  let node: Record<string | number, unknown> = copy;
  for (const segment of path.slice(0, -1)) node = node[segment] as Record<string | number, unknown>;
  node[path[path.length - 1]] = value;
  return copy;
}

describe("parse accepts every registered shape's document", () => {
  it("covers the whole registry", () => {
    expect(CASES.length).toBe(listWorkShapes().length + WORK_SHAPE_PRIOR_VERSIONS.length);
    expect(CASES.length).toBeGreaterThan(0);
  });

  it.each(CASES)("%s: canonical JSON and stable pretty JSON both parse to the decompiled document", (_id, definition) => {
    const { document } = decompile(definition);
    for (const text of [canonicalJson(document), serializeStableJson(document)]) {
      const result = parseShapeDocument(text);
      expect(result.diagnostics).toEqual([]);
      expect(result.accepted).toBe(true);
      if (result.accepted) expect(canonicalJson(result.document)).toBe(canonicalJson(document));
    }
  });

  it("the spec §4.5 worked example, as committed, parses", () => {
    const result = parseShapeDocument(WORKED_EXAMPLE_TEXT);
    expect(result.diagnostics).toEqual([]);
    expect(result.accepted).toBe(true);
  });
});

describe("strict text: BOM, CRLF, trailing content, empty", () => {
  it("a BOM is a PARSE/BOM error on the whole document", () => {
    expect(failure(`﻿${WORKED_EXAMPLE_TEXT}`)).toEqual([
      expect.objectContaining({ rule: "PARSE", code: "PARSE/BOM", severity: "error", elementId: GPP_DOCUMENT_ELEMENT_ID, path: "" }),
    ]);
  });

  it("CRLF line endings are a PARSE/CRLF error naming the first line", () => {
    const [diagnostic, ...rest] = failure(WORKED_EXAMPLE_TEXT.replace(/\n/g, "\r\n"));
    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({ rule: "PARSE", code: "PARSE/CRLF", severity: "error", elementId: GPP_DOCUMENT_ELEMENT_ID, path: "" });
    expect(diagnostic.message).toContain("first on line 1");
  });

  it("a single lone carriage return is refused too", () => {
    const text = insertAfter(WORKED_EXAMPLE_TEXT, '"version": "1.0.0",', "\r");
    expect(failure(text).map((diagnostic) => diagnostic.code)).toEqual(["PARSE/CRLF"]);
  });

  it("content after the top-level value is PARSE/TRAILING-CONTENT; a trailing newline is not", () => {
    expect(failure(`${WORKED_EXAMPLE_TEXT}{}`).map((diagnostic) => diagnostic.code)).toEqual(["PARSE/TRAILING-CONTENT"]);
    expect(failure(`${WORKED_EXAMPLE_TEXT.trimEnd()} x`).map((diagnostic) => diagnostic.code)).toEqual(["PARSE/TRAILING-CONTENT"]);
    expect(parseShapeDocument(`${WORKED_EXAMPLE_TEXT.trimEnd()}\n\n`).accepted).toBe(true);
  });

  it("an empty or whitespace-only text is PARSE/EMPTY", () => {
    expect(failure("").map((diagnostic) => diagnostic.code)).toEqual(["PARSE/EMPTY"]);
    expect(failure(" \n\t").map((diagnostic) => diagnostic.code)).toEqual(["PARSE/EMPTY"]);
  });

  it("invalid JSON is PARSE/SYNTAX with line, column and the path where a value was expected", () => {
    const text = insertAfter(WORKED_EXAMPLE_TEXT, '"evidence": ["draft-artifact"', ",");
    const [diagnostic, ...rest] = failure(text);
    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({ rule: "PARSE", code: "PARSE/SYNTAX", path: "/stages/0/evidence/1" });
    expect(diagnostic.message).toMatch(/^Line \d+, column \d+: /);
  });
});

describe("duplicate keys are found at every level", () => {
  it("a duplicate key is a PARSE error naming its JSON Pointer and nearest element", () => {
    const text = insertAfter(WORKED_EXAMPLE_TEXT, '"title": "Draft a grounded reply",', '\n      "title": "Draft it twice",');
    const [diagnostic, ...rest] = failure(text);
    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({
      rule: "PARSE",
      code: "PARSE/DUPLICATE-KEY",
      severity: "error",
      elementId: "stage:draft",
      path: "/stages/0/title",
    });
    expect(diagnostic.message).toMatch(/^Line 12, column 7: duplicate key "title"/);
  });

  it("at the root, inside a gate and inside a stop", () => {
    let text = insertAfter(WORKED_EXAMPLE_TEXT, '"version": "1.0.0",', '\n  "version": "1.0.0",');
    text = insertAfter(text, '"mode": "enforced",', ' "mode": "shadow",');
    text = insertAfter(text, '{ "kind": "failure",', ' "kind": "failure",');
    expect(failure(text).map(({ code, elementId, path }) => ({ code, elementId, path }))).toEqual([
      { code: "PARSE/DUPLICATE-KEY", elementId: "gate:send", path: "/stages/1/advance/gate/mode" },
      { code: "PARSE/DUPLICATE-KEY", elementId: SHAPE_ID, path: "/version" },
      { code: "PARSE/DUPLICATE-KEY", elementId: "stop:failure:1", path: "/stopConditions/1/kind" },
    ]);
  });

  it("keys are compared after decoding, so an escaped spelling is still a duplicate", () => {
    const text = insertAfter(WORKED_EXAMPLE_TEXT, '"version": "1.0.0",', '\n  "\\u0076ersion": "9.9.9",');
    expect(failure(text)).toEqual([expect.objectContaining({ code: "PARSE/DUPLICATE-KEY", path: "/version" })]);
  });

  it("the same key in two different objects is not a duplicate", () => {
    // Every stage has `key` and `title`; the document root has them too.
    expect(parseShapeDocument(WORKED_EXAMPLE_TEXT).accepted).toBe(true);
  });

  it("a key containing / or ~ is escaped in the pointer (RFC 6901)", () => {
    expect(failure('{"a/b~c": 1, "a/b~c": 2}')).toEqual([
      expect.objectContaining({ code: "PARSE/DUPLICATE-KEY", path: "/a~1b~0c", elementId: GPP_DOCUMENT_ELEMENT_ID }),
    ]);
  });

  it("a BOM, CRLF and a duplicate key in one text are all reported, in sorted order", () => {
    const duplicated = insertAfter(WORKED_EXAMPLE_TEXT, '"title": "Send the reply",', ' "title": "Send",');
    const diagnostics = failure(`﻿${duplicated.replace(/\n/g, "\r\n")}`);
    expect(diagnostics.map((diagnostic) => diagnostic.code).sort()).toEqual(["PARSE/BOM", "PARSE/CRLF", "PARSE/DUPLICATE-KEY"]);
    expect(diagnostics).toEqual(sortDiagnostics(diagnostics));
    expect(diagnostics.find((diagnostic) => diagnostic.code === "PARSE/DUPLICATE-KEY")).toMatchObject({
      elementId: "stage:send",
      path: "/stages/1/title",
    });
  });
});

describe("the recognizer accepts exactly what JSON.parse accepts", () => {
  const SAMPLES = [
    "{}", "[]", '""', "0", "-0", "1.5e-3", "-12E+4", "true", "false", "null", '"\\u00e9\\n\\/"', '"\\ud800"',
    '{"a":[1,{"b":null}],"c":"d"}', " [ 1 , 2 ] ", "01", "1.", ".5", "+1", "-", "[1,]", '{"a":1,}', "{a:1}",
    "'x'", '"\\x"', '"\\u12"', "tru", "nul", "[", '{"a"', '{"a":}', '"abc', "[1 2]", '"tab\there"', "NaN", "Infinity",
    '{"a":1}{', '[1]]',
  ];
  it.each(SAMPLES)("%s", (sample) => {
    let accepted = true;
    try {
      JSON.parse(sample);
    } catch {
      accepted = false;
    }
    expect(parseStrictJson(sample).accepted).toBe(accepted);
  });
});

describe("schema findings land on the nearest derived element", () => {
  it.each([
    [[], SHAPE_ID, ""],
    [["stages", 0], "stage:draft", "/stages/0"],
    [["stages", 1, "advance", "gate"], "gate:send", "/stages/1/advance/gate"],
    [["stopConditions", 1], "stop:failure:1", "/stopConditions/1"],
    [["reviewPoint"], SHAPE_ID, "/reviewPoint"],
  ] as const)("an unknown field under %j is SCHEMA/unrecognized_keys on %s", (at, elementId, pointer) => {
    const text = JSON.stringify(withValue(WORKED_EXAMPLE, [...at, "colour"], "blue"));
    expect(failure(text)).toEqual([
      {
        rule: "SCHEMA",
        code: "SCHEMA/unrecognized_keys",
        severity: "error",
        elementId,
        path: `${pointer}/colour`,
        message: 'Unknown field "colour".',
      },
    ]);
  });

  it("an invalid tool name lands on its own capability chip", () => {
    const text = JSON.stringify(withValue(WORKED_EXAMPLE, ["stages", 0, "tools", 1], "Not A Tool"));
    expect(failure(text)).toEqual([
      expect.objectContaining({ code: "SCHEMA/invalid_format", elementId: "tool:draft:Not A Tool", path: "/stages/0/tools/1" }),
    ]);
  });

  it("an invalid shape key has no shape element, so it lands on the document", () => {
    const text = JSON.stringify(withValue(WORKED_EXAMPLE, ["key"], 7));
    expect(failure(text)).toEqual([
      expect.objectContaining({ code: "SCHEMA/invalid_type", elementId: GPP_DOCUMENT_ELEMENT_ID, path: "/key" }),
    ]);
  });

  it("a duplicate tool fails the set refine on the stage's tools", () => {
    const text = JSON.stringify(withValue(WORKED_EXAMPLE, ["stages", 0, "tools"], ["list_customer_accounts", "list_customer_accounts"]));
    expect(failure(text)).toEqual([expect.objectContaining({ code: "SCHEMA/custom", elementId: "stage:draft", path: "/stages/0/tools" })]);
  });

  it("several findings come back sorted and identical on every run", () => {
    let value = withValue(WORKED_EXAMPLE, ["stopConditions", 2, "disposition"], "maybe");
    value = withValue(value, ["stages", 1, "advance", "gate", "mode"], "loud");
    value = withValue(value, ["zeta"], 1);
    const text = JSON.stringify(value);
    const first = failure(text);
    expect(first.length).toBe(3);
    expect(first).toEqual(sortDiagnostics(first));
    expect(failure(text)).toEqual(first);
    expect(first.map((diagnostic) => diagnostic.elementId)).toEqual(["gate:send", SHAPE_ID, "stop:budget:1"]);
  });
});

describe("diagnostic vocabulary", () => {
  it("every PARSE and SCHEMA code is namespaced by its rule, and the rule ids are distinct", () => {
    expect(GPP_PARSE_CODES.every((code) => code.startsWith("PARSE/"))).toBe(true);
    expect(GPP_SCHEMA_CODES.every((code) => code.startsWith("SCHEMA/"))).toBe(true);
    expect(new Set(GPP_RULE_IDS).size).toBe(GPP_RULE_IDS.length);
    expect(GPP_RULE_IDS).toEqual(expect.arrayContaining(["PARSE", "SCHEMA", "C-1", "C-9", "S-6", "D-8", "E-NOT-EXECUTABLE", "W-ORPHAN-LAYOUT"]));
  });

  it("toJsonPointer follows RFC 6901", () => {
    expect(toJsonPointer([])).toBe("");
    expect(toJsonPointer(["stages", 0, "a/b", "m~n"])).toBe("/stages/0/a~1b/m~0n");
  });
});
