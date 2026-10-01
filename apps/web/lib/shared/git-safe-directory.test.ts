import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureGlobalSafeDirectoryCommand } from "./git-safe-directory";

const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
const BASH = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
const SHELL_OK = spawnSync(BASH, ["-c", "git --version"], { encoding: "utf8" }).status === 0;

function safeDirectoryValues(configPath: string): string[] {
  if (!existsSync(configPath)) return [];
  return [...readFileSync(configPath, "utf8").matchAll(/^\s*directory\s*=\s*(.*?)\s*$/gm)].map((m) => m[1]);
}

describe.skipIf(!SHELL_OK)("ensureGlobalSafeDirectoryCommand (BI-249EEA02)", () => {
  it("adds each value once no matter how often the step runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "dpf-safe-dir-helper-"));
    const configPath = join(dir, "gitconfig");
    try {
      const step = [
        ensureGlobalSafeDirectoryCommand("'*'"),
        ensureGlobalSafeDirectoryCommand('"/workspace"'),
      ].join(" && ");
      // The steps run in Linux containers; stop Git Bash rewriting "/workspace"
      // into a Windows path so the Windows run checks the same bytes.
      for (let run = 0; run < 3; run += 1) {
        const r = spawnSync(BASH, ["-c", step], {
          encoding: "utf8",
          env: { ...process.env, GIT_CONFIG_GLOBAL: configPath, GIT_CONFIG_NOSYSTEM: "1", MSYS_NO_PATHCONV: "1" },
        });
        expect(r.status, r.stderr).toBe(0);
      }
      expect(safeDirectoryValues(configPath)).toEqual(["*", "/workspace"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
