import assert from "node:assert/strict";
import test from "node:test";

import {
  FRESHNESS_VERDICTS,
  RELEASE_CONTRACT_PATHS,
  evaluatePublishedImageFreshness,
} from "./published-image-freshness.mjs";

const base = {
  publishedSha: "ab65c948b19292cb44e5b09ef07d7bd7303114fe",
  headSha: "a99058c4a0000000000000000000000000000000",
  publishedShaIsAncestor: true,
  contractPathsChangedSince: [],
  commitsBehind: 3,
};

test("a recent image with no contract drift is fresh", () => {
  const r = evaluatePublishedImageFreshness(base);
  assert.equal(r.verdict, FRESHNESS_VERDICTS.OK);
  assert.equal(r.blocking, false);
});

test("reproduces the real outage: Dockerfile changed since the published image", () => {
  // The actual 2026 incident — install-dpf.ps1 began requiring /dpf-release-assets in
  // the same commit that added it to the Dockerfile, and the image was never rebuilt.
  const r = evaluatePublishedImageFreshness({
    ...base,
    contractPathsChangedSince: ["Dockerfile", "install-dpf.ps1"],
    commitsBehind: 1851,
  });
  assert.equal(r.verdict, FRESHNESS_VERDICTS.INCOMPATIBLE);
  assert.equal(r.blocking, true);
  assert.match(r.reason, /Dockerfile/);
  assert.match(r.reason, /install-dpf\.ps1/);
});

test("contract drift outranks mere staleness", () => {
  const drifted = evaluatePublishedImageFreshness({
    ...base,
    contractPathsChangedSince: ["Dockerfile"],
    commitsBehind: 5000,
  });
  assert.equal(drifted.verdict, FRESHNESS_VERDICTS.INCOMPATIBLE);
});

test("large drift with no contract change is stale, not incompatible", () => {
  const r = evaluatePublishedImageFreshness({ ...base, commitsBehind: 1851 });
  assert.equal(r.verdict, FRESHNESS_VERDICTS.STALE);
  assert.equal(r.blocking, true);
  assert.match(r.reason, /1851 commits behind/);
});

test("drift exactly at the ceiling is still OK; one past it is stale", () => {
  assert.equal(
    evaluatePublishedImageFreshness({ ...base, commitsBehind: 250 }).verdict,
    FRESHNESS_VERDICTS.OK,
  );
  assert.equal(
    evaluatePublishedImageFreshness({ ...base, commitsBehind: 251 }).verdict,
    FRESHNESS_VERDICTS.STALE,
  );
});

test("an unstamped image is UNKNOWN and blocking, never silently OK", () => {
  const r = evaluatePublishedImageFreshness({ ...base, publishedSha: null });
  assert.equal(r.verdict, FRESHNESS_VERDICTS.UNKNOWN);
  assert.equal(r.blocking, true);
  assert.match(r.reason, /identity/);
});

test("an image built off the release line is UNKNOWN and blocking", () => {
  const r = evaluatePublishedImageFreshness({ ...base, publishedShaIsAncestor: false });
  assert.equal(r.verdict, FRESHNESS_VERDICTS.UNKNOWN);
  assert.equal(r.blocking, true);
  assert.match(r.reason, /not an ancestor/);
});

test("duplicate contract paths are de-duplicated and sorted in the reason", () => {
  const r = evaluatePublishedImageFreshness({
    ...base,
    contractPathsChangedSince: ["install-dpf.ps1", "Dockerfile", "Dockerfile"],
  });
  assert.match(r.reason, /Dockerfile, install-dpf\.ps1/);
});

test("the release-contract path list covers the installer and the image recipe", () => {
  // These two are the pair whose divergence caused the outage; if either is dropped
  // from the list the guard stops detecting the exact failure it exists for.
  assert.ok(RELEASE_CONTRACT_PATHS.includes("Dockerfile"));
  assert.ok(RELEASE_CONTRACT_PATHS.includes("install-dpf.ps1"));
  assert.ok(RELEASE_CONTRACT_PATHS.includes("install-dpf.sh"));
});
