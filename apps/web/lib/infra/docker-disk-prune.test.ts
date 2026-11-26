import { describe, expect, it } from "vitest";

import { pruneDockerDisk, pruneDockerDiskAtDaemon, type DiskPruneExec } from "./docker-disk-prune";

function scripted(responses: Array<{ match: RegExp; stdout?: string; error?: string }>) {
  const calls: string[] = [];
  const exec: DiskPruneExec = async (command) => {
    calls.push(command);
    const hit = responses.find((response) => response.match.test(command));
    if (!hit) throw new Error(`unexpected command: ${command}`);
    if (hit.error) throw new Error(hit.error);
    return { stdout: hit.stdout ?? "" };
  };
  return { exec, calls };
}

describe("pruneDockerDisk", () => {
  it("uses only the private actuator when it is mounted", async () => {
    const { exec, calls } = scripted([]);
    const result = await pruneDockerDisk({
      actuator: { available: async () => true, prune: async () => ({ prunedDockerDisk: true, promoter: { removed: 2 } }) },
      exec,
    });
    expect(result).toEqual({ prunedDockerDisk: true, promoter: { removed: 2 } });
    expect(calls).toEqual([]);
  });

  it("reports an actuator failure instead of falling back to local Docker", async () => {
    const { exec, calls } = scripted([]);
    const result = await pruneDockerDisk({
      actuator: { available: async () => true, prune: async () => { throw new Error("scope_writer_observation_unavailable"); } },
      exec,
    });
    expect(result).toEqual({ prunedDockerDisk: false, error: "actuator_prune_unavailable" });
    expect(calls).toEqual([]);
  });
});

describe("pruneDockerDiskAtDaemon", () => {
  it("keeps the three newest promoter images and reports each category", async () => {
    const { exec, calls } = scripted([
      { match: /^docker images dpf-promoter /, stdout: [
        "dpf-promoter:a||2026-11-01 00:00:00 +0000 UTC",
        "dpf-promoter:b||2026-11-04 00:00:00 +0000 UTC",
        "dpf-promoter:c||2026-11-03 00:00:00 +0000 UTC",
        "dpf-promoter:d||2026-11-02 00:00:00 +0000 UTC",
      ].join("\n") },
      { match: /^docker image rm -f dpf-promoter:a$/ },
      { match: /^docker images --format/, stdout: "" },
      { match: /^docker ps -a --format/, stdout: "" },
      { match: /^docker image prune -f --filter until=48h$/ },
      { match: /^docker builder prune -f --keep-storage 20gb$/ },
    ]);
    const result = await pruneDockerDiskAtDaemon(exec);
    expect(result.promoter).toEqual({ found: 4, removed: 1, failed: 0 });
    expect(result.danglingAndCache).toBe("pruned");
    expect(calls.filter((command) => command.startsWith("docker image rm"))).toEqual(["docker image rm -f dpf-promoter:a"]);
  });
});
