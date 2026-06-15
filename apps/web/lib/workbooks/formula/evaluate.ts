// Universal Grid & Workbooks — formula evaluator (EP-GRID-WORKBOOKS, Phase 2)
//
// Parses an Excel-style expression with jsep (a tiny, dependency-free parser) and
// walks the resulting AST against a row scope. Only literals, operators, and names
// in FORMULA_FUNCTIONS are honored — there is no `eval`/`new Function`, no member
// access, and no way to reach arbitrary globals, so a user formula can never run
// code. Column references resolve by normalized name (case/space/punctuation
// insensitive); `[Column Name]` bracket syntax is also accepted.

import jsep from "jsep";
import {
  FORMULA_FUNCTIONS,
  FormulaError,
  CROSS_ROW_FUNCTIONS,
  matchCriterion,
  numOrZero,
  toNumber,
  toStr,
  toBool,
  type FormulaValue,
} from "./functions";

export { FormulaError } from "./functions";
export type { FormulaValue } from "./functions";

/** Normalize a column name / identifier to a comparison key. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const CONSTANTS: Record<string, FormulaValue> = {
  true: true,
  false: false,
  null: null,
  // Excel-style booleans
  yes: true,
  no: false,
};

/**
 * Excel → jsep-friendly normalization: drop leading `=`, `<>`→`!=`, `=`→`==`,
 * `[Name]`→name. Transforms are applied only OUTSIDE string literals, so an
 * operator inside a quoted criterion (e.g. COUNTIF([H], "<>5") or "=done") is
 * preserved verbatim rather than being rewritten into the comparison operator.
 */
export function normalizeFormulaSource(src: string): string {
  let s = src.trim();
  if (s.startsWith("=")) s = s.slice(1);

  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }

    // [Column Name] → normalized identifier
    if (ch === "[") {
      const end = s.indexOf("]", i);
      if (end > i) {
        out += normalizeName(s.slice(i + 1, end));
        i = end;
        continue;
      }
    }
    // <> → !=
    if (ch === "<" && s[i + 1] === ">") {
      out += "!=";
      i++;
      continue;
    }
    // single = (not part of <=, >=, ==, !=) → ==
    if (ch === "=" && s[i + 1] !== "=" && !["<", ">", "=", "!"].includes(s[i - 1])) {
      out += "==";
      continue;
    }
    out += ch;
  }
  return out;
}

type Node = {
  type: string;
  value?: unknown;
  name?: string;
  operator?: string;
  left?: Node;
  right?: Node;
  argument?: Node;
  prefix?: boolean;
  test?: Node;
  consequent?: Node;
  alternate?: Node;
  callee?: Node;
  arguments?: Node[];
  elements?: Node[];
};

function applyBinary(op: string, l: FormulaValue, r: FormulaValue): FormulaValue {
  switch (op) {
    case "+":
      return toNumber(l) + toNumber(r);
    case "-":
      return toNumber(l) - toNumber(r);
    case "*":
      return toNumber(l) * toNumber(r);
    case "/": {
      const d = toNumber(r);
      if (d === 0) throw new FormulaError("Division by zero");
      return toNumber(l) / d;
    }
    case "%":
      return toNumber(l) % toNumber(r);
    case "&": // Excel string concatenation
      return toStr(l) + toStr(r);
    case "==":
      return toStr(l) === toStr(r);
    case "!=":
      return toStr(l) !== toStr(r);
    case "<":
      return toNumber(l) < toNumber(r);
    case ">":
      return toNumber(l) > toNumber(r);
    case "<=":
      return toNumber(l) <= toNumber(r);
    case ">=":
      return toNumber(l) >= toNumber(r);
    default:
      throw new FormulaError(`Unsupported operator: ${op}`);
  }
}

/** Evaluation context: the current row's values, plus (for cross-row functions) every column's full array. */
export interface EvalContext {
  /** normalized column name -> the current row's value */
  scope: Map<string, FormulaValue>;
  /** normalized column name -> all rows' values, in row order (only set on the dataset path) */
  columns?: Map<string, FormulaValue[]>;
  /**
   * Resolve REF([col]) / LOOKUP([col], field) for the current row against a
   * `reference` column: `field` omitted → the reference's display label (REF);
   * `field` given → that field of the referenced record (LOOKUP). Set only when
   * referenced records have been fetched.
   */
  resolveRef?: (columnName: string, field?: string) => FormulaValue;
}

/** Resolve a cross-row function's range argument (must be a bare column reference) to its full column array. */
function columnArray(fnName: string, argNode: Node | undefined, ctx: EvalContext): FormulaValue[] {
  if (!argNode || argNode.type !== "Identifier" || !argNode.name) {
    throw new FormulaError(`${fnName} range must be a column reference`);
  }
  const key = normalizeName(argNode.name);
  const arr = ctx.columns?.get(key);
  if (!arr) throw new FormulaError(`${fnName} range refers to an unknown column: ${argNode.name}`);
  return arr;
}

/** Evaluate COUNTIF / SUMIF / AVERAGEIF over the dataset's column arrays. */
function evalCrossRow(fnName: string, args: Node[], ctx: EvalContext): FormulaValue {
  if (!ctx.columns) {
    throw new FormulaError(`${fnName} can only be used in a table context`);
  }
  const range = columnArray(fnName, args[0], ctx);
  const criterion = args[1] ? evalNode(args[1], ctx) : null;
  const matches = (i: number) => matchCriterion(range[i] ?? null, criterion);

  if (fnName === "COUNTIF") {
    let n = 0;
    for (let i = 0; i < range.length; i++) if (matches(i)) n++;
    return n;
  }

  // SUMIF / AVERAGEIF: optional third arg is the column to sum/average (defaults to the range column).
  const valueArr = args[2] ? columnArray(fnName, args[2], ctx) : range;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < range.length; i++) {
    if (!matches(i)) continue;
    sum += numOrZero(valueArr[i] ?? null);
    count++;
  }
  if (fnName === "SUMIF") return sum;
  return count === 0 ? 0 : sum / count; // AVERAGEIF — empty match averages to 0 (never #DIV/0!)
}

/** Evaluate REF([col]) / LOOKUP([col], "field") against the current row's reference columns. */
function evalRefLookup(fnName: string, args: Node[], ctx: EvalContext): FormulaValue {
  if (!ctx.resolveRef) {
    throw new FormulaError(`${fnName} can only be used in a table context`);
  }
  const colNode = args[0];
  if (!colNode || colNode.type !== "Identifier" || !colNode.name) {
    throw new FormulaError(`${fnName} first argument must be a reference column`);
  }
  const colName = normalizeName(colNode.name);
  if (fnName === "REF") return ctx.resolveRef(colName);
  if (!args[1]) throw new FormulaError("LOOKUP requires a field name as the second argument");
  const field = toStr(evalNode(args[1], ctx));
  return ctx.resolveRef(colName, field);
}

function evalNode(node: Node, ctx: EvalContext): FormulaValue {
  switch (node.type) {
    case "Literal":
      return (node.value ?? null) as FormulaValue;

    case "Identifier": {
      const key = normalizeName(node.name ?? "");
      if (ctx.scope.has(key)) return ctx.scope.get(key) ?? null;
      if (key in CONSTANTS) return CONSTANTS[key];
      throw new FormulaError(`Unknown field or name: ${node.name}`);
    }

    case "UnaryExpression": {
      const v = evalNode(node.argument as Node, ctx);
      if (node.operator === "-") return -toNumber(v);
      if (node.operator === "+") return toNumber(v);
      if (node.operator === "!") return !toBool(v);
      throw new FormulaError(`Unsupported unary operator: ${node.operator}`);
    }

    case "BinaryExpression":
      return applyBinary(
        node.operator as string,
        evalNode(node.left as Node, ctx),
        evalNode(node.right as Node, ctx),
      );

    case "LogicalExpression": {
      const left = evalNode(node.left as Node, ctx);
      if (node.operator === "&&") return toBool(left) ? evalNode(node.right as Node, ctx) : false;
      if (node.operator === "||") return toBool(left) ? true : evalNode(node.right as Node, ctx);
      throw new FormulaError(`Unsupported logical operator: ${node.operator}`);
    }

    case "ConditionalExpression":
      return toBool(evalNode(node.test as Node, ctx))
        ? evalNode(node.consequent as Node, ctx)
        : evalNode(node.alternate as Node, ctx);

    case "CallExpression": {
      const callee = node.callee as Node;
      if (callee.type !== "Identifier" || !callee.name) {
        throw new FormulaError("Only named function calls are allowed");
      }
      const fnName = callee.name.toUpperCase();
      if (CROSS_ROW_FUNCTIONS.has(fnName)) {
        return evalCrossRow(fnName, node.arguments ?? [], ctx);
      }
      if (fnName === "REF" || fnName === "LOOKUP") {
        return evalRefLookup(fnName, node.arguments ?? [], ctx);
      }
      const fn = FORMULA_FUNCTIONS[fnName];
      if (!fn) throw new FormulaError(`Unknown function: ${callee.name}`);
      const args = (node.arguments ?? []).map((a) => evalNode(a, ctx));
      return fn(args);
    }

    case "ArrayExpression":
      // Arrays are only meaningful as call args; flatten to first element otherwise.
      throw new FormulaError("Array literals are not supported");

    case "MemberExpression":
      throw new FormulaError("Property access is not supported");

    case "Compound":
      throw new FormulaError("A formula must be a single expression");

    default:
      throw new FormulaError(`Unsupported expression: ${node.type}`);
  }
}

export interface FormulaResult {
  ok: boolean;
  value: FormulaValue;
  error?: string;
}

/**
 * Evaluate a formula against a scope of column values (keyed by normalized name).
 * Pass `columns` (normalized name -> all rows' values) to enable cross-row
 * functions (COUNTIF/SUMIF/AVERAGEIF); omit it for pure per-row evaluation.
 * Returns a structured result — a bad formula yields { ok:false } with the message,
 * never throws, so one broken cell can't crash a grid load.
 */
export function evaluateFormula(
  formula: string,
  scope: Map<string, FormulaValue>,
  columns?: Map<string, FormulaValue[]>,
  resolveRef?: EvalContext["resolveRef"],
): FormulaResult {
  try {
    const normalized = normalizeFormulaSource(formula);
    if (!normalized) return { ok: true, value: null };
    const ast = jsep(normalized) as unknown as Node;
    return { ok: true, value: evalNode(ast, { scope, columns, resolveRef }) };
  } catch (e) {
    return { ok: false, value: null, error: e instanceof Error ? e.message : "Formula error" };
  }
}
