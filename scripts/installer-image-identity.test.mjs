import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ps = readFileSync(new URL("../install-dpf.ps1", import.meta.url), "utf8");
const sh = readFileSync(new URL("../install-dpf.sh", import.meta.url), "utf8");

for (const [name, source] of [["PowerShell", ps], ["POSIX", sh]]) {
  test(`${name} consumer install reports immutable image identity and age`, () => {
    assert.match(source, /RepoDigests|repo digest|image digest/i);
    assert.match(source, /Created|created at|creation date/i);
    assert.match(source, /latest.*(?:main|stale|older)|main.*latest/is);
  });
}
