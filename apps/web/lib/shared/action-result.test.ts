import { describe, it, expect, expectTypeOf } from "vitest";

import { ok, err, type ActionResult } from "./action-result";

describe("ok()", () => {
  it("with no argument yields a payload-less success", () => {
    expect(ok()).toEqual({ ok: true });
    expect("data" in ok()).toBe(false);
  });

  it("with an argument nests it under `data`", () => {
    expect(ok(42)).toEqual({ ok: true, data: 42 });
    expect(ok({ id: "wb_1" })).toEqual({ ok: true, data: { id: "wb_1" } });
  });

  it("preserves falsy payloads (0, '', false, null) instead of dropping them", () => {
    expect(ok(0)).toEqual({ ok: true, data: 0 });
    expect(ok("")).toEqual({ ok: true, data: "" });
    expect(ok(false)).toEqual({ ok: true, data: false });
    expect(ok(null)).toEqual({ ok: true, data: null });
  });
});

describe("err()", () => {
  it("yields a failure carrying the message", () => {
    expect(err("nope")).toEqual({ ok: false, error: "nope" });
  });

  it("is assignable to ActionResult of any payload type", () => {
    const r: ActionResult<{ id: string }> = err("boom");
    expect(r.ok).toBe(false);
  });
});

describe("narrowing", () => {
  it("discriminates on `ok`", () => {
    const results: ActionResult<number>[] = [ok(7), err("bad")];
    const values: number[] = [];
    const errors: string[] = [];
    for (const r of results) {
      if (r.ok) values.push(r.data);
      else errors.push(r.error);
    }
    expect(values).toEqual([7]);
    expect(errors).toEqual(["bad"]);
  });

  it("narrows the success branch to expose `data` and the failure branch `error` (type-level)", () => {
    const r = ok(3) as ActionResult<number>;
    if (r.ok) {
      expectTypeOf(r.data).toEqualTypeOf<number>();
    } else {
      expectTypeOf(r.error).toEqualTypeOf<string>();
    }
  });

  it("ActionResult<void> success has no `data` key (type-level)", () => {
    const r = ok() as ActionResult;
    if (r.ok) {
      expectTypeOf(r).toEqualTypeOf<{ ok: true }>();
    }
  });
});
