import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ stage: vi.fn() }));
vi.mock("./promoter-build-context", () => ({
  PROMOTER_DOCKERFILE: "Dockerfile.promoter",
  stageMinimalPromoterBuildContext: io.stage,
}));

import { buildCandidatePromoterArtifactImage, type ArtifactDockerResult } from "./promoter-artifact";

const targetSha = "a".repeat(40);
let source: string;
let context: string;
let params: { sourcePath: string; targetSha: string; networkRetryDelayMs: number };

beforeEach(async () => {
  vi.resetAllMocks();
  source = await mkdtemp(join(tmpdir(), "promoter-source-fixture-"));
  context = await mkdtemp(join(tmpdir(), "promoter-context-fixture-"));
  await writeFile(join(source, "promoter-contract.json"), '{"schemaVersion":1}');
  io.stage.mockResolvedValue(context);
  params = { sourcePath: source, targetSha, networkRetryDelayMs: 0 };
});
afterEach(async () => {
  await Promise.all([source, context].map(path => rm(path, { recursive: true, force: true })));
});

// All runner output is synthetic. No Docker command or production build runs.
async function failure(stdout: string, stderr: string): Promise<string> {
  try {
    await buildCandidatePromoterArtifactImage(params, async () => ({ exitCode: 1, stdout, stderr }));
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected the injected runner to fail");
}

describe("candidate-promoter failure evidence", () => {
  it("keeps a leading causal line and the final Docker summary", async () => {
    const causal = "ERROR: labelled fixture package download failed";
    const terminal = "process package-install exited9";
    const message = await failure("", `${causal}\n${"labelled summary\n".repeat(1200)}${terminal}`);
    expect(message).toContain(causal);
    expect(message).toContain(terminal);
    expect(message).toContain("chars elided");
    expect(message).toContain("promoter_candidate_build_failed: exit code 1");
    expect(message.length).toBeLessThanOrEqual(12_100);
    await expect(access(context)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not let stderr wrapper noise erase useful stdout", async () => {
    const message = await failure("ERROR: labelled stdout causal failure", "labelled stderr wrapper");
    expect(message).toContain("--- stdout ---");
    expect(message).toContain("ERROR: labelled stdout causal failure");
    expect(message).toContain("--- stderr ---");
    expect(message).toContain("labelled stderr wrapper");
  });

  it("bounds both streams without dropping either beginning or end", async () => {
    const message = await failure(`stdout-start${"x".repeat(20_000)}stdout-end`, `stderr-start${"y".repeat(20_000)}stderr-end`);
    for (const marker of ["stdout-start", "stdout-end", "stderr-start", "stderr-end"]) expect(message).toContain(marker);
    expect(message.match(/chars elided/g)).toHaveLength(2);
    expect(message.length).toBeLessThanOrEqual(12_100);
  });

  it("states when output is unavailable without inventing a package cause", async () => {
    const message = await failure("  ", "\n");
    expect(message).toContain("exit code 1");
    expect(message).toContain("No Docker diagnostic output was captured; cause unknown.");
  });

  it("redacts credentials in both streams before excerpts are selected", async () => {
    const secret = "synthetic-fixture-value";
    const message = await failure(`password=${secret}\nhttps://fixture:${secret}@registry.invalid`, `token=${secret}\nBearer fixture-session`);
    expect(message).not.toContain(secret);
    expect(message).not.toContain("fixture-session");
    expect(message).toContain("registry.invalid");
    expect(message).toContain("redacted");
  });

  it("redacts a recognized credential that spans an excerpt boundary", async () => {
    const credential = `dpfmcp_${"synthetic".repeat(2000)}`;
    const message = await failure("", `leading\n${credential}\ntrailing`);
    expect(message).toContain("leading");
    expect(message).toContain("trailing");
    expect(message).not.toContain("synthetic");
    expect(message).toContain("[redacted-token]");
  });

  it("keeps success and target-specific identity unchanged and cleans staging", async () => {
    const runner = vi.fn(async (_args: string[]) => ({ exitCode: 0, stdout: "success", stderr: "" }));
    await expect(buildCandidatePromoterArtifactImage(params, runner)).resolves.toBe(`dpf-promoter:${targetSha}`);
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(["--load", `DPF_PROMOTER_SOURCE_SHA=${targetSha}`, context]));
    await expect(access(context)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not build or inspect a configured custom artifact", async () => {
    const runner = vi.fn();
    await expect(buildCandidatePromoterArtifactImage({ ...params, promoterImage: "registry.invalid/promoter:fixture" }, runner)).resolves.toBe("registry.invalid/promoter:fixture");
    expect(runner).not.toHaveBeenCalled();
    expect(io.stage).not.toHaveBeenCalled();
  });

  it("still cleans staging if the injected runner rejects", async () => {
    await expect(buildCandidatePromoterArtifactImage(params, async () => { throw new Error("labelled spawn failure"); })).rejects.toThrow("labelled spawn failure");
    await expect(access(context)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

const SHA = "a".repeat(40);
const APK_NETWORK =
  "#6 3.1 WARNING: fetching https://dl-cdn.alpinelinux.org/alpine/v3.24/main: network error (check Internet connectivity and network settings)";

describe("buildCandidatePromoterArtifactImage — transient network (BI-7FFF5CB0)", () => {
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

  it("retains a buried network cause and redacts it in both the saved error and retry warnings", async () => {
    const secret = "synthetic-network-fixture";
    const cause = `${APK_NETWORK} https://fixture:${secret}@registry.invalid token=${secret}`;
    const output = `${"labelled preamble\n".repeat(1200)}${cause}\n${"labelled detail\n".repeat(1200)}final build failure`;
    const runDocker = vi.fn(async () => failure(output));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let message = "";
      try { await buildCandidatePromoterArtifactImage(params, runDocker); }
      catch (error) { message = (error as Error).message; }
      expect(message).toContain("network error (check Internet connectivity");
      expect(message).toContain("final build failure");
      expect(message).not.toContain(secret);
      expect(message.length).toBeLessThanOrEqual(12_100);
      expect(runDocker).toHaveBeenCalledTimes(3);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls.flat().join("\n")).not.toContain(secret);
      await expect(access(context)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { warn.mockRestore(); }
  });
});
