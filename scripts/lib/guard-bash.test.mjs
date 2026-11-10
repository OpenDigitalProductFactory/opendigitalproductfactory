import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveGuardBash, guardShellEnv } from "./guard-bash.mjs";

test("child shell PATH has one case-insensitive key and leaves caller unchanged", () => {
  const env = { Path: "C:\\Windows\\System32", KEEP: "value" };
  const result = guardShellEnv(env, { platform: "win32", resolveBash: () => "D:\\Git\\bin\\bash.exe" });
  assert.deepEqual(result, { Path: "D:\\Git\\bin;D:\\Git\\usr\\bin;C:\\Windows\\System32", KEEP: "value" });
  assert.deepEqual(env, { Path: "C:\\Windows\\System32", KEEP: "value" });
  assert.deepEqual(guardShellEnv(env, { platform: "linux" }), env);
});

test("POSIX keeps its native Bash without Windows discovery", () => {
  assert.equal(resolveGuardBash({ platform: "linux", spawn: () => assert.fail("unexpected probe") }), "bash");
});

test("Windows rejects WSL and finds Git Bash beside a custom git.exe", () => {
  const env = { Path: "C:\\Windows\\System32;D:\\Tools\\Git\\cmd" };
  const seen = [];
  const result = resolveGuardBash({ platform: "win32", env,
    exists: (path) => path === "D:\\Tools\\Git\\cmd\\git.exe",
    spawn: (command, args, options) => {
      seen.push(command);
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 5000);
      assert.ok(args.includes("--noprofile"));
      return command === "D:\\Tools\\Git\\bin\\bash.exe"
        ? { status: 0, stdout: "dpf-native-bash" } : { status: 127, stdout: "" };
    },
  });
  assert.equal(result, "D:\\Tools\\Git\\bin\\bash.exe");
  assert.ok(seen.includes("C:\\Windows\\System32\\bash.exe"));
  assert.deepEqual(env, { Path: "C:\\Windows\\System32;D:\\Tools\\Git\\cmd" });
});

test("Windows tries the per-user Git installation", () => {
  const env = { LOCALAPPDATA: "D:\\User Profile\\AppData\\Local" };
  assert.equal(resolveGuardBash({ platform: "win32", env, exists: () => false,
    spawn: (command) => command.startsWith(env.LOCALAPPDATA)
      ? { status: 0, stdout: "dpf-native-bash" } : { status: null, error: new Error("ENOENT") },
  }), "D:\\User Profile\\AppData\\Local\\Programs\\Git\\bin\\bash.exe");
});

test("missing or unusable shells report infrastructure, never skip or pass", () => {
  assert.throws(() => resolveGuardBash({ platform: "win32", env: {}, exists: () => false,
    spawn: () => ({ status: 0, stdout: "not a Windows-compatible Bash" }),
  }), { name: "GuardRuntimeEnvironmentError", message: /Git for Windows/ });
});
