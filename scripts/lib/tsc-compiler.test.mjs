// scripts/lib/tsc-compiler.test.mjs — compiler selection behind scripts/run-tsc.mjs (BI-2B8D67A9).
// Node built-in test runner: node --test scripts/lib/tsc-compiler.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, resolveTs6Entry, resolveTs7Exe, selectTscCompiler } from "./tsc-compiler.mjs";

const RUN_TSC = join(REPO_ROOT, "scripts", "run-tsc.mjs");

const fakes = {
  cwd: "/pkg",
  execPath: "/node",
  forwardedArgs: ["--noEmit", "-p", "tsconfig.scripts.json"],
  resolveTs6Entry: (cwd) => `${cwd}/node_modules/typescript/bin/tsc`,
  resolveTs7Exe: () => "/ts7/tsc.exe",
};

test("TypeScript 7 is the default checker and runs as its native executable", async () => {
  const selected = await selectTscCompiler({ ...fakes, env: {} });
  assert.deepEqual(selected, { version: 7, command: "/ts7/tsc.exe", args: ["--noEmit", "-p", "tsconfig.scripts.json"] });
});

test("DPF_TSC=7 is the same as the default", async () => {
  assert.equal((await selectTscCompiler({ ...fakes, env: { DPF_TSC: " 7 " } })).version, 7);
});

test("DPF_TSC=6 selects the caller's TypeScript 6 under node with the 8 GB heap", async () => {
  const selected = await selectTscCompiler({ ...fakes, env: { DPF_TSC: "6" } });
  assert.deepEqual(selected, {
    version: 6,
    command: "/node",
    args: ["--max-old-space-size=8192", "/pkg/node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.scripts.json"],
  });
});

test("an unknown DPF_TSC value is refused rather than guessed", async () => {
  await assert.rejects(selectTscCompiler({ ...fakes, env: { DPF_TSC: "5" } }), /DPF_TSC must be 6 or 7 \(got "5"\)/);
});

test("both real compilers resolve in this workspace", async () => {
  assert.ok(existsSync(await resolveTs7Exe()), "TS7 native executable on disk");
  assert.ok(existsSync(resolveTs6Entry(REPO_ROOT)), "TS6 bin/tsc on disk");
});

function fixture(source) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-run-tsc-"));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, files: ["a.ts"] }));
  writeFileSync(join(dir, "a.ts"), source);
  return dir;
}

for (const compiler of ["6", "7"]) {
  test(`run-tsc reports the same verdict on TS${compiler}: clean passes, a type error fails with its diagnostic`, () => {
    const clean = fixture("export const n: number = 1;\n");
    const broken = fixture("export const n: number = 'one';\n");
    try {
      const env = { ...process.env, DPF_TSC: compiler };
      const ok = spawnSync(process.execPath, [RUN_TSC, "--noEmit", "-p", join(clean, "tsconfig.json")], { cwd: REPO_ROOT, env, encoding: "utf8" });
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      assert.match(ok.stderr, new RegExp(`\\[run-tsc\\] checking with TypeScript ${compiler}\\b`));
      const bad = spawnSync(process.execPath, [RUN_TSC, "--noEmit", "--pretty", "false", "-p", join(broken, "tsconfig.json")], { cwd: REPO_ROOT, env, encoding: "utf8" });
      assert.notEqual(bad.status, 0);
      assert.notEqual(bad.status, 88, "a type error is a verdict, not a terminated compiler");
      assert.match(bad.stdout, /a\.ts\(1,14\): error TS2322/);
    } finally {
      rmSync(clean, { recursive: true, force: true });
      rmSync(broken, { recursive: true, force: true });
    }
  });
}

// BI-27D3DCCD: a compiler the OS killed reached no verdict and must exit 88.
// POSIX only: Windows has no signals to deliver, and an externally terminated
// Windows process reports an exit code, not a signal, on every compiler.
test("run-tsc maps a signal-killed TS7 compiler to exit 88", { skip: process.platform === "win32" }, async () => {
  const dir = fixture("export const n: number = 1;\n");
  try {
    const child = spawn(process.execPath, [RUN_TSC, "--watch", "--preserveWatchOutput", "-p", join(dir, "tsconfig.json")], {
      cwd: REPO_ROOT, env: { ...process.env, DPF_TSC: "7" }, stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve) => child.stdout.on("data", (chunk) => /Watching for file changes/.test(String(chunk)) && resolve()));
    const kids = spawnSync("pgrep", ["-P", String(child.pid)], { encoding: "utf8" }).stdout.trim().split(/\s+/).filter(Boolean);
    assert.equal(kids.length, 1, "run-tsc spawns exactly one compiler process");
    process.kill(Number(kids[0]), "SIGKILL");
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 88);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
