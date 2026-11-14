import {
  EMPTY_CART,
  type CartState,
  MAX_CART_TOTAL_MINOR,
  MAX_LINES,
  MAX_QUANTITY_PER_LINE,
  MAX_UNIT_MINOR,
  addMenuItem,
  addToCart,
  decrementLine,
  incrementLine,
  resetCart,
  cartItemCount,
  cartTotalMinor,
  currencyExponent,
  setLineQuantity,
  toMinorUnits,
} from "./cart";
import type { PublicMenu } from "@dpf/types";

describe("currencyExponent", () => {
  it("looks up exponents via Intl", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });
  it("rejects invalid codes", () => {
    expect(currencyExponent("US")).toBeNull();
    expect(currencyExponent("")).toBeNull();
  });
});

describe("toMinorUnits", () => {
  it("converts to integer minor units", () => {
    expect(toMinorUnits(14, "USD")).toEqual({ ok: true, value: 1400 });
    expect(toMinorUnits(19.99, "USD")).toEqual({ ok: true, value: 1999 });
    expect(toMinorUnits(1.005, "USD")).toEqual({ ok: true, value: 101 });
    expect(toMinorUnits(500, "JPY")).toEqual({ ok: true, value: 500 });
    expect(toMinorUnits(1.234, "KWD")).toEqual({ ok: true, value: 1234 });
  });
  it("rejects 0.001 and accepts 0.005", () => {
    expect(toMinorUnits(0.001, "USD")).toEqual({ ok: false, code: "PRICE_TOO_SMALL" });
    expect(toMinorUnits(0.005, "USD")).toEqual({ ok: true, value: 1 });
  });
  it("rejects non-finite and non-positive prices", () => {
    for (const p of [NaN, Infinity, -Infinity, "5", null, undefined]) {
      expect(toMinorUnits(p, "USD")).toEqual({ ok: false, code: "PRICE_INVALID" });
    }
    expect(toMinorUnits(0, "USD")).toEqual({ ok: false, code: "PRICE_NOT_POSITIVE" });
    expect(toMinorUnits(-1, "USD")).toEqual({ ok: false, code: "PRICE_NOT_POSITIVE" });
    expect(toMinorUnits(1e-7, "USD")).toEqual({ ok: false, code: "PRICE_TOO_SMALL" });
  });
  it("rejects bad currency", () => {
    expect(toMinorUnits(1, "XX")).toEqual({ ok: false, code: "CURRENCY_INVALID" });
  });
  it("enforces the unit-price limit", () => {
    expect(toMinorUnits(MAX_UNIT_MINOR / 100, "USD")).toEqual({ ok: true, value: MAX_UNIT_MINOR });
    expect(toMinorUnits(MAX_UNIT_MINOR / 100 + 0.01, "USD")).toEqual({ ok: false, code: "UNIT_PRICE_TOO_LARGE" });
    expect(toMinorUnits(1e300, "USD")).toEqual({ ok: false, code: "UNIT_PRICE_TOO_LARGE" });
  });
});

describe("cart selectors and mutations", () => {
  const item = (id: string, price = 10) => ({ itemId: id, name: id, price, currency: "USD" });
  const add = (c = EMPTY_CART, i = item("a"), q = 1) => {
    const r = addToCart(c, "biz", i, q);
    if (!r.ok) throw new Error(r.code);
    return r.value;
  };

  it("counts items and totals in minor units", () => {
    const c = add(add(EMPTY_CART, item("a", 10.1), 2), item("b", 0.3), 3);
    expect(cartItemCount(c)).toBe(5);
    expect(cartTotalMinor(c)).toBe(2 * 1010 + 3 * 30);
  });
  it("caps quantity per line without mutating", () => {
    const c = add(EMPTY_CART, item("a"), MAX_QUANTITY_PER_LINE);
    expect(addToCart(c, "biz", item("a"))).toEqual({ ok: false, code: "QUANTITY_LIMIT" });
    expect(c.lines[0].quantity).toBe(MAX_QUANTITY_PER_LINE);
  });
  it("caps line count", () => {
    let c = EMPTY_CART;
    for (let i = 0; i < MAX_LINES; i++) c = add(c, item(`i${i}`));
    expect(addToCart(c, "biz", item("extra"))).toEqual({ ok: false, code: "LINE_LIMIT" });
  });
  it("keeps the largest reachable cart exact and within the total cap", () => {
    const big = item("big", MAX_UNIT_MINOR / 100);
    let c = EMPTY_CART;
    for (let i = 0; i < MAX_LINES; i++) c = add(c, { ...big, itemId: `big${i}` }, MAX_QUANTITY_PER_LINE);
    expect(cartTotalMinor(c)).toBe(MAX_LINES * MAX_QUANTITY_PER_LINE * MAX_UNIT_MINOR);
    expect(Number.isSafeInteger(cartTotalMinor(c))).toBe(true);
    expect(cartTotalMinor(c)).toBeLessThanOrEqual(MAX_CART_TOTAL_MINOR);
  });
  it("rejects a mutation that would push the total over the cap", () => {
    const line = { name: "a", currency: "USD", unitMinor: MAX_UNIT_MINOR, quantity: 99 };
    const lines = Array.from({ length: 102 }, (_, i) => ({ ...line, itemId: `x${i}` }));
    const over: CartState = { businessSlug: "biz", currency: "USD", lines };
    expect(cartTotalMinor(over)).toBeGreaterThan(MAX_CART_TOTAL_MINOR);
    expect(setLineQuantity(over, "x0", 99)).toEqual({ ok: false, code: "CART_TOTAL_TOO_LARGE" });
  });
  it("rejects mixed currency/business and bad quantities", () => {
    const c = add();
    expect(addToCart(c, "biz", { ...item("b"), currency: "EUR" })).toEqual({ ok: false, code: "CURRENCY_MISMATCH" });
    expect(addToCart(c, "other", item("b"))).toEqual({ ok: false, code: "CURRENCY_MISMATCH" });
    expect(addToCart(c, "biz", item("b"), 0)).toEqual({ ok: false, code: "QUANTITY_INVALID" });
  });
  it("sets and removes quantities", () => {
    const c = add(add(), item("b"));
    const r = setLineQuantity(c, "a", 0);
    expect(r.ok && r.value.lines.map((l) => l.itemId)).toEqual(["b"]);
    const empty = setLineQuantity(r.ok ? r.value : c, "b", 0);
    expect(empty.ok && empty.value).toEqual(EMPTY_CART);
    expect(setLineQuantity(c, "a", 100)).toEqual({ ok: false, code: "QUANTITY_LIMIT" });
  });
});

describe("menu-bound cart helpers", () => {
  const mi = (id: string, price: number | null = 10, currency = "USD") => ({
    id, name: id, description: null, category: null, price, currency, imageUrl: null,
  });
  const menu = (items = [mi("a"), mi("b")]): PublicMenu => ({
    slug: "biz", name: "Biz", category: null, categories: [{ category: null, items }],
  });
  const ok = (r: { ok: boolean; code?: string; value?: CartState }): CartState => {
    if (!r.ok) throw new Error(String(r.code));
    return r.value as CartState;
  };

  it("adds a canonical item binding slug and currency from the menu", () => {
    expect(ok(addMenuItem(EMPTY_CART, menu(), "a"))).toEqual({
      businessSlug: "biz", currency: "USD",
      lines: [{ itemId: "a", name: "a", currency: "USD", unitMinor: 1000, quantity: 1 }],
    });
  });
  it("increments, decrements, removes at zero and preserves insertion order", () => {
    let c = ok(addMenuItem(EMPTY_CART, menu(), "b"));
    c = ok(addMenuItem(c, menu(), "a"));
    c = ok(incrementLine(c, menu(), "b"));
    expect(c.lines.map((l) => [l.itemId, l.quantity])).toEqual([["b", 2], ["a", 1]]);
    c = ok(decrementLine(c, "b"));
    expect(c.lines[0].quantity).toBe(1);
    c = ok(decrementLine(c, "b"));
    expect(c.lines.map((l) => l.itemId)).toEqual(["a"]);
    expect(ok(decrementLine(c, "a"))).toEqual(EMPTY_CART);
    expect(resetCart()).toEqual(EMPTY_CART);
  });
  it("rejects missing menus, fabricated ids and unavailable prices without mutation", () => {
    const c = ok(addMenuItem(EMPTY_CART, menu(), "a"));
    const before = JSON.parse(JSON.stringify(c));
    expect(addMenuItem(c, null, "a")).toEqual({ ok: false, code: "MENU_MISSING" });
    expect(addMenuItem(c, menu(), "zzz")).toEqual({ ok: false, code: "ITEM_NOT_FOUND" });
    expect(addMenuItem(c, menu([mi("n", null)]), "n")).toEqual({ ok: false, code: "PRICE_INVALID" });
    expect(incrementLine(c, menu(), "b")).toEqual({ ok: false, code: "LINE_NOT_FOUND" });
    expect(incrementLine(c, menu([mi("b")]), "a")).toEqual({ ok: false, code: "ITEM_NOT_FOUND" });
    expect(decrementLine(c, "nope")).toEqual({ ok: false, code: "LINE_NOT_FOUND" });
    expect(c).toEqual(before);
  });
  it("rejects currency and business mismatches", () => {
    const c = ok(addMenuItem(EMPTY_CART, menu(), "a"));
    expect(addMenuItem(c, menu([mi("e", 5, "EUR")]), "e")).toEqual({ ok: false, code: "CURRENCY_MISMATCH" });
    expect(addMenuItem(c, { ...menu(), slug: "other" }, "b")).toEqual({ ok: false, code: "CURRENCY_MISMATCH" });
  });
  it("enforces quantity and line limits", () => {
    let c = EMPTY_CART;
    for (let i = 0; i < MAX_QUANTITY_PER_LINE; i++) c = ok(addMenuItem(c, menu(), "a"));
    expect(incrementLine(c, menu(), "a")).toEqual({ ok: false, code: "QUANTITY_LIMIT" });
    const many = Array.from({ length: MAX_LINES + 1 }, (_, i) => mi(`i${i}`));
    let d = EMPTY_CART;
    for (let i = 0; i < MAX_LINES; i++) d = ok(addMenuItem(d, menu(many), `i${i}`));
    expect(addMenuItem(d, menu(many), `i${MAX_LINES}`)).toEqual({ ok: false, code: "LINE_LIMIT" });
  });
});
