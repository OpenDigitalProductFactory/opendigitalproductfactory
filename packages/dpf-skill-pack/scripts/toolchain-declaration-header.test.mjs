// BI-BDC94789: the Claude headersHelper relays only a well-formed declaration
// and never fails the connection.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { headersFor } from "./toolchain-declaration-header.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "toolchain-declaration-header.mjs");
const VALUE = "pack=0.2.21;digest=0123456789abcdef;client=claude-code;converge=failed:unproven.claude-code.2.1.322@1793936769";

test("relays the declaration header and nothing else", () => {
  const text = JSON.stringify({ client: "claude-code", headers: { "X-DPF-Toolchain": VALUE, Authorization: "Bearer x" } });
  assert.deepEqual(headersFor(text), { "X-DPF-Toolchain": VALUE });
});

test("anything missing or malformed sends no declaration", () => {
  for (const text of ["", "not json", "null", "{}", JSON.stringify({ headers: { "X-DPF-Toolchain": 7 } }),
    JSON.stringify({ headers: { "X-DPF-Toolchain": "a\"b" } }), JSON.stringify({ headers: { "X-DPF-Toolchain": "x".repeat(257) } }),
    JSON.stringify({ headers: { "X-DPF-Toolchain": "line\nbreak" } })]) {
    assert.deepEqual(headersFor(text), {}, text);
  }
});

test("run as Claude Code runs it, from a plugin copy, it prints JSON and exits 0", () => {
  const root = mkdtempSync(join(tmpdir(), "dpf-decl-"));
  try {
    mkdirSync(join(root, "scripts"));
    copyFileSync(SCRIPT, join(root, "scripts", "toolchain-declaration-header.mjs"));
    const run = () => JSON.parse(execFileSync(process.execPath, [join(root, "scripts", "toolchain-declaration-header.mjs")], { encoding: "utf8" }));
    assert.deepEqual(run(), {});
    writeFileSync(join(root, "toolchain-declaration.json"), JSON.stringify({ client: "claude-code", headers: { "X-DPF-Toolchain": VALUE } }));
    assert.deepEqual(run(), { "X-DPF-Toolchain": VALUE });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
