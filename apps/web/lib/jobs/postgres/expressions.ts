/**
 * The expression subset the job facade uses (spec 2026-09-25 §2, BI-85E6EF14).
 *
 * Inngest takes CEL for concurrency keys and `waitForEvent` conditions. The
 * platform writes only three shapes, so the owned engine evaluates exactly
 * those and refuses anything else rather than guessing:
 *
 *   - a path: `event.data.buildId`
 *   - a quoted constant: `'dpf-build-pipeline'` (a shared lane)
 *   - comparisons joined by `&&`: `async.data.runId == "R-1"`,
 *     `event.data.id == async.data.id`
 *
 * `event` is the run's triggering event; `async` is the event being awaited.
 */

export type ExpressionScope = { event?: unknown; async?: unknown };

export class UnsupportedExpressionError extends Error {
  constructor(readonly expression: string) {
    super(`The Postgres job engine does not support the expression ${JSON.stringify(expression)}.`);
  }
}

const PATH = /^(event|async)(\.[A-Za-z_$][\w$]*)+$/;
const STRING = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

/** Read a dotted path such as `data.buildId` from a value. */
export function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".").filter(Boolean)) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function operand(token: string, scope: ExpressionScope, expression: string): unknown {
  const text = token.trim();
  const quoted = STRING.exec(text);
  if (quoted) return (quoted[1] ?? quoted[2] ?? "").replace(/\\(.)/g, "$1");
  if (NUMBER.test(text)) return Number(text);
  if (text === "true" || text === "false") return text === "true";
  if (PATH.test(text)) {
    const [root, ...rest] = text.split(".");
    return readPath(root === "event" ? scope.event : scope.async, rest.join("."));
  }
  throw new UnsupportedExpressionError(expression);
}

/** Evaluate a concurrency key to the string that names its lane. */
export function evaluateKey(expression: string, scope: ExpressionScope): string {
  const value = operand(expression, scope, expression);
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Evaluate a `waitForEvent` condition: `==` comparisons joined by `&&`. */
export function evaluateCondition(expression: string, scope: ExpressionScope): boolean {
  const clauses = expression.split("&&");
  return clauses.every((clause) => {
    const parts = clause.split("==");
    if (parts.length !== 2 || /!=|[<>]/.test(clause)) throw new UnsupportedExpressionError(expression);
    const left = operand(parts[0]!, scope, expression);
    const right = operand(parts[1]!, scope, expression);
    return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
  });
}

/** Throw now, at registration, for an expression the engine could not evaluate later. */
export function assertSupportedExpression(expression: string, kind: "key" | "condition"): void {
  const scope = { event: {}, async: {} };
  if (kind === "key") evaluateKey(expression, scope);
  else evaluateCondition(expression, scope);
}
