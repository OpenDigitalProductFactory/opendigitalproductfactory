#!/usr/bin/env node
// Compare the PUBLISHED image's source stamp to this branch, and fail when the
// release pipeline has fallen behind the contract the installer depends on.
//
// Why: `dpf-portal:latest` sat 1851 commits behind main for ~7 weeks. The consumer
// ("Ready to go") installer does `docker cp <c>:/dpf-release-assets/.`, and that
// directory only exists in images built after 1c157563a. Every non-technical user's
// install failed with consumer_release_asset_export_failed, and nothing detected it,
// because nothing compared the published image to the branch.
//
// Requires Docker + registry read. The decision logic is separated into
// scripts/lib/published-image-freshness.mjs so it is unit-tested without either.
//
// Usage:
//   node scripts/check-published-image-freshness.mjs [--image <ref>] [--ref <git-ref>]
//                                                    [--max-behind N] [--json]

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RELEASE_CONTRACT_PATHS,
  evaluatePublishedImageFreshness,
} from "./lib/published-image-freshness.mjs";

const DEFAULT_IMAGE = "ghcr.io/opendigitalproductfactory/dpf-portal:latest";
const STAMP_PATH = "/app/.dpf-image-version";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const wantJson = process.argv.includes("--json");
const image = arg("--image", DEFAULT_IMAGE);
const gitRef = arg("--ref", "origin/main");
const maxCommitsBehind = Number(arg("--max-behind", "250"));

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

/** Pull the image and read the commit it was built from. */
function readPublishedSha(ref) {
  run("docker", ["pull", "--quiet", ref]);
  const cid = run("docker", ["create", ref]);
  const dir = mkdtempSync(join(tmpdir(), "dpf-imgver-"));
  try {
    run("docker", ["cp", `${cid}:${STAMP_PATH}`, dir]);
    return readFileSync(join(dir, ".dpf-image-version"), "utf8").trim() || null;
  } catch {
    return null; // unstamped -> UNKNOWN, handled as blocking by the evaluator
  } finally {
    try { run("docker", ["rm", "-f", cid]); } catch { /* best effort */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const headSha = run("git", ["rev-parse", gitRef]);

  let publishedSha = null;
  try {
    publishedSha = readPublishedSha(image);
  } catch (err) {
    console.error(`[published-image-freshness] could not inspect ${image}: ${err.message}`);
    process.exit(2); // infrastructure problem, not a verdict
  }

  let isAncestor = false;
  let commitsBehind = 0;
  let contractChanged = [];
  if (publishedSha) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", publishedSha, headSha], { stdio: "ignore" });
      isAncestor = true;
    } catch {
      isAncestor = false;
    }
    if (isAncestor) {
      commitsBehind = Number(run("git", ["rev-list", "--count", `${publishedSha}..${headSha}`]));
      const changed = run("git", [
        "diff", "--name-only", `${publishedSha}..${headSha}`, "--", ...RELEASE_CONTRACT_PATHS,
      ]);
      contractChanged = changed ? changed.split(/\r?\n/).filter(Boolean) : [];
    }
  }

  const result = evaluatePublishedImageFreshness({
    publishedSha, headSha, publishedShaIsAncestor: isAncestor,
    contractPathsChangedSince: contractChanged, commitsBehind, maxCommitsBehind,
  });

  if (wantJson) {
    console.log(JSON.stringify({ image, publishedSha, headSha, commitsBehind, contractChanged, ...result }, null, 2));
  } else {
    console.log(`[published-image-freshness] image        : ${image}`);
    console.log(`[published-image-freshness] built from   : ${publishedSha ?? "(unstamped)"}`);
    console.log(`[published-image-freshness] ${gitRef} head: ${headSha}`);
    console.log(`[published-image-freshness] behind       : ${commitsBehind}`);
    console.log(`[published-image-freshness] verdict      : ${result.verdict.toUpperCase()}`);
    console.log(`[published-image-freshness] ${result.reason}`);
    if (result.blocking) {
      console.log("");
      console.log("  Republish with:  gh workflow run publish-image.yml --ref main -f tag=latest");
      console.log("  Then re-run the consumer install path end to end before calling it fixed.");
    }
  }
  process.exit(result.blocking ? 1 : 0);
}

main();
