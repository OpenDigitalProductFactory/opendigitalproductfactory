// Universal Grid & Workbooks — static formula check (BI-FE8DF004).
//
// The evaluator (./evaluate) never throws on a bad formula: it yields an error
// value per cell so one broken cell can't crash a grid load. That is right on
// READ, but it means a column with a misspelt name saves "successfully" and shows
// errors in every row. This check runs on WRITE, before a formula column is
// created: it parses with the same normalization and walks the AST against the
// same rules (column names, constants, the function set), without evaluating.

import jsep from "jsep";
import { FORMULA_CONSTANT_NAMES, normalizeFormulaSource, normalizeName } from "./evaluate";
import { CROSS_ROW_FUNCTIONS, FORMULA_FUNCTIONS } from "./functions";

type Node = {
  type: string;
  name?: string;
  argument?: Node;
  left?: Node;
  right?: Node;
  test?: Node;
  consequent?: Node;
  alternate?: Node;
  callee?: Node;
  arguments?: Node[];
};

const REFERENCE_FUNCTIONS = new Set(["REF", "LOOKUP"]);

function isKnownFunction(name: string): boolean {
  const upper = name.toUpperCase();
  return upper in FORMULA_FUNCTIONS || CROSS_ROW_FUNCTIONS.has(upper) || REFERENCE_FUNCTIONS.has(upper);
}

function walk(node: Node, columns: ReadonlySet<string>): string | null {
  switch (node.type) {
    case "Literal":
      return null;
    case "Identifier": {
      const key = normalizeName(node.name ?? "");
      if (columns.has(key) || FORMULA_CONSTANT_NAMES.has(key)) return null;
      return `The formula names an unknown column: ${node.name}`;
    }
    case "UnaryExpression":
      return walk(node.argument as Node, columns);
    case "BinaryExpression":
    case "LogicalExpression":
      return walk(node.left as Node, columns) ?? walk(node.right as Node, columns);
    case "ConditionalExpression":
      return (
        walk(node.test as Node, columns) ??
        walk(node.consequent as Node, columns) ??
        walk(node.alternate as Node, columns)
      );
    case "CallExpression": {
      const callee = node.callee as Node;
      if (callee.type !== "Identifier" || !callee.name) return "Only named function calls are allowed";
      if (!isKnownFunction(callee.name)) return `The formula uses an unknown function: ${callee.name}`;
      for (const arg of node.arguments ?? []) {
        const problem = walk(arg, columns);
        if (problem) return problem;
      }
      return null;
    }
    case "MemberExpression":
      return "Property access is not supported in a formula";
    case "ArrayExpression":
      return "Array literals are not supported in a formula";
    case "Compound":
      return "A formula must be a single expression";
    default:
      return `Unsupported expression in a formula: ${node.type}`;
  }
}

/**
 * Check a formula against the names of the columns it may read. Returns null when
 * it is valid, or a message a person (or coworker) can act on.
 */
export function checkFormula(formula: string, columnNames: readonly string[]): string | null {
  const normalized = normalizeFormulaSource(formula);
  if (!normalized.trim()) return "A formula is required for a formula column";
  let ast: Node;
  try {
    ast = jsep(normalized) as unknown as Node;
  } catch (e) {
    return `The formula could not be read: ${e instanceof Error ? e.message : "syntax error"}`;
  }
  return walk(ast, new Set(columnNames.map(normalizeName)));
}
