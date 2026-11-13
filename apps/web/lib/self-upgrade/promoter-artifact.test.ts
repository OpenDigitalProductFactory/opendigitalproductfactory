import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./promoter-build-context", async (orig) => ({
  ...(await orig<typeof import("./promoter-build-context")>()),
  stageMinimalPromoterBuildContext: vi.fn(async () => mkdtemp(join(tmpdir(), "promoter-ctx-"))),
}));

import { buildCandidatePromoterArtifactImage, type ArtifactDockerResult } from "./promoter-artifact";

const SHA = "a".repeat(40);
const APK_NETWORK =
  "#6 3.1 WARNING: fetching https://dl-cdn.alpinelinux.org/alpine/v3.24/main: network error (check Internet connectivity and network settings)";

describe("buildCandidatePromoterArtifactImage — transient network (BI-7FFF5CB0)", () => {
  let source: string;
  beforeEach(async () => {
    source = await mkdtemp(join(tmpdir(), "promoter-src-"));
    await writeFile(join(source, "promoter-contract.json"), "{}");
  });
  afterEach(async () => { await rm(source, { recursive: true, force: true }); });

  const failure = (stderr: string): ArtifactDockerResult => ({ exitCode: 1, stdout: "", stderr });

  it("retries the candidate build when the failure is a network fetch, then succeeds", async () => {
    const results = [failure(`${APK_NETWORK}\nERROR: failed to solve: exit code: 9`), { exitCode: 0, stdout: "", stderr: "" }];
    const runDocker = vi.fn(async () => results.shift()!);
    const image = await buildCandidatePromoterArtifactImage(
      { sourcePath: source, targetSha: SHA, networkRetryDelayMs: 0 },
      runDocker,
    );
    expect(image).toBe(`dpf-promoter:${SHA}`);
    expect(runDocker).toHaveBeenCalledTimes(2);
  });

  it("does not retry a deterministic build failure", async () => {
    const runDocker = vi.fn(async () => failure("ERROR: unable to select packages:\n  foo (no such package)"));
    await expect(buildCandidatePromoterArtifactImage(
      { sourcePath: source, targetSha: SHA, networkRetryDelayMs: 0 },
      runDocker,
    )).rejects.toThrow(/promoter_candidate_build_failed: .*no such package/s);
    expect(runDocker).toHaveBeenCalledTimes(1);
  });

  it("names the network cause when every attempt fails, instead of a truncated tail", async () => {
    const padded = [APK_NETWORK, ...Array.from({ length: 30 }, () => "#7 noise ".repeat(8)),
      "ERROR: failed to build: failed to solve: process did not complete successfully: exit code: 14"].join("\n");
    const runDocker = vi.fn(async () => failure(padded));
    await expect(buildCandidatePromoterArtifactImage(
      { sourcePath: source, targetSha: SHA, networkRetryDelayMs: 0 },
      runDocker,
    )).rejects.toThrow(/network error \(check Internet connectivity/);
    expect(runDocker.mock.calls.length).toBeGreaterThan(1);
  });
});
