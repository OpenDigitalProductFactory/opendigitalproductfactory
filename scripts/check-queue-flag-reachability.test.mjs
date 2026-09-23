import assert from "node:assert/strict";
import test from "node:test";

import {
  collectQueueFlags,
  describeUnreachableFlag,
  findUnreachableFlags,
} from "./check-queue-flag-reachability.mjs";

const fakeFs = (files) => ({
  readdir: () => Object.keys(files),
  readFile: (p) => {
    const name = p.split(/[\\/]/).pop();
    if (!(name in files)) throw new Error(`no such file ${name}`);
    return files[name];
  },
});

test("collects the flag names a queue function declares", () => {
  const flags = collectQueueFlags("dir", fakeFs({
    "a.ts": 'export const X = "DPF_ALPHA_ENABLED";\nconst y = "DPF_BETA_MAX";',
    "b.ts": 'envFlagEnabled(env, "DPF_ALPHA_ENABLED")',
  }));
  assert.deepEqual([...flags.keys()].sort(), ["DPF_ALPHA_ENABLED", "DPF_BETA_MAX"]);
  assert.deepEqual([...flags.get("DPF_ALPHA_ENABLED")].sort(), ["a.ts", "b.ts"]);
});

test("ignores test files, which declare flags they only pretend to read", () => {
  const flags = collectQueueFlags("dir", fakeFs({
    "a.test.ts": 'const f = "DPF_ONLY_IN_A_TEST";',
    "a.ts": 'const f = "DPF_REAL";',
  }));
  assert.deepEqual([...flags.keys()], ["DPF_REAL"]);
});

test("a flag compose forwards is reachable", () => {
  const flags = new Map([["DPF_ALPHA", new Set(["a.ts"])]]);
  const compose = "    DPF_ALPHA: ${DPF_ALPHA:-0}\n";
  assert.deepEqual(findUnreachableFlags(flags, compose), []);
});

// The whole point: this is what an install cannot opt into, however the
// operator tries, because .env does not reach an unforwarded variable and
// editing installed compose is forbidden.
test("a flag no compose file forwards is reported with the files that read it", () => {
  const flags = new Map([
    ["DPF_ALPHA", new Set(["a.ts"])],
    ["DPF_ORPHAN", new Set(["b.ts", "c.ts"])],
  ]);
  const found = findUnreachableFlags(flags, "DPF_ALPHA: ${DPF_ALPHA:-0}");
  assert.equal(found.length, 1);
  assert.equal(found[0].flag, "DPF_ORPHAN");
  assert.deepEqual(found[0].files, ["b.ts", "c.ts"]);
});

test("an exemption is honoured, so a deliberate choice is not noise", () => {
  const flags = new Map([["DPF_RUNTIME_SET", new Set(["a.ts"])]]);
  const found = findUnreachableFlags(flags, "", { DPF_RUNTIME_SET: "written by the runtime, not an operator" });
  assert.deepEqual(found, []);
});

test("the report names the fix, not just the fault", () => {
  const text = describeUnreachableFlag({ flag: "DPF_ORPHAN", files: ["b.ts"] });
  assert.match(text, /DPF_ORPHAN/);
  assert.match(text, /b\.ts/);
  assert.match(text, /docker-compose\.yml/);
  assert.match(text, /\$\{DPF_ORPHAN:-0\}/);
});

test("results are ordered, so the report does not churn between runs", () => {
  const flags = new Map([
    ["DPF_ZULU", new Set(["z.ts"])],
    ["DPF_ALPHA", new Set(["a.ts"])],
  ]);
  assert.deepEqual(findUnreachableFlags(flags, "").map((r) => r.flag), ["DPF_ALPHA", "DPF_ZULU"]);
});

test("an unreadable directory yields no flags rather than throwing", () => {
  const flags = collectQueueFlags("nope", { readdir: () => { throw new Error("ENOENT"); } });
  assert.equal(flags.size, 0);
});
