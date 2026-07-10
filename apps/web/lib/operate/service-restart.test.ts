import { describe, expect, it } from "vitest";

import {
  restartPlatformService,
  resolveOwnComposeProject,
  type ShellExec,
} from "./service-restart";

function execScript(responses: Array<{ match: RegExp; stdout?: string; error?: string }>): {
  exec: ShellExec;
  calls: string[];
} {
  const calls: string[] = [];
  const exec: ShellExec = async (command) => {
    calls.push(command);
    const hit = responses.find((r) => r.match.test(command));
    if (!hit) throw new Error(`unexpected command: ${command}`);
    if (hit.error) throw new Error(hit.error);
    return { stdout: hit.stdout ?? "" };
  };
  return { exec, calls };
}

describe("resolveOwnComposeProject", () => {
  it("returns the compose project label", async () => {
    const { exec } = execScript([{ match: /docker inspect/, stdout: "dpf\n" }]);
    expect(await resolveOwnComposeProject(exec)).toBe("dpf");
  });

  it("returns null when not running under compose", async () => {
    const { exec } = execScript([{ match: /docker inspect/, error: "no such object" }]);
    expect(await resolveOwnComposeProject(exec)).toBeNull();
  });
});

describe("restartPlatformService", () => {
  it("rejects services outside the allowlist without shelling out", async () => {
    const { exec, calls } = execScript([]);
    const result = await restartPlatformService("edge-node; rm -rf /", exec);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid service");
    expect(calls).toHaveLength(0);
  });

  it("resolves the container by project+service labels and restarts it", async () => {
    const { exec, calls } = execScript([
      { match: /docker inspect/, stdout: "dpf\n" },
      { match: /docker ps -a/, stdout: "a2ac543779b1\tdpf-sandbox-1\n" },
      { match: /docker restart a2ac543779b1/, stdout: "a2ac543779b1\n" },
    ]);
    const result = await restartPlatformService("sandbox", exec);
    expect(result).toEqual({
      success: true,
      message: "Restarted sandbox (dpf-sandbox-1).",
      container: "dpf-sandbox-1",
    });
    expect(calls[1]).toContain('label=com.docker.compose.project=dpf');
    expect(calls[1]).toContain('label=com.docker.compose.service=sandbox');
  });

  it("reports a missing container instead of pretending success", async () => {
    const { exec } = execScript([
      { match: /docker inspect/, stdout: "dpf\n" },
      { match: /docker ps -a/, stdout: "\n" },
    ]);
    const result = await restartPlatformService("qdrant", exec);
    expect(result.success).toBe(false);
    expect(result.error).toBe("container_not_found");
  });

  it("refuses an ambiguous restart when project scope is unavailable", async () => {
    const { exec, calls } = execScript([
      { match: /docker inspect/, error: "not under compose" },
      { match: /docker ps -a/, stdout: "aaa\tdpf-sandbox-1\nbbb\twt-sandbox-1\n" },
    ]);
    const result = await restartPlatformService("sandbox", exec);
    expect(result.success).toBe(false);
    expect(result.error).toBe("ambiguous_container");
    // No project filter was applied (inspect failed) — that's WHY it's ambiguous.
    expect(calls[1]).not.toContain("compose.project");
  });

  it("surfaces the docker error when the restart itself fails", async () => {
    const { exec } = execScript([
      { match: /docker inspect/, stdout: "dpf\n" },
      { match: /docker ps -a/, stdout: "abc\tdpf-postgres-1\n" },
      { match: /docker restart abc/, error: "Cannot connect to the Docker daemon" },
    ]);
    const result = await restartPlatformService("postgres", exec);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Cannot connect to the Docker daemon");
  });
});
