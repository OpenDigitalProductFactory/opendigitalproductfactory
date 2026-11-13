import type { PublicMenu, PublicMenuItem } from "@dpf/types";

export const MAX_QUANTITY_PER_LINE = 99;
export const MAX_LINES = 100;
export const MAX_UNIT_MINOR = 10000000000;
export const MAX_CART_TOTAL_MINOR = 100000000000000;

export type CartErrorCode =
  | "PRICE_INVALID"
  | "PRICE_NOT_POSITIVE"
  | "PRICE_TOO_SMALL"
  | "UNIT_PRICE_TOO_LARGE"
  | "CURRENCY_INVALID"
  | "CURRENCY_MISMATCH"
  | "QUANTITY_INVALID"
  | "QUANTITY_LIMIT"
  | "LINE_LIMIT"
  | "CART_TOTAL_TOO_LARGE"
  | "MENU_MISSING"
  | "ITEM_NOT_FOUND"
  | "LINE_NOT_FOUND";

export interface CartLine {
  itemId: string;
  name: string;
  currency: string;
  /** Integer minor units (e.g. cents). */
  unitMinor: number;
  quantity: number;
}

export interface CartState {
  businessSlug: string | null;
  currency: string | null;
  lines: CartLine[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; code: CartErrorCode };

export const EMPTY_CART: CartState = { businessSlug: null, currency: null, lines: [] };

/** Number of minor-unit digits for an ISO 4217 currency code, or null if unknown. */
export function currencyExponent(currency: string): number | null {
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) return null;
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits;
    return typeof digits === "number" ? digits : null;
  } catch {
    return null;
  }
}

/** Shift the decimal point right without binary-float error (0.005 -> 0.5, 1.005 -> 100.5). */
function shiftDecimal(value: number, exponent: number): number {
  if (exponent === 0) return value;
  const shifted = Number(`${value}e${exponent}`);
  return Number.isFinite(shifted) ? shifted : value * 10 ** exponent;
}

/** Convert a canonical major-unit price to integer minor units, rounding half up. */
export function toMinorUnits(price: unknown, currency: string): Result<number> {
  const exponent = currencyExponent(currency);
  if (exponent === null) return { ok: false, code: "CURRENCY_INVALID" };
  if (typeof price !== "number" || !Number.isFinite(price)) return { ok: false, code: "PRICE_INVALID" };
  if (price <= 0) return { ok: false, code: "PRICE_NOT_POSITIVE" };
  // Exponent-notation inputs (e.g. 1e-7) cannot be string-shifted; they are far below any minor unit.
  const minor = Math.round(
    /e/i.test(String(price)) ? price * 10 ** exponent : shiftDecimal(price, exponent),
  );
  if (minor < 1) return { ok: false, code: "PRICE_TOO_SMALL" };
  if (minor > MAX_UNIT_MINOR) return { ok: false, code: "UNIT_PRICE_TOO_LARGE" };
  return { ok: true, value: minor };
}

export function cartItemCount(cart: CartState): number {
  return cart.lines.reduce((n, l) => n + l.quantity, 0);
}

export function cartTotalMinor(cart: CartState): number {
  return cart.lines.reduce((sum, l) => sum + l.unitMinor * l.quantity, 0);
}

/** Add `quantity` of an item; returns a new cart, never mutating the input. */
export function addToCart(
  cart: CartState,
  businessSlug: string,
  item: { itemId: string; name: string; price: unknown; currency: string },
  quantity = 1,
): Result<CartState> {
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, code: "QUANTITY_INVALID" };
  const unit = toMinorUnits(item.price, item.currency);
  if (!unit.ok) return unit;
  const currency = item.currency.toUpperCase();
  if (cart.lines.length > 0 && (cart.businessSlug !== businessSlug || cart.currency !== currency)) {
    return { ok: false, code: "CURRENCY_MISMATCH" };
  }
  const existing = cart.lines.find((l) => l.itemId === item.itemId);
  const newQty = (existing?.quantity ?? 0) + quantity;
  if (newQty > MAX_QUANTITY_PER_LINE) return { ok: false, code: "QUANTITY_LIMIT" };
  if (!existing && cart.lines.length >= MAX_LINES) return { ok: false, code: "LINE_LIMIT" };
  const line: CartLine = { itemId: item.itemId, name: item.name, currency, unitMinor: unit.value, quantity: newQty };
  const lines = existing
    ? cart.lines.map((l) => (l.itemId === item.itemId ? line : l))
    : [...cart.lines, line];
  const next: CartState = { businessSlug, currency, lines };
  if (cartTotalMinor(next) > MAX_CART_TOTAL_MINOR) return { ok: false, code: "CART_TOTAL_TOO_LARGE" };
  return { ok: true, value: next };
}

/** Set a line's quantity; 0 removes it. */
export function setLineQuantity(cart: CartState, itemId: string, quantity: number): Result<CartState> {
  if (!Number.isInteger(quantity) || quantity < 0) return { ok: false, code: "QUANTITY_INVALID" };
  if (quantity > MAX_QUANTITY_PER_LINE) return { ok: false, code: "QUANTITY_LIMIT" };
  const lines = quantity === 0
    ? cart.lines.filter((l) => l.itemId !== itemId)
    : cart.lines.map((l) => (l.itemId === itemId ? { ...l, quantity } : l));
  const next: CartState = lines.length === 0 ? EMPTY_CART : { ...cart, lines };
  if (cartTotalMinor(next) > MAX_CART_TOTAL_MINOR) return { ok: false, code: "CART_TOTAL_TOO_LARGE" };
  return { ok: true, value: next };
}

/** Resolve an item only from the loaded menu's categories; fabricated or stale ids resolve to null. */
export function findMenuItem(menu: PublicMenu | null | undefined, itemId: string): PublicMenuItem | null {
  if (!menu || !Array.isArray(menu.categories) || typeof itemId !== "string") return null;
  for (const category of menu.categories) {
    const found = category.items.find((i) => i.id === itemId);
    if (found) return found;
  }
  return null;
}

function addResolved(cart: CartState, menu: PublicMenu | null | undefined, itemId: string): Result<CartState> {
  if (!menu) return { ok: false, code: "MENU_MISSING" };
  const item = findMenuItem(menu, itemId);
  if (!item) return { ok: false, code: "ITEM_NOT_FOUND" };
  return addToCart(cart, menu.slug, { itemId: item.id, name: item.name, price: item.price, currency: item.currency }, 1);
}

/** Add one of a canonical menu item (new line, or +1 on an existing line). */
export function addMenuItem(cart: CartState, menu: PublicMenu | null | undefined, itemId: string): Result<CartState> {
  return addResolved(cart, menu, itemId);
}

/** Add one more of an item already in the cart; the menu must still list it. */
export function incrementLine(cart: CartState, menu: PublicMenu | null | undefined, itemId: string): Result<CartState> {
  if (!menu) return { ok: false, code: "MENU_MISSING" };
  if (!cart.lines.some((l) => l.itemId === itemId)) return { ok: false, code: "LINE_NOT_FOUND" };
  return addResolved(cart, menu, itemId);
}

/** Remove one of a line; the line is removed at zero. Needs no menu so stale lines can always be reduced. */
export function decrementLine(cart: CartState, itemId: string): Result<CartState> {
  const line = cart.lines.find((l) => l.itemId === itemId);
  if (!line) return { ok: false, code: "LINE_NOT_FOUND" };
  return setLineQuantity(cart, itemId, line.quantity - 1);
}

export function resetCart(): CartState {
  return EMPTY_CART;
}
