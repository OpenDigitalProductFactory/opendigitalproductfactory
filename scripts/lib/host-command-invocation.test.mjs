import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { resolveHostCommandInvocation } from "./host-command-invocation.mjs";

test("Windows resolves pnpm through ComSpec instead of spawning pnpm.cmd directly", () => {
  assert.deepEqual(
    resolveHostCommandInvocation("pnpm", ["install", "--prefer-offline", "--frozen-lockfile"], {
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "pnpm install --prefer-offline --frozen-lockfile"],
    },
  );
});

test("Windows quotes a resolved cmd shim path that contains spaces", () => {
  assert.deepEqual(
    resolveHostCommandInvocation("C:\\Users\\Mark Bodman\\npm\\pnpm.CMD", ["--version"], {
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/c",
        'call "C:\\Users\\Mark Bodman\\npm\\pnpm.CMD" --version',
      ],
    },
  );
});

test("Windows executes a resolved cmd shim whose path contains spaces", {
  skip: process.platform !== "win32",
}, () => {
  const fixture = mkdtempSync(join(tmpdir(), "dpf cmd shim "));
  const bin = join(fixture, "host bin");
  const shim = join(bin, "pnpm.CMD");
  mkdirSync(bin, { recursive: true });
  writeFileSync(shim, "@echo 10.33.2\r\n");
  try {
    const invocation = resolveHostCommandInvocation(shim, ["--version"], {
      platform: "win32",
      env: process.env,
    });
    const result = spawnSync(invocation.command, invocation.args, {
      encoding: "utf8",
      env: process.env,
      windowsVerbatimArguments: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "10.33.2");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("non-Windows commands retain their executable and argument boundaries", () => {
  assert.deepEqual(
    resolveHostCommandInvocation("pnpm", ["install", "--frozen-lockfile"], { platform: "linux" }),
    { command: "pnpm", args: ["install", "--frozen-lockfile"] },
  );
});

test("Windows cmd metacharacters are quoted without enabling global shell mode", () => {
  assert.deepEqual(
    resolveHostCommandInvocation("pnpm", ["run", "check name", "100%"], {
      platform: "win32",
      env: { COMSPEC: "C:\\Windows\\cmd.exe" },
    }),
    {
      command: "C:\\Windows\\cmd.exe",
      args: ["/d", "/s", "/c", 'pnpm run "check name" "100%%"'],
    },
  );
});
