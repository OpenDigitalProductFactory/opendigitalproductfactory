import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  managedScriptRootCandidates,
  resolveManagedScriptPath,
  runManagedScript,
} from "./managed-script-path";

const SCRIPT = "backup-postgres.sh";

function existsOnly(paths: string[]) {
  const available = new Set(paths);
  return (candidate: string) => available.has(candidate);
}

describe("managed backup script path resolution", () => {
  it("prefers the bundled production script when /workspace is incomplete", () => {
    const path = resolveManagedScriptPath(SCRIPT, {
      env: { PROJECT_ROOT: "/workspace" },
      existsSync: existsOnly([`/app/scripts/${SCRIPT}`]),
    });

    expect(path).toBe(`/app/scripts/${SCRIPT}`);
  });

  it("falls back to the mounted install source when the image does not carry the script", () => {
    const path = resolveManagedScriptPath(SCRIPT, {
      env: { PROJECT_ROOT: "/workspace" },
      existsSync: existsOnly([`/host-dpf/scripts/${SCRIPT}`]),
    });

    expect(path).toBe(`/host-dpf/scripts/${SCRIPT}`);
  });

  it("honors an explicit script root override before bundled defaults", () => {
    const path = resolveManagedScriptPath(SCRIPT, {
      env: {
        DPF_MANAGED_SCRIPT_DIR: "/custom/scripts",
        PROJECT_ROOT: "/workspace",
      },
      existsSync: existsOnly([`/custom/scripts/${SCRIPT}`, `/app/scripts/${SCRIPT}`]),
    });

    expect(path).toBe(`/custom/scripts/${SCRIPT}`);
  });

  it("keeps root candidates stable and duplicate-free", () => {
    expect(
      managedScriptRootCandidates({
        DPF_MANAGED_SCRIPT_DIR: "/custom/scripts",
        PROJECT_ROOT: "/workspace",
      }),
    ).toEqual([
      "/custom/scripts",
      "/app/scripts",
      "/workspace/scripts",
      "/host-dpf/scripts",
    ]);
  });
});

// Regression guard for the 2026-06-06 self-upgrade incident: all three
// pre-upgrade backups failed in <25ms with "runner exited -1" because the
// scripts were copied into the image as mode 0644 and exec'd directly, which
// requires the executable bit. runManagedScript invokes them via `/bin/sh`,
// so the bit is no longer load-bearing. These spawn-level checks need a POSIX
// shell; on Windows (where Mark runs vitest locally) there is no /bin/sh, so
// they are skipped there and exercised by the Linux CI run.
const isWindows = process.platform === "win32";

describe("runManagedScript", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  async function writeScript(name: string, body: string): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "managed-script-"));
    tempDirs.push(dir);
    const file = path.join(dir, name);
    // Explicit 0644 — NO executable bit. This is exactly the mode the image
    // ships, and the whole point of routing through /bin/sh.
    await fs.writeFile(file, body, { mode: 0o644 });
    return file;
  }

  it.skipIf(isWindows)(
    "runs a script that lacks the executable bit",
    async () => {
      const script = await writeScript(
        "noexec.sh",
        "#!/bin/sh\necho managed-ok\n",
      );
      const outcome = await runManagedScript(script);
      expect(outcome.ok).toBe(true);
      expect(outcome.exitCode).toBe(0);
      expect(outcome.stdout.trim()).toBe("managed-ok");
    },
  );

  it.skipIf(isWindows)(
    "returns a legible failure (not a throw) when the script is missing",
    async () => {
      const outcome = await runManagedScript("/nonexistent/managed-script.sh");
      expect(outcome.ok).toBe(false);
      expect(outcome.exitCode).not.toBe(0);
      expect(outcome.stderr.length).toBeGreaterThan(0);
    },
  );

  it.skipIf(isWindows)(
    "propagates a non-zero exit code from the script body",
    async () => {
      const script = await writeScript(
        "fail.sh",
        "#!/bin/sh\necho boom 1>&2\nexit 7\n",
      );
      const outcome = await runManagedScript(script);
      expect(outcome.ok).toBe(false);
      expect(outcome.exitCode).toBe(7);
      expect(outcome.stderr).toContain("boom");
    },
  );
});

// Defense-in-depth guard: the runtime image must restore the executable bit so
// a direct exec (any call site that doesn't go through runManagedScript) still
// works. Cross-platform — it only reads the Dockerfile.
describe("Dockerfile managed-script executability", () => {
  it("chmod +x's the managed scripts in the runner stage", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // apps/web/lib/operate/backups -> repo root is five levels up.
    const dockerfile = path.resolve(here, "../../../../../Dockerfile");
    const contents = await fs.readFile(dockerfile, "utf-8");
    expect(contents).toMatch(/chmod\s+\+x\s+\.\/scripts\/\*\.sh/);
  });
});
