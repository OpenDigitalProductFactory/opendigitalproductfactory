// Formats a parsed MF2-subset message with native Intl. Selection follows the
// MF2 spec: an exact literal key beats a plural-category key, which beats `*`.

import type { Expression, Message, OptionValue, Pattern } from "./ast";

export type MessageArgs = Record<string, string | number | Date | null | undefined>;

function resolveOption(value: OptionValue, args: MessageArgs): string | undefined {
  if (value.kind === "literal") return value.value;
  const arg = args[value.name];
  return arg == null ? undefined : String(arg);
}

function numericOptions(expr: Expression, args: MessageArgs): Intl.NumberFormatOptions {
  const out: Record<string, string | number> = {};
  for (const [key, raw] of Object.entries(expr.fn?.options ?? {})) {
    const value = resolveOption(raw, args);
    if (value === undefined) continue;
    out[key] = /^\d+$/.test(value) ? Number(value) : value;
  }
  return out as Intl.NumberFormatOptions;
}

function operandValue(expr: Expression, args: MessageArgs): string | number | Date | null | undefined {
  return expr.operand.kind === "literal" ? expr.operand.value : args[expr.operand.name];
}

function formatExpression(expr: Expression, args: MessageArgs, locale: string): string {
  const value = operandValue(expr, args);
  const fn = expr.fn?.name;
  if (value == null) {
    // MF2 fallback representation for an unresolved operand.
    return expr.operand.kind === "variable" ? `{$${expr.operand.name}}` : "{}";
  }
  switch (fn) {
    case "number":
      return new Intl.NumberFormat(locale, numericOptions(expr, args)).format(Number(value));
    case "integer":
      return new Intl.NumberFormat(locale, { ...numericOptions(expr, args), maximumFractionDigits: 0 }).format(Number(value));
    case "currency": {
      const options = numericOptions(expr, args);
      if (!options.currency) return `{$${expr.operand.kind === "variable" ? expr.operand.name : "currency"}}`;
      return new Intl.NumberFormat(locale, { ...options, style: "currency" }).format(Number(value));
    }
    case "datetime":
    case "date":
    case "time": {
      const date = value instanceof Date ? value : new Date(value);
      const style =
        fn === "date" ? { dateStyle: "medium" } : fn === "time" ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" };
      return new Intl.DateTimeFormat(locale, { ...(style as Intl.DateTimeFormatOptions), ...(numericOptions(expr, args) as Intl.DateTimeFormatOptions) }).format(date);
    }
    default:
      return value instanceof Date ? value.toISOString() : String(value);
  }
}

function formatPattern(pattern: Pattern, args: MessageArgs, locale: string): string {
  return pattern.map((part) => (part.kind === "text" ? part.value : formatExpression(part.expression, args, locale))).join("");
}

function selectorKeys(expr: Expression, args: MessageArgs, locale: string): { exact: string; category: string | null } {
  const value = operandValue(expr, args);
  const fn = expr.fn?.name;
  if ((fn === "number" || fn === "integer") && value != null && value !== "") {
    const n = Number(value);
    const type = resolveOption(expr.fn?.options.select ?? { kind: "literal", value: "plural" }, args);
    const category =
      type === "exact" ? null : new Intl.PluralRules(locale, { type: type === "ordinal" ? "ordinal" : "cardinal" }).select(n);
    return { exact: String(n), category };
  }
  return { exact: value == null ? "" : String(value), category: null };
}

function isHigher(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

export function formatMessage(message: Message, args: MessageArgs, locale: string): string {
  if (message.kind === "pattern") return formatPattern(message.pattern, args, locale);
  const resolved = message.selectors.map((name) => selectorKeys(message.declarations[name]!, args, locale));
  // Score each matching variant: per selector, exact literal = 2, plural
  // category = 1, `*` = 0. The lexicographically highest score wins, so the
  // first selector dominates (MF2 selection order).
  let best: { pattern: Pattern; score: number[] } | null = null;
  for (const variant of message.variants) {
    const score: number[] = [];
    const matches = variant.keys.every((key, i) => {
      const sel = resolved[i]!;
      if (key === "*") score.push(0);
      else if (key === sel.exact) score.push(2);
      else if (sel.category !== null && key === sel.category) score.push(1);
      else return false;
      return true;
    });
    if (matches && (!best || isHigher(score, best.score))) best = { pattern: variant.pattern, score };
  }
  return best ? formatPattern(best.pattern, args, locale) : "";
}

/** Variable names a message reads, for placeholder-preservation checks. */
export function messageVariables(message: Message): string[] {
  const names = new Set<string>();
  const visit = (pattern: Pattern) =>
    pattern.forEach((part) => {
      if (part.kind === "expression" && part.expression.operand.kind === "variable") names.add(part.expression.operand.name);
    });
  if (message.kind === "pattern") visit(message.pattern);
  else {
    Object.keys(message.declarations).forEach((n) => names.add(n));
    message.variants.forEach((v) => visit(v.pattern));
  }
  return [...names].sort();
}
