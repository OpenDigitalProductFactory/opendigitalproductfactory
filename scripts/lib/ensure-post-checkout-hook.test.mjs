import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyPostCheckoutShim,
  DELEGATING_SHIM,
} from "./ensure-post-checkout-hook.mjs";

describe("ensure-post-checkout-hook", () => {
  it("classifies missing, delegating, lfs-stock, and custom shims", () => {
    assert.equal(classifyPostCheckoutShim(null), "missing");
    assert.equal(classifyPostCheckoutShim(DELEGATING_SHIM), "delegating");
    assert.equal(
      classifyPostCheckoutShim('#!/bin/sh\ngit lfs post-checkout "$@"\n'),
      "lfs-stock",
    );
    assert.equal(
      classifyPostCheckoutShim('#!/bin/sh\necho custom\n'),
      "custom",
    );
  });
});