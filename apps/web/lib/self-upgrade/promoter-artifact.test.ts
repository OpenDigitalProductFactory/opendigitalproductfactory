import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ readFile: vi.fn(), rm: vi.fn(), stage: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: io.readFile, rm: io.rm }));
vi.mock("./promoter-build-context", () => ({
  PROMOTER_DOCKERFILE: "Dockerfile.promoter",
  stageMinimalPromoterBuildContext: io.stage,
}));

import { buildCandidatePromoterArtifactImage } from "./promoter-artifact";

const targetSha = "a".repeat(40);
const params = { sourcePath: "/labelled-fixture-source", targetSha };
const context = "/labelled-fixture-context";

// All runner output is synthetic. No Docker command or production build runs.
async function failure(stdout: string, stderr: string): Promise<string> {
  try {
    await buildCandidatePromoterArtifactImage(params, async () => ({ exitCode: 1, stdout, stderr }));
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected the injected runner to fail");
}

beforeEach(() => {
  vi.resetAllMocks();
  io.readFile.mockResolvedValue(Buffer.from('{"schemaVersion":1}'));
  io.stage.mockResolvedValue(context);
  io.rm.mockResolvedValue(undefined);
});

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
    expect(io.rm).toHaveBeenCalledWith(context, { recursive: true, force: true });
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
    expect(io.rm).toHaveBeenCalledWith(context, { recursive: true, force: true });
  });

  it("does not build or inspect a configured custom artifact", async () => {
    const runner = vi.fn();
    await expect(buildCandidatePromoterArtifactImage({ ...params, promoterImage: "registry.invalid/promoter:fixture" }, runner)).resolves.toBe("registry.invalid/promoter:fixture");
    expect(runner).not.toHaveBeenCalled();
    expect(io.stage).not.toHaveBeenCalled();
  });

  it("still cleans staging if the injected runner rejects", async () => {
    await expect(buildCandidatePromoterArtifactImage(params, async () => { throw new Error("labelled spawn failure"); })).rejects.toThrow("labelled spawn failure");
    expect(io.rm).toHaveBeenCalledWith(context, { recursive: true, force: true });
  });
});
