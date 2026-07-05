#!/usr/bin/env node
// Re-resolve the pinned STT sidecar image digest (BI-A9EAEE2C).
//
// hwdsl2/whisper-server re-pushes :latest periodically and prunes the previous
// index manifest, so the digest pinned in docker-compose.yml rots on the
// registry owner's schedule. When that happens, Release Contract Guards +
// Release Image Manifest Guard go red on main for EVERY open PR until someone
// manually re-pins (BI-4439CDF1 sat red for two weeks). This script closes the
// loop mechanically:
//
//   --check   resolve the live index digest for the tracked tag via the Docker
//             Hub API and compare with the compose pin. Exit 0 in-sync, exit 3
//             on drift (prints the new digest), exit 2 on usage/API failure.
//   --apply   on drift, rewrite docker-compose.yml (image pin + "resolved on"
//             comment date) and tests/release/installer-release-contract.test.mjs
//             (CURRENT_STT_DIGEST -> new, RETIRED_STT_DIGEST -> the digest being
//             replaced), then exit 3 so callers know a change was made.
//
// Driven by .github/workflows/stt-digest-watch.yml (daily cron), which opens a
// signed re-pin PR when this script reports drift. Also runnable by hand.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const STT_IMAGE_REPO = "hwdsl2/whisper-server";
// The upstream tag whose index digest we track. Never shipped as `:latest` in
// compose (non-reproducible installs); we pin the digest that tag resolves to.
export const STT_TRACKED_TAG = "latest";
export const COMPOSE_PATH = "docker-compose.yml";
export const CONTRACT_TEST_PATH = "tests/release/installer-release-contract.test.mjs";

export const EXIT_IN_SYNC = 0;
export const EXIT_USAGE_OR_API = 2;
export const EXIT_DRIFT = 3;

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

/** Escape ALL regex metacharacters, not just "/" (CodeQL js/incomplete-sanitization). */
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract the pinned digest from the compose text. Returns "" when absent. */
export function parsePinnedDigest(composeText, repo = STT_IMAGE_REPO) {
  const match = String(composeText ?? "").match(
    new RegExp(`${escapeRegExp(repo)}@(sha256:[0-9a-f]{64})`),
  );
  return match ? match[1] : "";
}

/** Extract CURRENT_STT_DIGEST from the contract test text. Returns "" when absent. */
export function parseContractCurrentDigest(testText, repo = STT_IMAGE_REPO) {
  const match = String(testText ?? "").match(
    new RegExp(
      `CURRENT_STT_DIGEST\\s*=\\s*\\n?\\s*"${escapeRegExp(repo)}@(sha256:[0-9a-f]{64})"`,
    ),
  );
  return match ? match[1] : "";
}

/**
 * Resolve the live index digest for repo:tag from the Docker Hub API.
 * `fetchImpl` is injectable for tests. Throws on HTTP/shape failures.
 */
export async function resolveLiveDigest({ repo = STT_IMAGE_REPO, tag = STT_TRACKED_TAG, fetchImpl = fetch } = {}) {
  const url = `https://hub.docker.com/v2/repositories/${repo}/tags/${tag}`;
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Docker Hub API ${response.status} for ${url}`);
  }
  const payload = await response.json();
  const digest = payload?.digest;
  if (typeof digest !== "string" || !DIGEST_RE.test(digest)) {
    throw new Error(`Docker Hub API returned no valid index digest for ${repo}:${tag} (got: ${JSON.stringify(digest)})`);
  }
  return digest;
}

/**
 * Rewrite compose + contract test for a new digest. Pure text-in/text-out.
 * Returns { composeText, testText, oldDigest }. Throws if the expected
 * structures are not found — a silent partial rewrite would recreate the
 * compose/test disagreement this automation exists to prevent.
 */
export function applyRepin({ composeText, testText, newDigest, repo = STT_IMAGE_REPO, today }) {
  if (!DIGEST_RE.test(newDigest ?? "")) throw new Error(`invalid digest: ${newDigest}`);
  const oldDigest = parsePinnedDigest(composeText, repo);
  if (!oldDigest) throw new Error(`no ${repo}@sha256:… pin found in compose text`);
  if (oldDigest === newDigest) throw new Error("compose already pins the requested digest");

  let nextCompose = composeText.replaceAll(`${repo}@${oldDigest}`, `${repo}@${newDigest}`);
  // Keep the human trail in the compose comment current: the "resolved on
  // <date> (the prior <shortdigest>… digest ...)" line documents each rotation.
  const shortOld = oldDigest.replace("sha256:", "").slice(0, 8);
  nextCompose = nextCompose.replace(
    /resolved on \d{4}-\d{2}-\d{2} \(the prior [0-9a-f]{8}… digest/,
    `resolved on ${today} (the prior ${shortOld}… digest`,
  );

  const testCurrent = parseContractCurrentDigest(testText, repo);
  if (!testCurrent) throw new Error(`no CURRENT_STT_DIGEST found in contract test text`);
  let nextTest = testText.replace(
    new RegExp(`(RETIRED_STT_DIGEST\\s*=\\s*\\n?\\s*")${escapeRegExp(repo)}@sha256:[0-9a-f]{64}(")`),
    `$1${repo}@${oldDigest}$2`,
  );
  nextTest = nextTest.replace(
    new RegExp(`(CURRENT_STT_DIGEST\\s*=\\s*\\n?\\s*")${escapeRegExp(repo)}@sha256:[0-9a-f]{64}(")`),
    `$1${repo}@${newDigest}$2`,
  );
  if (!nextTest.includes(`${repo}@${newDigest}`) || !nextTest.includes(`${repo}@${oldDigest}`)) {
    throw new Error("contract test rewrite did not land both digests");
  }
  return { composeText: nextCompose, testText: nextTest, oldDigest };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const check = process.argv.includes("--check") || !apply;
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : process.cwd();

  const composePath = path.join(root, COMPOSE_PATH);
  const testPath = path.join(root, CONTRACT_TEST_PATH);
  const composeText = readFileSync(composePath, "utf8");
  const pinned = parsePinnedDigest(composeText);
  if (!pinned) {
    console.error(`[stt-digest] no ${STT_IMAGE_REPO} digest pin found in ${composePath}`);
    process.exit(EXIT_USAGE_OR_API);
  }

  let live;
  try {
    live = await resolveLiveDigest({});
  } catch (error) {
    console.error(`[stt-digest] could not resolve live digest: ${error.message}`);
    process.exit(EXIT_USAGE_OR_API);
  }

  if (live === pinned) {
    console.log(`[stt-digest] in sync: ${STT_IMAGE_REPO}:${STT_TRACKED_TAG} -> ${pinned}`);
    process.exit(EXIT_IN_SYNC);
  }

  console.log(`[stt-digest] DRIFT: compose pins ${pinned} but ${STT_IMAGE_REPO}:${STT_TRACKED_TAG} now resolves to ${live}`);
  if (check && !apply) process.exit(EXIT_DRIFT);

  const testText = readFileSync(testPath, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  const result = applyRepin({ composeText, testText, newDigest: live, today });
  writeFileSync(composePath, result.composeText);
  writeFileSync(testPath, result.testText);
  console.log(`[stt-digest] re-pinned ${result.oldDigest} -> ${live} in ${COMPOSE_PATH} and ${CONTRACT_TEST_PATH}`);
  process.exit(EXIT_DRIFT);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(`[stt-digest] ${error.message}`);
    process.exit(EXIT_USAGE_OR_API);
  });
}
