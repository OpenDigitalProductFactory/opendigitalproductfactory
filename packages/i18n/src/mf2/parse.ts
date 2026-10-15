// A recursive-descent parser for DPF's MessageFormat 2.0 subset (see ./ast.ts).
// Out-of-subset syntax throws MessageSyntaxError so a catalog cannot ship a
// message the formatter would render wrongly.

import { MessageSyntaxError, type Expression, type FunctionName, type Message, type OptionValue, type Pattern, type Variant } from "./ast";

const FUNCTIONS = new Set<FunctionName>(["number", "integer", "currency", "datetime", "date", "time", "string"]);
const NAME_RE = /[A-Za-z_][A-Za-z0-9_.-]*/y;
const WS_RE = /[ \t\r\n　]*/y;

class Parser {
  pos = 0;
  constructor(readonly src: string) {}

  fail(message: string): never {
    throw new MessageSyntaxError(message, this.src, this.pos);
  }

  ws(): void {
    WS_RE.lastIndex = this.pos;
    WS_RE.exec(this.src);
    this.pos = WS_RE.lastIndex;
  }

  eat(token: string): boolean {
    if (this.src.startsWith(token, this.pos)) {
      this.pos += token.length;
      return true;
    }
    return false;
  }

  expect(token: string): void {
    if (!this.eat(token)) this.fail(`expected ${JSON.stringify(token)}`);
  }

  name(): string {
    NAME_RE.lastIndex = this.pos;
    const m = NAME_RE.exec(this.src);
    if (!m) this.fail("expected a name");
    this.pos = NAME_RE.lastIndex;
    return m[0];
  }

  /** `|quoted literal|` or an unquoted literal (name or number). */
  literal(): string {
    if (this.eat("|")) {
      let out = "";
      while (this.pos < this.src.length && this.src[this.pos] !== "|") {
        if (this.src[this.pos] === "\\") this.pos++;
        out += this.src[this.pos++];
      }
      this.expect("|");
      return out;
    }
    const m = /[A-Za-z0-9_.+-]+/y;
    m.lastIndex = this.pos;
    const hit = m.exec(this.src);
    if (!hit) this.fail("expected a literal");
    this.pos = m.lastIndex;
    return hit[0];
  }

  /** `{ operand [:fn opt=val ...] }` — the opening `{` already consumed. */
  expressionBody(): Expression {
    this.ws();
    let operand: Expression["operand"];
    if (this.eat("$")) operand = { kind: "variable", name: this.name() };
    else if (this.src[this.pos] === "#" || this.src[this.pos] === "/") this.fail("markup is outside the DPF subset");
    else operand = { kind: "literal", value: this.literal() };
    this.ws();
    let fn: Expression["fn"];
    if (this.eat(":")) {
      const fnName = this.name();
      if (!FUNCTIONS.has(fnName as FunctionName)) this.fail(`unsupported function :${fnName}`);
      const options: Record<string, OptionValue> = {};
      this.ws();
      while (this.src[this.pos] !== "}" && this.pos < this.src.length) {
        const key = this.name();
        this.ws();
        this.expect("=");
        this.ws();
        options[key] = this.eat("$") ? { kind: "variable", name: this.name() } : { kind: "literal", value: this.literal() };
        this.ws();
      }
      fn = { name: fnName as FunctionName, options };
    }
    this.ws();
    this.expect("}");
    return fn ? { operand, fn } : { operand };
  }

  /** Text and placeholders until `stop` (end of input, or `}}` in a quoted pattern). */
  pattern(quoted: boolean): Pattern {
    const parts: Pattern = [];
    let text = "";
    const flush = () => {
      if (text) parts.push({ kind: "text", value: text });
      text = "";
    };
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (quoted && this.src.startsWith("}}", this.pos)) break;
      if (ch === "\\") {
        const next = this.src[this.pos + 1];
        if (next === undefined || !"{}\\|".includes(next)) this.fail("invalid escape");
        text += next;
        this.pos += 2;
      } else if (ch === "{") {
        this.pos++;
        flush();
        parts.push({ kind: "expression", expression: this.expressionBody() });
      } else if (ch === "}") {
        this.fail("unmatched }");
      } else {
        text += ch;
        this.pos++;
      }
    }
    flush();
    return parts;
  }

  message(): Message {
    const start = this.pos;
    this.ws();
    if (this.src[this.pos] !== "." && !this.src.startsWith("{{", this.pos)) {
      this.pos = start;
      return { kind: "pattern", pattern: this.pattern(false) };
    }
    const declarations: Record<string, Expression> = {};
    while (this.eat(".input")) {
      this.ws();
      this.expect("{");
      const expr = this.expressionBody();
      if (expr.operand.kind !== "variable") this.fail(".input needs a variable");
      declarations[expr.operand.name] = expr;
      this.ws();
    }
    if (this.src.startsWith(".local", this.pos)) this.fail(".local is outside the DPF subset");
    if (this.eat("{{")) {
      const pattern = this.pattern(true);
      this.expect("}}");
      this.ws();
      if (this.pos < this.src.length) this.fail("unexpected content after the quoted pattern");
      return { kind: "pattern", pattern };
    }
    this.expect(".match");
    const selectors: string[] = [];
    this.ws();
    while (this.eat("$")) {
      const name = this.name();
      if (!declarations[name]) this.fail(`selector $${name} must be declared with .input`);
      selectors.push(name);
      this.ws();
    }
    if (selectors.length === 0) this.fail(".match needs at least one $selector");
    const variants: Variant[] = [];
    while (this.pos < this.src.length) {
      const keys: string[] = [];
      for (let i = 0; i < selectors.length; i++) {
        this.ws();
        keys.push(this.eat("*") ? "*" : this.literal());
      }
      this.ws();
      this.expect("{{");
      const pattern = this.pattern(true);
      this.expect("}}");
      variants.push({ keys, pattern });
      this.ws();
    }
    if (!variants.some((v) => v.keys.every((k) => k === "*"))) this.fail("a .match needs a catch-all * variant");
    return { kind: "select", declarations, selectors, variants };
  }
}

export function parseMessage(source: string): Message {
  return new Parser(source).message();
}
