import { describe, it, expect } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// BI-D011EBE2: a fresh install runs a full `docker compose up -d` and gets every
// service the shipped compose file declares; a self-upgrade only ever recreated
// NAMED services (portal, sandbox, a postgres override) and could never create one
// the install did not already have. Any service added in any release therefore
// reached zero existing installs, while the upgrade reported success.
//
// These drive the real promote.sh against the fake-docker harness and assert on the
// commands it actually issues.

import {
  BASH_OK,
  GIT_OK,
  PROMOTE_TEST_TIMEOUT_MS,
  makeScratch,
  runPromote,
} from "./promote-script-functional.test-support";

describe.skipIf(!BASH_OK || !GIT_OK)("promote.sh — service reconcile (BI-D011EBE2)", () => {
  it("creates a required service the install has never had", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      // The install has portal but has never had the rest of what it requires.
      const r = runPromote({
        source,
        backup,
        targetSha: head,
        fakeBin,
        dockerLog,
        existingServices: ["portal"],
      });

      expect(r.status).toBe(0);
      expect(r.stdout).toContain("step=service-reconcile");
      expect(r.stdout).toContain("step=service-reconcile-creating");

      const dockerCalls = readFileSync(dockerLog, "utf8");
      // It reconciles by CREATING, never by recreating: --no-recreate is what
      // keeps every already-running service and dependency untouched.
      expect(dockerCalls).toContain("reconcile-create");
      expect(dockerCalls).toContain("--no-recreate");
      expect(dockerCalls).not.toContain("up -d --force-recreate");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("does not fight the operator: a service that already has a container is left alone", () => {
    // Derived, not hardcoded: ask the script itself what this projection requires
    // by letting it reconcile from nothing, then assert that an install already
    // holding exactly that set is reported current. A service added to the
    // catalog later changes both halves together, so this cannot rot into a
    // false pass.
    const first = makeScratch();
    let alreadyPresent: string[];
    try {
      const discover = runPromote({
        source: first.source,
        backup: first.backup,
        targetSha: first.head,
        fakeBin: first.fakeBin,
        existingServices: [],
      });
      expect(discover.status).toBe(0);
      const line = /step=service-reconcile-creating target=\S+ services=(\S+)/.exec(discover.stdout);
      expect(line, "expected the reconcile step to report what it creates").not.toBeNull();
      alreadyPresent = line![1].split(",");
      expect(alreadyPresent.length).toBeGreaterThan(0);
    } finally {
      rmSync(first.root, { recursive: true, force: true });
    }

    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      // `docker compose ps -a --services` lists containers in ANY state, so a
      // service the operator deliberately stopped reads as existing. This step
      // delivers what was never shipped; it must never restart a stopped service.
      const r = runPromote({
        source,
        backup,
        targetSha: head,
        fakeBin,
        dockerLog,
        existingServices: alreadyPresent,
      });

      expect(r.status).toBe(0);
      expect(r.stdout).toContain("step=service-reconcile-current");
      expect(r.stdout).not.toContain("step=service-reconcile-creating");
      expect(readFileSync(dockerLog, "utf8")).not.toContain("reconcile-create");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("fails loud but never aborts: a reconcile error leaves the verified promotion standing", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      const r = runPromote({
        source,
        backup,
        targetSha: head,
        fakeBin,
        dockerLog,
        existingServices: ["portal"],
        reconcileFails: true,
      });

      // The portal swap already passed health, sha-verify and content-verify.
      // A docker hiccup here must not relabel a good upgrade as a failed one —
      // the same fail-LOUD-not-ABORT contract as sandbox-refresh (7b).
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("step=service-reconcile-failed");
      expect(r.stdout).toContain("step=cleanup");
      expect(r.stderr).toContain("BI-D011EBE2");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);
});
