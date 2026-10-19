import { describe, expect, expectTypeOf, it } from "vitest";

import {
  SOURCE_CATALOG,
  catalogFallbackChain,
  messageSource,
  namespaceMessages,
  translate,
  type MessageKey,
} from "./catalog";
import { LOCALES } from "./locales";
import { formatSource } from "./runtime";
import { messageVariables } from "./mf2/format";
import { parseMessage } from "./mf2/parse";

describe("catalog keys (AC-TYPED-KEYS)", () => {
  it("types keys from the en-US JSON", () => {
    expectTypeOf<"notFound.storefront.heading">().toMatchTypeOf<MessageKey<"errors">>();
    expectTypeOf<"steps.branding">().toMatchTypeOf<MessageKey<"setup">>();
    // @ts-expect-error — an unknown key is a compile error
    translate("en-US", "errors", "notFound.nope");
  });
});

describe("fallback (AC-FALLBACK)", () => {
  it("chains regional -> es-419 -> macro-language -> en-US", () => {
    expect(catalogFallbackChain("es-MX")).toEqual(["es-MX", "es-419", "es", "en-US"]);
    expect(catalogFallbackChain("es-ES")).toEqual(["es-ES", "es", "en-US"]);
    expect(catalogFallbackChain("en-US")).toEqual(["en-US"]);
    expect(catalogFallbackChain("not a tag")).toEqual(["en-US"]);
  });

  it("falls back per key to the en-US source when no overlay has it", () => {
    expect(translate("es-MX", "errors", "notFound.storefront.primary")).toBe("Go to homepage");
  });

  it("never renders empty: a key missing everywhere renders as the key", () => {
    expect(translate("en-US", "errors", "notFound.missing" as MessageKey<"errors">)).toBe("errors.notFound.missing");
  });
});

describe("pseudo-locales (OBJ-PSEUDO)", () => {
  it("en-XA accents and expands the text but keeps placeholders", () => {
    const out = translate("en-XA", "errors", "notFound.demoPending.body", { name: "Dental" });
    expect(out).toContain("Dental");
    expect(out.startsWith("⟦")).toBe(true);
    expect(out).not.toMatch(/The /);
    const source = translate("en-US", "errors", "notFound.demoPending.body", { name: "Dental" });
    expect(out.length / source.length).toBeGreaterThanOrEqual(1.3);
  });

  it("ar-XB wraps text in a right-to-left override", () => {
    const out = translate("ar-XB", "setup", "steps.branding");
    expect(out).toBe("‮Branding‬");
  });

  it("transforms every plural branch", () => {
    const source = ".input {$n :number}\n.match $n\none {{one item}}\n* {{{$n} items}}";
    expect(formatSource("en-XA", source, { n: 1 })).toContain("óñé");
    expect(formatSource("en-XA", source, { n: 4 })).toContain("4 íţéɱš");
  });
});

describe("catalog lint", () => {
  it("every source message parses within the MF2 subset", () => {
    for (const namespace of Object.keys(SOURCE_CATALOG) as (keyof typeof SOURCE_CATALOG)[]) {
      for (const [key, source] of Object.entries(namespaceMessages("en-US", namespace))) {
        expect(() => parseMessage(source), `${namespace}.${key}`).not.toThrow();
      }
    }
  });

  it("pseudo messages read the same variables as their source", () => {
    for (const namespace of Object.keys(SOURCE_CATALOG) as (keyof typeof SOURCE_CATALOG)[]) {
      for (const source of Object.values(namespaceMessages("en-US", namespace))) {
        expect(messageVariables(parseMessage(source))).toEqual(messageVariables(parseMessage(source)));
      }
    }
  });

  it("only registry locales have catalogs", () => {
    expect(LOCALES.map((l) => l.tag)).toContain("en-US");
    expect(messageSource("en-US", "setup", "steps.workspace")).toBe("Workspace");
  });
});
