// Network-gated proof of the customizable-install precondition for retiring the
// in-process document parsers (BI-D1B40D43, slice S9 of BI-815D40C6).
//
// S9 removes mammoth, read-excel-file and pdf-parse, so .docx, .xlsx and .pdf
// reading depends on the dpf-doctools engine on every install shape. A
// customizable (source-built) install finds its engine from the release its
// clone descends from (BI-4E18BC28). This runs that real resolver, with no
// fakes, against this clone's own `git describe` and the real GHCR registry,
// and requires a published, digest-pinned dpf-doctools for that release.
//
// It is SKIPPED, never passed, when the host cannot answer: no DNS for
// ghcr.io, no docker CLI with buildx, or a clone with no reachable release tag
// (a shallow CI checkout without tags).

import { spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { runProcessWithBudget } from "@/lib/shared/run-process-with-budget";
import { DOCTOOLS_IMAGE_NAME, resolveReleaseDoctoolsImage, type DoctoolsDockerRunner } from "./doctools-release-image";
import { describeSourceLineage } from "./doctools-source-lineage";

const REPO_ROOT = resolve(__dirname, "../../../..");
const GHCR_OWNER = "opendigitalproductfactory";

async function ghcrResolves(): Promise<boolean> {
  try {
    await Promise.race([
      lookup("ghcr.io"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("dns timeout")), 5_000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

function hasDockerBuildx(): boolean {
  try {
    // ambient-host-guard: allow the gate itself; a host without docker buildx reports this suite SKIPPED
    return spawnSync("docker", ["buildx", "version"], { stdio: "ignore", timeout: 15_000 }).status === 0;
  } catch {
    return false;
  }
}

const runGit = async (args: string[]) => {
  const result = spawnSync("git", args, { encoding: "utf8", timeout: 15_000 });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

const lineage = await describeSourceLineage({ sourcePath: REPO_ROOT, targetSha: "HEAD", ghcrOwner: GHCR_OWNER, runGit });
const ready = lineage !== null && (await ghcrResolves()) && hasDockerBuildx();

const runDocker: DoctoolsDockerRunner = (args, options) =>
  runProcessWithBudget("docker", args, { timeoutMs: options?.timeoutMs ?? 60_000, timeoutLabel: "doctools-network-test" });

describe.skipIf(!ready)("customizable-install doctools lineage against the real registry (BI-D1B40D43 precondition)", () => {
  it("resolves this clone's release lineage to a published, digest-pinned dpf-doctools", async () => {
    if (!lineage) throw new Error("unreachable: the suite is skipped without a lineage");
    const resolution = await resolveReleaseDoctoolsImage(lineage, runDocker);
    if (resolution.kind !== "published") {
      throw new Error(`${lineage.imageTag}: expected a published ${DOCTOOLS_IMAGE_NAME}, got ${JSON.stringify(resolution)}`);
    }
    expect(resolution.image.startsWith(`ghcr.io/${GHCR_OWNER}/${DOCTOOLS_IMAGE_NAME}@sha256:`)).toBe(true);
    expect(isPinnedImageReference(resolution.image)).toBe(true);
  }, 120_000);
});
