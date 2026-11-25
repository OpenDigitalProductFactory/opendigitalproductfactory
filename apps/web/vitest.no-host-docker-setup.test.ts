import { execFile, spawn, spawnSync, exec } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { HostDockerInTestError, isDockerIntegrationSuite, reachesHostDocker } from "./vitest.no-host-docker-setup";

describe("no host Docker in unit tests", () => {
  it("refuses every launcher that would run the Docker executable", async () => {
    // ambient-host-guard: allow proving the setup guard throws before any process starts; docker is never launched
    expect(() => spawn("docker", ["ps"])).toThrow(HostDockerInTestError);
    expect(() => spawn("/usr/bin/docker", ["ps"])).toThrow(HostDockerInTestError);
    // ambient-host-guard: allow proving the setup guard throws before any process starts; docker is never launched
    expect(() => spawnSync("docker", ["info"])).toThrow(HostDockerInTestError);
    // ambient-host-guard: allow proving the setup guard throws before any process starts; docker is never launched
    expect(() => execFile("docker", ["ps"], () => undefined)).toThrow(HostDockerInTestError);
    // ambient-host-guard: allow proving the setup guard throws before any process starts; docker is never launched
    expect(() => exec("docker ps", () => undefined)).toThrow(HostDockerInTestError);
    await expect(promisify(execFile)("docker", ["ps"])).rejects.toThrow(HostDockerInTestError);
    await expect(promisify(exec)("/usr/local/bin/docker rm -f x")).rejects.toThrow(HostDockerInTestError);
  });

  it("leaves other processes alone, including promisified output", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", "process.stdout.write('ok')"]);
    expect(stdout).toBe("ok");
    expect(reachesHostDocker("dockerd")).toBe(false);
    expect(reachesHostDocker("echo docker ps", true)).toBe(false);
    expect(reachesHostDocker("docker-compose")).toBe(false);
  });
});

describe("integration suites", () => {
  it("lets only the named, self-gated Docker integration suites reach the daemon", () => {
    expect(isDockerIntegrationSuite("/repo/apps/web/lib/documents/conversion/convert.docker.test.ts")).toBe(true);
    expect(isDockerIntegrationSuite("/repo/apps/web/lib/self-upgrade/doctools-source-lineage.network.test.ts")).toBe(true);
    expect(isDockerIntegrationSuite("/repo/apps/web/lib/inference/local-provider-compose.test.ts")).toBe(true);
    expect(isDockerIntegrationSuite("/repo/apps/web/lib/self-upgrade/promoter-sweep.test.ts")).toBe(false);
    expect(isDockerIntegrationSuite("/repo/apps/web/vitest.no-host-docker-setup.test.ts")).toBe(false);
    expect(isDockerIntegrationSuite(undefined)).toBe(false);
  });
});
