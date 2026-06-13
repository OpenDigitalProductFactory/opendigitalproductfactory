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

/** Excel → jsep-friendly normalization: drop leading `=`, `<>`→`!=`, `=`→`==`, `[Name]`→name. */
export function normalizeFormulaSource(src: string): string {
  let s = src.trim();
  if (s.startsWith("=")) s = s.slice(1);
  s = s.replace(/\[([^\]]+)\]/g, (_m, inner: string) => normalizeName(inner));
  s = s.replace(/<>/g, "!=");
  // single `=` (not part of <=, >=, ==, !=) → `==`
  s = s.replace(/(?<![<>=!])=(?!=)/g, "==");
  return s;
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

function evalNode(node: Node, scope: Map<string, FormulaValue>): FormulaValue {
  switch (node.type) {
    case "Literal":
      return (node.value ?? null) as FormulaValue;

    case "Identifier": {
      const key = normalizeName(node.name ?? "");
      if (scope.has(key)) return scope.get(key) ?? null;
      if (key in CONSTANTS) return CONSTANTS[key];
      throw new FormulaError(`Unknown field or name: ${node.name}`);
    }

    case "UnaryExpression": {
      const v = evalNode(node.argument as Node, scope);
      if (node.operator === "-") return -toNumber(v);
      if (node.operator === "+") return toNumber(v);
      if (node.operator === "!") return !toBool(v);
      throw new FormulaError(`Unsupported unary operator: ${node.operator}`);
    }

    case "BinaryExpression":
      return applyBinary(
        node.operator as string,
        evalNode(node.left as Node, scope),
        evalNode(node.right as Node, scope),
      );

    case "LogicalExpression": {
      const left = evalNode(node.left as Node, scope);
      if (node.operator === "&&") return toBool(left) ? evalNode(node.right as Node, scope) : false;
      if (node.operator === "||") return toBool(left) ? true : evalNode(node.right as Node, scope);
      throw new FormulaError(`Unsupported logical operator: ${node.operator}`);
    }

    case "ConditionalExpression":
      return toBool(evalNode(node.test as Node, scope))
        ? evalNode(node.consequent as Node, scope)
        : evalNode(node.alternate as Node, scope);

    case "CallExpression": {
      const callee = node.callee as Node;
      if (callee.type !== "Identifier" || !callee.name) {
        throw new FormulaError("Only named function calls are allowed");
      }
      const fn = FORMULA_FUNCTIONS[callee.name.toUpperCase()];
      if (!fn) throw new FormulaError(`Unknown function: ${callee.name}`);
      const args = (node.arguments ?? []).map((a) => evalNode(a, scope));
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
 * Returns a structured result — a bad formula yields { ok:false } with the message,
 * never throws, so one broken cell can't crash a grid load.
 */
export function evaluateFormula(
  formula: string,
  scope: Map<string, FormulaValue>,
): FormulaResult {
  try {
    const normalized = normalizeFormulaSource(formula);
    if (!normalized) return { ok: true, value: null };
    const ast = jsep(normalized) as unknown as Node;
    return { ok: true, value: evalNode(ast, scope) };
  } catch (e) {
    return { ok: false, value: null, error: e instanceof Error ? e.message : "Formula error" };
  }
}
