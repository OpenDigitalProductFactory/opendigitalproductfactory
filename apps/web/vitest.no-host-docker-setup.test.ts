import { execFile, spawn, spawnSync, exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { HostDockerInTestError, launchReachesHostDocker, reachesHostDocker } from "./vitest.no-host-docker-setup";

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

  it("finds docker anywhere in a shell command, not only as its first word", async () => {
    expect(() => exec("cd /tmp && docker ps", () => undefined)).toThrow(HostDockerInTestError);
    await expect(promisify(exec)("echo start; DOCKER_HOST=x docker info")).rejects.toThrow(HostDockerInTestError);
    expect(() => spawn("sh", ["-c", "set -e; docker ps"])).toThrow(HostDockerInTestError);
    expect(() => spawnSync("bash", ["-lc", "(docker info)"])).toThrow(HostDockerInTestError);
    expect(() => spawn("echo ok && docker ps", { shell: true })).toThrow(HostDockerInTestError);
    // A string shell option is the program that runs: naming docker is refused before launch.
    expect(() => spawn("ls", ["-la"], { shell: "/usr/bin/docker" })).toThrow(HostDockerInTestError);
    expect(launchReachesHostDocker("spawn", ["ls", ["-la"], { shell: "docker" }])).toBe(true);
    expect(launchReachesHostDocker("spawn", ["ls", ["-la"], { shell: "/bin/sh" }])).toBe(false);
  });

  it("leaves other processes alone, including promisified output", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", "process.stdout.write('ok')"]);
    expect(stdout).toBe("ok");
    expect(reachesHostDocker("dockerd")).toBe(false);
    expect(reachesHostDocker("docker-compose")).toBe(false);
    expect(reachesHostDocker("echo dockerized", true)).toBe(false);
    expect(launchReachesHostDocker("spawn", ["sh", ["-c", "echo hello"]])).toBe(false);
    expect(launchReachesHostDocker("spawn", ["node", ["docker"]])).toBe(false);
  });
});

describe("vitest projects", () => {
  it("loads the guard for unit suites only, and runs the daemon suites in their own project", async () => {
    const config = await readFile(new URL("./vitest.config.ts", import.meta.url), "utf8");
    expect(config).toMatch(/name: "unit",[\s\S]*?exclude: DOCKER_INTEGRATION_SUITES,[\s\S]*?setupFiles: \["\.\/vitest\.no-host-docker-setup\.ts"\]/);
    expect(config).toMatch(/name: "docker-integration", include: DOCKER_INTEGRATION_SUITES \}/);
    expect(config).toMatch(/"\*\*\/\*\.docker\.test\.\{ts,tsx\}"/);
    expect(config).not.toMatch(/DPF_TEST_ALLOW_HOST_DOCKER/);
  });
});
