import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  GUARD_OUTCOME_SCHEMA,
  baselineDigestFor,
  buildGuardResult,
  buildRunRecord,
  cloneKeyFor,
  digestFiles,
  digestLoopGuard,
  digestPolicyGuard,
  flushSpool,
  importClosure,
  loadGuardDeclarations,
  overrideFromEnv,
  policyGuardResults,
  policyStatusToVerdict,
  readQuarantine,
  readSpool,
  recordGuardRun,
  resolveDiffIdentity,
  spoolRecord,
  validateRunRecord,
} from "./guard-outcome-record.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const DIGEST = "c".repeat(64);

function record(overrides = {}) {
  return buildRunRecord({
    runner: "pregate",
    runId: "00000000-0000-4000-8000-000000000001",
    startedAt: Date.parse("2026-10-14T00:00:00Z"),
    durationMs: 10,
    diff: { cloneKey: "0".repeat(16), branch: "feat/x", baseSha: SHA_A, headSha: SHA_B, patchId: SHA_A, dirty: false },
    guards: [buildGuardResult({ guardId: "loop:check-no-x", guardDigest: DIGEST, verdict: "refused", durationMs: 5 })],
    ...overrides,
  });
}

function tempRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "guard-outcome-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("guard version digests", () => {
  it("change exactly when a named file changes, appears or disappears", () => {
    const root = tempRepo({ "a.txt": "one" });
    try {
      const first = digestFiles(["a.txt", "b.txt"], { repoRoot: root });
      assert.equal(first, digestFiles(["b.txt", "a.txt"], { repoRoot: root }), "order-independent");
      writeFileSync(join(root, "b.txt"), "two");
      const second = digestFiles(["a.txt", "b.txt"], { repoRoot: root });
      assert.notEqual(first, second, "a file appearing changes the digest");
      writeFileSync(join(root, "a.txt"), "ONE");
      assert.notEqual(second, digestFiles(["a.txt", "b.txt"], { repoRoot: root }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("follows relative imports transitively, cycle-safe, and not package imports", () => {
    const root = tempRepo({
      "scripts/check-no-x.mjs": 'import { a } from "./lib/a.mjs";\nimport fs from "node:fs";\n',
      "scripts/lib/a.mjs": 'export { b } from "./b.mjs";\n',
      "scripts/lib/b.mjs": 'import "./a.mjs";\nconst later = await import("./c.mjs");\n',
      "scripts/lib/c.mjs": "export const c = 1;\n",
    });
    try {
      assert.deepEqual(importClosure("scripts/check-no-x.mjs", { repoRoot: root }), [
        "scripts/check-no-x.mjs", "scripts/lib/a.mjs", "scripts/lib/b.mjs", "scripts/lib/c.mjs",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a loop guard changes when its self-test or a shared helper changes", () => {
    const root = tempRepo({
      "scripts/check-no-x.mjs": 'import "./lib/helper.mjs";\n',
      "scripts/check-no-x.test.mjs": "// test v1\n",
      "scripts/lib/helper.mjs": "// v1\n",
    });
    try {
      const v1 = digestLoopGuard("check-no-x.mjs", { repoRoot: root });
      writeFileSync(join(root, "scripts/lib/helper.mjs"), "// v2\n");
      const v2 = digestLoopGuard("check-no-x.mjs", { repoRoot: root });
      assert.notEqual(v1, v2, "a helper fix is a guard change");
      writeFileSync(join(root, "scripts/check-no-x.test.mjs"), "// test v2\n");
      assert.notEqual(v2, digestLoopGuard("check-no-x.mjs", { repoRoot: root }), "a self-test change is a guard change");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a policy guard covers its command line and the closure of the scripts it runs", () => {
    const root = tempRepo({ "scripts/check-x.mjs": 'import "./lib/h.mjs";\n', "scripts/lib/h.mjs": "v1" });
    try {
      const entry = { id: "x", commands: [["node", ["scripts/check-x.mjs"]]] };
      const v1 = digestPolicyGuard(entry, { repoRoot: root });
      writeFileSync(join(root, "scripts/lib/h.mjs"), "v2");
      const v2 = digestPolicyGuard(entry, { repoRoot: root });
      assert.notEqual(v1, v2, "editing an imported helper changes the guard");
      assert.notEqual(v2, digestPolicyGuard({ ...entry, commands: [["node", ["scripts/check-x.mjs", "--strict"]]] }, { repoRoot: root }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a guard with no declared baseline inputs has a null baseline digest; declared inputs are digested", () => {
    const root = tempRepo({ "scripts/x-baseline.txt": "1\n" });
    try {
      assert.equal(baselineDigestFor("loop:check-no-x", {}), null);
      const guards = { "loop:check-no-x": { baselineInputs: ["scripts/x-baseline.txt"] } };
      assert.match(baselineDigestFor("loop:check-no-x", guards, { repoRoot: root }), /^[0-9a-f]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("declarations", () => {
  it("a missing or malformed file reads as nothing declared", () => {
    const root = tempRepo({ "scripts/guard-declarations.json": "{ not json" });
    try {
      assert.deepEqual(loadGuardDeclarations({ repoRoot: root }), { guards: {}, raw: null, digest: null });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a valid file is returned raw with its digest", () => {
    const raw = JSON.stringify({ version: 1, guards: { "loop:check-no-x": { owner: "platform" } } });
    const root = tempRepo({ "scripts/guard-declarations.json": raw });
    try {
      const loaded = loadGuardDeclarations({ repoRoot: root });
      assert.equal(loaded.raw, raw);
      assert.match(loaded.digest, /^[0-9a-f]{64}$/);
      assert.equal(loaded.guards["loop:check-no-x"].owner, "platform");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("verdicts, overrides and diff identity", () => {
  it("maps runner statuses onto the closed verdict vocabulary", () => {
    assert.equal(policyStatusToVerdict("passed"), "passed");
    assert.equal(policyStatusToVerdict("failed"), "refused");
    assert.equal(policyStatusToVerdict("skipped_environment"), "skipped");
    for (const status of ["runner_failed", "timed_out", "cancelled", "anything"]) {
      assert.equal(policyStatusToVerdict(status), "runner-failed");
    }
  });

  it("reads recorded overrides only", () => {
    assert.equal(overrideFromEnv({}, { runner: "pregate" }), null);
    assert.equal(overrideFromEnv({ DPF_SKIP_PREGATE_PREFLIGHT_REASON: "host is down" }, { runner: "pregate" }).kind, "skip-env");
    assert.equal(
      overrideFromEnv({ DPF_SKIP_PREPUSH_GATE: "1", DPF_SKIP_PREPUSH_GATE_REASON: "gate-infrastructure-unavailable: 401" }, { runner: "pre-push-gate" }).kind,
      "gate-infrastructure-unavailable",
    );
    assert.deepEqual(
      overrideFromEnv({ DPF_SKIP_PREPUSH_GATE: "1", DPF_SKIP_PREPUSH_GATE_REASON: "docs-adjacent: readme" }, { runner: "pre-push-gate" }),
      { kind: "local-ci-override", code: "docs-adjacent", reason: "docs-adjacent: readme" },
    );
  });

  it("the clone key is stable, short and carries no path", () => {
    const key = cloneKeyFor("/repo/worktrees/x", "host-1");
    assert.match(key, /^[0-9a-f]{16}$/);
    assert.equal(key, cloneKeyFor("/repo/worktrees/x", "host-1"));
    assert.notEqual(key, cloneKeyFor("/repo/worktrees/y", "host-1"));
  });

  it("resolves branch, shas, patch id and dirty from git, and nulls what git cannot answer", () => {
    const calls = [];
    const exec = (_cmd, args, options) => {
      calls.push(args[0]);
      switch (args[0]) {
        case "rev-parse": return args[1] === "HEAD" ? SHA_B : "feat/x";
        case "merge-base": return SHA_A;
        case "diff": return "diff --git a/x b/x\n+line\n";
        case "patch-id": assert.match(options.input, /\+line/); return `${"d".repeat(40)} ${SHA_B}`;
        case "status": return " M scripts/x.mjs";
        default: throw new Error("unexpected");
      }
    };
    assert.deepEqual(resolveDiffIdentity({ cwd: "/repo", exec, host: "h" }), {
      cloneKey: cloneKeyFor("/repo", "h"), branch: "feat/x", headSha: SHA_B, baseSha: SHA_A, patchId: "d".repeat(40), dirty: true,
    });
    const failing = () => { throw new Error("not a repo"); };
    const unknown = resolveDiffIdentity({ cwd: "/repo", exec: failing, host: "h" });
    assert.deepEqual([unknown.branch, unknown.headSha, unknown.baseSha, unknown.patchId, unknown.dirty], [null, null, null, null, false]);
  });
});

describe("run record", () => {
  it("builds a valid v1 record", () => {
    const built = record();
    assert.equal(built.schema, GUARD_OUTCOME_SCHEMA);
    assert.deepEqual(validateRunRecord(built), []);
  });

  it("names every malformed field", () => {
    const bad = record({ runner: "ci", diff: { cloneKey: "x", branch: "", baseSha: "nope", headSha: "short", patchId: null, dirty: false } });
    bad.guards[0].guardId = "check-no-x";
    bad.guards[0].kind = "check";
    assert.deepEqual(validateRunRecord(bad), [
      "runner", "diff.cloneKey", "diff.branch", "diff.headSha", "diff.baseSha", "guards[0].guardId", "guards[0].kind",
    ]);
  });
});

describe("spool and flush", () => {
  it("spools a valid record and refuses an invalid one without throwing", () => {
    const dir = tempRepo();
    try {
      assert.equal(spoolRecord(record(), { directory: dir }).ok, true);
      const refused = spoolRecord(record({ runner: "ci" }), { directory: dir });
      assert.equal(refused.ok, false);
      assert.match(refused.reason, /runner/);
      assert.equal(readSpool({ directory: dir }).records.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a write failure is reported, not raised", () => {
    const failing = () => { const error = new Error("disk"); error.code = "ENOSPC"; throw error; };
    assert.deepEqual(spoolRecord(record(), { directory: "/x", mkdir: failing }), { ok: false, reason: "spool write failed: ENOSPC" });
  });

  it("deletes acknowledged files, quarantines permanent refusals, keeps the rest, and sends declarations along", async () => {
    const dir = tempRepo();
    try {
      const ids = ["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b", "00000000-0000-4000-8000-00000000000c", "00000000-0000-4000-8000-00000000000d"];
      for (const runId of ids) spoolRecord(record({ runId }), { directory: dir });
      let sent;
      const summary = await flushSpool({
        directory: dir,
        declarations: "{}",
        call: async (args) => {
          sent = args;
          return {
            acknowledged: [ids[0]],
            refused: [{ runId: ids[1], reason: "invalid: runner", permanent: true }, { runId: ids[3], reason: "forbidden", permanent: false }],
          };
        },
      });
      assert.equal(sent.declarations, "{}");
      assert.equal(sent.records.length, 4);
      assert.equal(summary.submitted, 1);
      assert.deepEqual(summary.quarantined, [{ runId: ids[1], reason: "invalid: runner" }]);
      assert.equal(summary.pending, 2, "a non-permanent refusal stays pending for repair");
      assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith(".json")).sort(), [`${ids[2]}.json`, `${ids[3]}.json`]);
      const quarantine = readQuarantine({ directory: dir });
      assert.deepEqual(quarantine.entries.map((e) => [e.runId, e.reason]), [[ids[1], "invalid: runner"]]);
      assert.equal(quarantine.coverageLoss, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the quarantine is bounded: the oldest entries go, but the coverage-loss count never shrinks", async () => {
    const dir = tempRepo();
    try {
      const ids = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-00000000010${i}`);
      for (const runId of ids) spoolRecord(record({ runId }), { directory: dir });
      await flushSpool({
        directory: dir,
        quarantineLimit: 2,
        call: async (args) => ({ acknowledged: [], refused: args.records.map((r) => ({ runId: r.runId, reason: "schema", permanent: true })) }),
      });
      const quarantine = readQuarantine({ directory: dir });
      assert.equal(quarantine.entries.length, 2);
      assert.equal(quarantine.coverageLoss, 4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a transport failure keeps every file for the next flush", async () => {
    const dir = tempRepo();
    try {
      spoolRecord(record(), { directory: dir });
      const summary = await flushSpool({ directory: dir, call: async () => { throw new Error("ECONNREFUSED"); } });
      assert.equal(summary.error, "ECONNREFUSED");
      assert.equal(summary.pending, 1);
      assert.equal(readdirSync(dir).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("policyGuardResults", () => {
  it("maps preflight entries to policy results, marks the guard loop aggregate, and skips unplanned ids", () => {
    const root = tempRepo({ "scripts/check-a.mjs": "a", "scripts/check-guards.mjs": "loop" });
    try {
      const plan = [
        { id: "a-guard", commands: [["node", ["scripts/check-a.mjs"]]] },
        { id: "repo-guard-loop", commands: [["node", ["scripts/check-guards.mjs"]]] },
      ];
      const entries = [
        { id: "a-guard", status: "failed", durationMs: 40 },
        { id: "repo-guard-loop", status: "passed", durationMs: 900 },
        { id: "not-planned", status: "passed", durationMs: 1 },
      ];
      const results = policyGuardResults(entries, plan, { repoRoot: root });
      assert.deepEqual(
        results.map((r) => [r.guardId, r.kind, r.verdict, r.durationMs]),
        [["policy:a-guard", "guard", "refused", 40], ["policy:repo-guard-loop", "aggregate", "passed", 900]],
      );
      assert.match(results[0].guardDigest, /^[0-9a-f]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("recordGuardRun", () => {
  it("never throws: a broken git or submit is one logged line", async () => {
    const lines = [];
    const result = await recordGuardRun({
      runner: "guard-loop",
      guards: [],
      startedAt: Date.now(),
      durationMs: 1,
      exec: () => { throw new Error("no git"); },
      submit: async () => { throw new Error("unreachable"); },
      log: (line) => lines.push(line),
    });
    assert.equal(result.spooled.ok, false);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[guard-outcome\] not recorded:/);
  });
});
