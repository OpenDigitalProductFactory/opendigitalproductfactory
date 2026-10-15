import { describe, expect, it } from "vitest";

import { MessageSyntaxError } from "./ast";
import { formatMessage, messageVariables } from "./format";
import { parseMessage } from "./parse";

const fmt = (source: string, args: Record<string, unknown> = {}, locale = "en-US") =>
  formatMessage(parseMessage(source), args as never, locale);

// Conformance cases derived from the Unicode MessageFormat 2.0 specification
// (LDML Part 9, CLDR 47) for the subset DPF supports (AC-MF2).
describe("MF2 subset — simple messages", () => {
  it("passes plain text through, including spaces and punctuation", () => {
    expect(fmt("Hello, world!")).toBe("Hello, world!");
    expect(fmt("")).toBe("");
  });

  it("substitutes variables and quoted literals", () => {
    expect(fmt("Hello, {$name}!", { name: "Ada" })).toBe("Hello, Ada!");
    expect(fmt("{|a literal|} here")).toBe("a literal here");
  });

  it("honours escapes for braces, backslash and pipe", () => {
    expect(fmt("Use \\{ and \\} and \\\\ and \\|")).toBe("Use { and } and \\ and |");
  });

  it("renders the MF2 fallback for a missing variable instead of throwing", () => {
    expect(fmt("Hi {$missing}")).toBe("Hi {$missing}");
  });
});

describe("MF2 subset — functions", () => {
  it(":number and :integer format with the locale and options", () => {
    expect(fmt("{$n :number}", { n: 1234.5 })).toBe("1,234.5");
    expect(fmt("{$n :number minimumFractionDigits=2}", { n: 3 })).toBe("3.00");
    expect(fmt("{$n :integer}", { n: 1234.6 })).toBe("1,235");
    expect(fmt("{$n :number}", { n: 1234.5 }, "de-DE")).toBe("1.234,5");
  });

  it(":currency needs a currency option, literal or variable", () => {
    expect(fmt("{$amt :currency currency=USD}", { amt: 42 })).toBe("$42.00");
    expect(fmt("{$amt :currency currency=$cur}", { amt: 42, cur: "EUR" }, "de-DE")).toBe("42,00 €");
  });

  it(":date, :time and :datetime use Intl date styles", () => {
    const d = new Date(Date.UTC(2026, 8, 26, 15, 30));
    expect(fmt("{$d :date timeZone=UTC}", { d })).toBe("Sep 26, 2026");
    expect(fmt("{$d :time timeZone=UTC}", { d })).toBe("3:30 PM");
  });
});

describe("MF2 subset — selection", () => {
  const items = ".input {$count :number}\n.match $count\n0 {{No items}}\none {{One item}}\n* {{{$count} items}}";

  it("prefers an exact literal key over the plural category", () => {
    expect(fmt(items, { count: 0 })).toBe("No items");
  });

  it("selects the CLDR plural category, then the * fallback", () => {
    expect(fmt(items, { count: 1 })).toBe("One item");
    expect(fmt(items, { count: 5 })).toBe("5 items");
  });

  it("uses each locale's own plural categories (es, ar with six, ru)", () => {
    const ar =
      ".input {$n :number}\n.match $n\nzero {{zero}}\none {{one}}\ntwo {{two}}\nfew {{few}}\nmany {{many}}\n* {{other}}";
    expect([0, 1, 2, 3, 11, 100].map((n) => fmt(ar, { n }, "ar"))).toEqual(["zero", "one", "two", "few", "many", "other"]);
    const es = ".input {$n :number}\n.match $n\none {{uno}}\nmany {{muchos}}\n* {{otro}}";
    expect([1, 1000000, 2].map((n) => fmt(es, { n }, "es"))).toEqual(["uno", "muchos", "otro"]);
    const ru = ".input {$n :number}\n.match $n\none {{one}}\nfew {{few}}\nmany {{many}}\n* {{other}}";
    expect([1, 3, 5, 1.5].map((n) => fmt(ru, { n }, "ru"))).toEqual(["one", "few", "many", "other"]);
  });

  it("matches string selectors exactly and supports two selectors", () => {
    const msg =
      ".input {$role :string}\n.input {$n :integer}\n.match $role $n\nadmin one {{an admin}}\nadmin * {{admins}}\n* * {{people}}";
    expect(fmt(msg, { role: "admin", n: 1 })).toBe("an admin");
    expect(fmt(msg, { role: "admin", n: 4 })).toBe("admins");
    expect(fmt(msg, { role: "guest", n: 1 })).toBe("people");
  });

  it("accepts a quoted pattern with declarations", () => {
    expect(fmt(".input {$n :integer}\n{{You have {$n} tasks}}", { n: 3 })).toBe("You have 3 tasks");
  });
});

describe("MF2 subset — rejected syntax (catalog lint)", () => {
  const rejects = [
    "{#bold}markup{/bold}",
    ".local $x = {1}\n{{x}}",
    "{$x :unknownFunction}",
    ".input {$n :number}\n.match $n\none {{one}}",
    ".match $undeclared\n* {{x}}",
    "unmatched } brace",
    "bad \\q escape",
  ];
  for (const source of rejects) {
    it(`rejects ${JSON.stringify(source.slice(0, 30))}`, () => {
      expect(() => parseMessage(source)).toThrow(MessageSyntaxError);
    });
  }
});

describe("messageVariables", () => {
  it("lists the variables a message reads", () => {
    expect(messageVariables(parseMessage("Hi {$name}, {$n :number}"))).toEqual(["n", "name"]);
  });
});
