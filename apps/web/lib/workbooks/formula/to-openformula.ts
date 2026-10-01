// Workbook formula -> OpenFormula (BI-4865EB4D, slice S5 of BI-815D40C6).
//
// A Workbook formula is an Excel-style expression over the columns of one row
// (evaluate.ts). An exported spreadsheet should carry the formula itself, not
// only its value, so the file still calculates when someone edits it. This
// translates the same parsed expression (normalizeFormulaSource + jsep, as the
// evaluator does) into ODF OpenFormula with same-row cell references; the
// engine then writes it as an .xlsx or .ods formula.
//
// It translates only what maps one to one. Anything else (cross-row COUNTIF /
// SUMIF / AVERAGEIF over the platform's row set, REF / LOOKUP over platform
// records, date helpers whose argument types differ, an unknown column) returns
// null, and the exporter writes the computed value alone: a value that is right
// beats a formula that recalculates to something else.

import jsep from "jsep";
import { normalizeFormulaSource, normalizeName } from "./evaluate";

type Node = {
  type: string;
  value?: unknown;
  name?: string;
  operator?: string;
  left?: Node;
  right?: Node;
  argument?: Node;
  test?: Node;
  consequent?: Node;
  alternate?: Node;
  callee?: Node;
  arguments?: Node[];
};

/** Workbook functions with an identical OpenFormula function (name mapped where it differs). */
const FUNCTIONS: Readonly<Record<string, string>> = {
  IF: "IF",
  AND: "AND",
  OR: "OR",
  NOT: "NOT",
  SUM: "SUM",
  AVERAGE: "AVERAGE",
  MIN: "MIN",
  MAX: "MAX",
  ROUND: "ROUND",
  ABS: "ABS",
  LEN: "LEN",
  TRIM: "TRIM",
  LOWER: "LOWER",
  UPPER: "UPPER",
  LEFT: "LEFT",
  RIGHT: "RIGHT",
  MID: "MID",
  SUBSTITUTE: "SUBSTITUTE",
  CONCAT: "CONCATENATE",
  CONCATENATE: "CONCATENATE",
};

const BINARY: Readonly<Record<string, string>> = {
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
  "&": "&",
  "==": "=",
  "!=": "<>",
  "<": "<",
  ">": ">",
  "<=": "<=",
  ">=": ">=",
};

// Binding strength, so the output is parenthesised only where the input was.
const PRECEDENCE: Readonly<Record<string, number>> = {
  "==": 1, "!=": 1, "<": 1, ">": 1, "<=": 1, ">=": 1,
  "&": 2,
  "+": 3, "-": 3,
  "*": 4, "/": 4,
};

const CONSTANTS: Readonly<Record<string, string>> = { true: "TRUE()", false: "FALSE()", yes: "TRUE()", no: "FALSE()" };

class Untranslatable extends Error {}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function stringLiteral(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function emit(node: Node, ctx: { columns: ReadonlyMap<string, number>; row: number }, parentPrecedence = 0): string {
  switch (node.type) {
    case "Literal": {
      if (typeof node.value === "number" && Number.isFinite(node.value)) return String(node.value);
      if (typeof node.value === "string") return stringLiteral(node.value);
      if (typeof node.value === "boolean") return node.value ? "TRUE()" : "FALSE()";
      throw new Untranslatable("literal");
    }
    case "Identifier": {
      const key = normalizeName(node.name ?? "");
      const index = ctx.columns.get(key);
      if (index !== undefined) return `[.${columnLetter(index)}${ctx.row}]`;
      const constant = CONSTANTS[key];
      if (constant) return constant;
      throw new Untranslatable(`unknown name ${node.name}`);
    }
    case "UnaryExpression": {
      const inner = emit(node.argument!, ctx, 5);
      if (node.operator === "-" || node.operator === "+") return `${node.operator}${inner}`;
      if (node.operator === "!") return `NOT(${emit(node.argument!, ctx)})`;
      throw new Untranslatable("unary");
    }
    case "BinaryExpression": {
      const op = node.operator ?? "";
      if (op === "%") return `MOD(${emit(node.left!, ctx)};${emit(node.right!, ctx)})`;
      const mapped = BINARY[op];
      const precedence = PRECEDENCE[op];
      if (!mapped || precedence === undefined) throw new Untranslatable(`operator ${op}`);
      // Left-associative: the right operand needs parentheses at equal strength.
      const text = `${emit(node.left!, ctx, precedence)}${mapped}${emit(node.right!, ctx, precedence + 0.5)}`;
      return precedence < parentPrecedence ? `(${text})` : text;
    }
    case "LogicalExpression": {
      const fn = node.operator === "&&" ? "AND" : node.operator === "||" ? "OR" : null;
      if (!fn) throw new Untranslatable("logical");
      return `${fn}(${emit(node.left!, ctx)};${emit(node.right!, ctx)})`;
    }
    case "ConditionalExpression":
      return `IF(${emit(node.test!, ctx)};${emit(node.consequent!, ctx)};${emit(node.alternate!, ctx)})`;
    case "CallExpression": {
      const callee = node.callee;
      const name = callee?.type === "Identifier" ? FUNCTIONS[(callee.name ?? "").toUpperCase()] : undefined;
      if (!name) throw new Untranslatable("function");
      return `${name}(${(node.arguments ?? []).map((arg) => emit(arg, ctx)).join(";")})`;
    }
    default:
      throw new Untranslatable(node.type);
  }
}

/**
 * The OpenFormula (`of:=...`) for a Workbook formula evaluated on sheet row
 * `row` (1-based), with `columns` mapping each normalized column name to its
 * 0-based sheet column. Null when the formula cannot be expressed faithfully.
 */
export function toOpenFormula(
  formula: string,
  ctx: { columns: ReadonlyMap<string, number>; row: number },
): string | null {
  try {
    const source = normalizeFormulaSource(formula);
    if (!source) return null;
    return `of:=${emit(jsep(source) as unknown as Node, ctx)}`;
  } catch {
    return null;
  }
}
