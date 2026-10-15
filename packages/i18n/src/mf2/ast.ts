// The AST for DPF's Unicode MessageFormat 2.0 subset (EP-6B33A840 L0.2).
// Spec: https://unicode.org/reports/tr35/tr35-messageFormat.html (stable since CLDR 47).
//
// Supported: text; placeholders {$var} and {|literal|}; the functions :number,
// :integer, :currency, :datetime, :date, :time, :string with literal or
// $variable options; `.input` declarations; `.match` on declared variables
// with exact-literal, plural-category and `*` keys. Anything else (markup,
// `.local`, unknown functions) is rejected at parse time.

export type FunctionName = "number" | "integer" | "currency" | "datetime" | "date" | "time" | "string";

export type OptionValue = { kind: "literal"; value: string } | { kind: "variable"; name: string };

export interface Expression {
  operand: { kind: "variable"; name: string } | { kind: "literal"; value: string };
  fn?: { name: FunctionName; options: Record<string, OptionValue> };
}

export type PatternPart = { kind: "text"; value: string } | { kind: "expression"; expression: Expression };

export type Pattern = PatternPart[];

export interface Variant {
  /** One key per selector: an exact literal, a plural category, or "*". */
  keys: string[];
  pattern: Pattern;
}

export type Message =
  | { kind: "pattern"; pattern: Pattern }
  | { kind: "select"; declarations: Record<string, Expression>; selectors: string[]; variants: Variant[] };

export class MessageSyntaxError extends Error {
  constructor(message: string, readonly source: string, readonly offset: number) {
    super(`${message} at offset ${offset} in ${JSON.stringify(source)}`);
    this.name = "MessageSyntaxError";
  }
}
