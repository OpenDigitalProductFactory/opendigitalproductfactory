// Regression for GHSA-vcc3-ghjq-m6fr (Dependabot #156): the query parser that
// expo-router actually loads must use the patched decode-uri-component 0.5.0
// (override + patch in apps/mobile/pnpm-workspace.yaml). Moved here from
// scripts/security/ when apps/mobile became its own workspace (plan
// 2026-09-08 M6): the parser only exists in this tree. Node's own resolver is
// used on purpose, so the test sees the real installed files, not Jest's
// module registry.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const mobileRequire = createRequire(path.join(__dirname, "..", "..", "package.json"));
const routerRequire = createRequire(mobileRequire.resolve("expo-router/package.json"));
const consumerPath = routerRequire.resolve("query-string");
const queryString = routerRequire("query-string") as { parse(input: string): Record<string, unknown> };

describe("mobile query parser (decode-uri-component)", () => {
  it("preserves UTF-8, malformed bytes, spaces and repeated keys", () => {
    expect({ ...queryString.parse("name=a+b&emoji=%F0%9F%98%80&bad=%E0%A4&key=a&key=b") }).toEqual({
      name: "a b",
      emoji: "😀",
      bad: "%E0%A4",
      key: ["a", "b"],
    });
  });

  it("cannot be stalled by malformed input (GHSA-vcc3-ghjq-m6fr)", () => {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
        const assert = require("node:assert/strict");
        const parser = require(${JSON.stringify(consumerPath)});
        const malformed = "%FF".repeat(2000);
        assert.equal(parser.parse("value=" + malformed).value, malformed);
      `,
      ],
      { timeout: 2000, encoding: "utf8" },
    );
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
