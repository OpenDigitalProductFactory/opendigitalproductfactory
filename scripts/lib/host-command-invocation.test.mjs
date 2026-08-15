import assert from "node:assert/strict";
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
