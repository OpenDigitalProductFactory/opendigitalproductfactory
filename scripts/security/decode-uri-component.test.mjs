import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const mobileManifest = fileURLToPath(new URL("../../apps/mobile/package.json", import.meta.url));
const mobileRequire = createRequire(mobileManifest);
const routerRequire = createRequire(mobileRequire.resolve("expo-router/package.json"));
const consumerPath = routerRequire.resolve("query-string");
const queryString = routerRequire("query-string");

test("the mobile query parser preserves UTF-8, malformed bytes, spaces and repeated keys", () => {
  assert.deepEqual({ ...queryString.parse("name=a+b&emoji=%F0%9F%98%80&bad=%E0%A4&key=a&key=b") }, {
    name: "a b", emoji: "😀", bad: "%E0%A4", key: ["a", "b"],
  });
});

test("malformed input cannot stall the actual mobile query parser (GHSA-vcc3-ghjq-m6fr)", () => {
  const result = spawnSync(process.execPath, ["-e", `
    const assert = require("node:assert/strict");
    const parser = require(${JSON.stringify(consumerPath)});
    const malformed = "%FF".repeat(2000);
    assert.equal(parser.parse("value=" + malformed).value, malformed);
  `], { timeout: 2000, encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});
