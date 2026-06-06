import { describe, expect, it } from "vitest";

import {
  managedScriptRootCandidates,
  resolveManagedScriptPath,
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
