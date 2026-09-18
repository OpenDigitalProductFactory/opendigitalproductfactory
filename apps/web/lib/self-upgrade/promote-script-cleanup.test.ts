import { describe, it, expect } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// The success-path disk reclaim in promote.sh (step=cleanup). Same harness as
// promote-script-functional.test.ts: real script, real git, fake docker.

import { BASH_OK, GIT_OK, PROMOTE_TEST_TIMEOUT_MS, makeScratch, runPromote } from "./promote-script-functional.test-support";

describe.skipIf(!BASH_OK || !GIT_OK)("promote.sh — cleanup sweep after a successful promote", () => {
  it("sweeps dangling images and build cache after a successful promote", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      const r = runPromote({ source, backup, targetSha: head, fakeBin, dockerLog });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("step=cleanup");
      const dockerCalls = readFileSync(dockerLog, "utf8");
      // Best-effort disk reclaim on the success path.
      // Dangling images: removed outright (superseded previous portal version).
      expect(dockerCalls).toContain("image prune -f");
      // Build cache: BOUNDED, not wiped — kept as a rebuild-speed asset under a cap.
      expect(dockerCalls).toContain("builder prune -f --keep-storage");
      // Conservative scope: never the destructive `-a` (would delete in-use tagged images).
      expect(dockerCalls).not.toContain("image prune -a");
      // Volumes are operator state — cleanup must never touch them.
      expect(dockerCalls).not.toContain("volume");
      // BI-9B7FC928: also reclaims the TAGGED ephemeral verify/compare/build-test
      // images that dangling-prune misses (the ~3.7 GB/upgrade leak). It queries
      // by exact ephemeral naming so the running dpf-portal image is never hit.
      expect(dockerCalls).toContain("images --filter reference=dpf-*-build-test");
      expect(dockerCalls).toContain("images --filter reference=dpf-*-build-compare");
      expect(dockerCalls).toContain("images --filter reference=dpf-*:verify");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("bounds superseded version tags per self-upgrade image: keeps in-use + PROMOTE_IMAGE_KEEP newest, removes the rest by tag", () => {
    // Every upgrade tags a fresh portal/postgres/promoter/sandbox and the tag
    // keeps it out of dangling-prune, so a dev install piled up 92 portal tags
    // (388 GB reclaimable) in 16 days. The shim answers the portal query
    // newest-first; the running tag sits in the middle to prove in-use wins
    // over recency and never counts against the keep budget.
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    const repo = "ghcr.io/opendigitalproductfactory/dpf-portal";
    const tags = ["v2026.09.06-e.1", "v2026.09.06-d.1", "v2026.09.05-running.1", "v2026.09.04-c.1", "v2026.09.03-b.1", "v2026.09.02-a.1"]
      .map((tag) => `${repo}:${tag}`);
    try {
      const r = runPromote({
        source, backup, targetSha: head, fakeBin, dockerLog,
        portalVersionTags: tags,
        imagesInUse: [`${repo}:v2026.09.05-running.1`, "ghcr.io/opendigitalproductfactory/dpf-sandbox:v2026.09.05-running.1"],
        imageKeep: 2,
      });
      expect(r.status).toBe(0);
      const dockerCalls = readFileSync(dockerLog, "utf8").split("\n");
      const removed = dockerCalls.filter((line) => line.startsWith("rmi ") && line.includes("dpf-portal:v"));
      // Newest two survive as rollback margin, the in-use one survives regardless
      // of age. One call carries the whole chunk (BI-A5FFE7A7).
      expect(removed).toEqual([`rmi ${repo}:v2026.09.04-c.1 ${repo}:v2026.09.03-b.1 ${repo}:v2026.09.02-a.1`]);
      expect(removed.join(" ")).not.toContain("v2026.09.05-running.1");
      // Every self-upgrade repo is swept, and by version-tag reference only.
      for (const name of ["dpf-portal", "dpf-postgres", "dpf-promoter", "dpf-sandbox"]) {
        expect(dockerCalls).toContain(`images --filter reference=ghcr.io/opendigitalproductfactory/${name}:v* --format {{.Repository}}:{{.Tag}}`);
      }
      // Untag by reference, never force-remove by id: a layer shared with a kept tag must survive.
      expect(removed.every((line) => !line.includes(" -f "))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("removes a large backlog in chunks rather than one docker rmi per tag", () => {
    // BI-A5FFE7A7: the first sweep on an install that predates the retention rule
    // clears its entire history at once. Reclaiming 223 tags one call at a time
    // took ~13 minutes by hand, and that time would be spent inside step=cleanup
    // on every install the release reaches. 120 tags with a keep of 3 leaves 117
    // removals, which must arrive as 50 + 50 + 17, not 117 separate calls.
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    const repo = "ghcr.io/opendigitalproductfactory/dpf-portal";
    const tags = Array.from({ length: 120 }, (_, i) => `${repo}:v2026.09.06-backlog.${120 - i}`);
    try {
      const r = runPromote({ source, backup, targetSha: head, fakeBin, dockerLog, portalVersionTags: tags, imageKeep: 3 });
      expect(r.status).toBe(0);
      const removed = readFileSync(dockerLog, "utf8").split("\n")
        .filter((line) => line.startsWith("rmi ") && line.includes("dpf-portal:v"));
      expect(removed).toHaveLength(3);
      expect(removed.map((line) => line.slice(4).trim().split(/\s+/).length)).toEqual([50, 50, 17]);
      // The three newest are the rollback margin and are never passed to rmi.
      const all = removed.join(" ");
      for (const keep of tags.slice(0, 3)) expect(all).not.toContain(`${keep} `);
      expect(all).toContain(tags[3]);
      expect(all).toContain(tags[119]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

});
