import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BASH_COMMAND, BASH_OK, makeFakeBin, reassessmentCapabilityFixture, shellQuote, toBashPath } from "./promote-script-functional.test-support";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dpf-fake-docker-"));
  roots.push(root);
  const bin = makeFakeBin(root);
  const assets = join(root, "source assets.Id.Os.Architecture");
  mkdirSync(assets);
  const content = "services: {}\n";
  const checksum = `${createHash("sha256").update(content).digest("hex")}  ./docker-compose.yml\n`;
  writeFileSync(join(assets, "docker-compose.yml"), content);
  writeFileSync(join(assets, "SHA256SUMS"), checksum);
  const invoke = (args: string[], overrides: Partial<NodeJS.ProcessEnv> = {}) => spawnSync(
    BASH_COMMAND, ["-lc", `exec ${[toBashPath(join(bin, "docker")), ...args].map(shellQuote).join(" ")}`], {
      encoding: "utf8",
      env: {
        ...process.env,
        DOCKER_LOG: toBashPath(join(root, "docker.log")),
        DPF_TEST_RELEASE_ASSETS: toBashPath(assets),
        DPF_TEST_RELEASE_ENGINE_ID: "sha256:fixture-engine",
        DPF_TEST_RELEASE_CONFIG_DIGEST: "sha256:fixture-config",
        DPF_TEST_RELEASE_OS: "linux",
        DPF_TEST_RELEASE_ARCHITECTURE: "amd64",
        DPF_TEST_RELEASE_REPO: "fixture/release",
        DPF_TEST_RELEASE_REPO_ID: "sha256:fixture-repo",
        DPF_TEST_RELEASE_TAG: "fixture-version",
        DPF_TEST_RELEASE_SHA: "fixture-revision",
        ...overrides,
      },
    },
  );
  return { root, assets, invoke, content, checksum };
}

describe.skipIf(!BASH_OK)("promoter fake Docker argv dispatch", () => {
  it("keeps timed probes inside the companion fake Docker regardless of PATH", () => {
    const { root } = fixture();
    const report = reassessmentCapabilityFixture("a".repeat(40));
    const result = spawnSync(BASH_COMMAND, ["-lc", `exec ${[toBashPath(join(root, "bin", "timeout")), "-k", "5", "60", "docker", "run", "/app/scripts/reassessment-capability-probe.mjs"].map(shellQuote).join(" ")}`], {
      encoding: "utf8", env: { ...process.env, DPF_TEST_REASSESSMENT_REPORT: report, DOCKER_LOG: toBashPath(join(root, "docker.log")) },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(JSON.parse(report));
  });
  it("refuses probe calls when no explicit fixture evidence was supplied", () => {
    const { invoke } = fixture();
    expect(invoke(["run", "/app/scripts/reassessment-capability-probe.mjs"], { DPF_TEST_REASSESSMENT_REPORT: "" }).status).toBe(78);
  });
  it.each(["IdXXXX", "OsXXXX", "ArchitectureXXXX", "safeXXXX"])("copies assets to a spaced destination ending .%s", (suffix) => {
    const { root, invoke, content, checksum } = fixture();
    const destination = join(root, `destination with spaces.${suffix}`);
    const r = invoke(["cp", "candidate-container:/dpf-release-assets/.", toBashPath(destination)]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("");
    expect(readFileSync(join(destination, "SHA256SUMS"), "utf8")).toBe(checksum);
    expect(readFileSync(join(destination, "docker-compose.yml"), "utf8")).toBe(content);
  });

  it("propagates a missing source error instead of returning success", () => {
    const { root, invoke } = fixture();
    const destination = join(root, "destination");
    const r = invoke(["cp", "candidate-container:/dpf-release-assets/.", toBashPath(destination)], {
      DPF_TEST_RELEASE_ASSETS: toBashPath(join(root, "missing-source")),
    });
    expect(r.status).not.toBeNull();
    expect(r.status).not.toBe(0);
    expect(existsSync(join(destination, "SHA256SUMS"))).toBe(false);
  });

  it("routes create and rm by operation even when their target resembles a format", () => {
    const { root, invoke } = fixture();
    expect(invoke(["create", "fixture.Id.Os.Architecture"]).stdout).toBe("candidate-container");
    const r = invoke(["rm", "fixture.Id.Os.Architecture"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(readFileSync(join(root, "docker.log"), "utf8")).toContain("reconcile-remove rm fixture.Id.Os.Architecture");
  });

  it("propagates failure when the destination cannot be a directory", () => {
    const { root, invoke } = fixture();
    const destination = join(root, "existing-file.Os");
    writeFileSync(destination, "keep this file");
    const r = invoke(["cp", "candidate-container:/dpf-release-assets/.", toBashPath(destination)]);
    expect(r.status).not.toBeNull();
    expect(r.status).not.toBe(0);
    expect(readFileSync(destination, "utf8")).toBe("keep this file");
  });

  it.each([
    ["{{.Id}}", "sha256:fixture-engine"],
    ["{{.Os}}", "linux"],
    ["{{.Architecture}}", "amd64"],
    ["{{range .RepoDigests}}{{println .}}{{end}}", "fixture/release@sha256:fixture-repo\n"],
    ['{{ index .Config.Labels "org.opencontainers.image.version" }}', "fixture-version"],
    ['{{ index .Config.Labels "org.opencontainers.image.revision" }}', "fixture-revision"],
  ])("uses only inspect format %s, not the target name", (format, expected) => {
    const { invoke } = fixture();
    for (const args of [
      ["image", "inspect", "target.Id.Os.Architecture", "--format", format],
      ["inspect", "--format", format, "target.Id.Os.Architecture"],
      ["image", "inspect", `--format=${format}`, "target.Id.Os.Architecture"],
      ["image", "inspect", "-f", format, "target.Id.Os.Architecture"],
    ]) {
      const r = invoke(args);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe(expected);
    }
  });

  it("does not treat a non-inspect operation's arguments as a format", () => {
    const { invoke } = fixture();
    expect(invoke(["pull", "fixture.Id.Os.Architecture"]).stdout).toBe("");
  });
});
