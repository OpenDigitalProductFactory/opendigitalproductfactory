import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
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

/** What the reconcile step creates on an install that has nothing — derived from
 *  the script itself, so a catalog change moves the fixture and the assertion together. */
function discoverRequiredServices(): string[] {
  const first = makeScratch();
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
    return line![1].split(",");
  } finally {
    rmSync(first.root, { recursive: true, force: true });
  }
}

type ReconcileOutcome = {
  targetSha: string;
  at: string;
  outcome: "current" | "complete" | "degraded";
  required: string[];
  created: string[];
  failed: string[];
};

function readOutcome(backup: string): ReconcileOutcome {
  const path = join(backup, "state", "service-reconcile-outcome.json");
  expect(existsSync(path), "promote.sh must leave a durable reconcile outcome on the state mount").toBe(true);
  return JSON.parse(readFileSync(path, "utf8")) as ReconcileOutcome;
}

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
  // BI-5ACBAC50: one `up -d --no-recreate <all missing>` meant a single pruned image
  // tag (dpf-tts pinned travisvn/chatterbox-tts-api:v0.1.0, which Docker Hub no longer
  // serves) aborted the whole batch. Prometheus, Grafana, Loki, Alloy, both exporters
  // and browser-use were never created on the live install, for two months, while every
  // upgrade reported success.
  it("creates each missing service on its own, so one unpullable image cannot block the rest", () => {
    const required = discoverRequiredServices();
    expect(required.length, "the fixture must require at least two services to prove isolation").toBeGreaterThan(1);
    const broken = required[0];
    const healthy = required.slice(1);

    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      const r = runPromote({
        source,
        backup,
        targetSha: head,
        fakeBin,
        dockerLog,
        existingServices: [],
        reconcileFailService: broken,
      });

      // Still fail-loud-not-abort: the verified portal swap stands.
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("step=cleanup");

      // One create per service — never a batch the first bad pull can sink.
      const creates = readFileSync(dockerLog, "utf8")
        .split("\n")
        .filter((l) => l.startsWith("reconcile-create "));
      expect(creates).toHaveLength(required.length);
      for (const svc of required) {
        expect(creates.some((l) => l.endsWith(` ${svc}`))).toBe(true);
      }

      expect(r.stdout).toContain(`step=service-reconcile-created target=${head} services=${healthy.join(",")}`);
      expect(r.stdout).toContain(`step=service-reconcile-failed target=${head} services=${broken}`);
      expect(r.stderr).toContain(broken);

      // The run's evidence must be able to say so: stderr dies with the promoter.
      const outcome = readOutcome(backup);
      expect(outcome).toMatchObject({
        targetSha: head,
        outcome: "degraded",
        created: healthy,
        failed: [broken],
      });
      expect(outcome.required).toEqual(required);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("records a complete outcome when every missing service was created", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      const r = runPromote({ source, backup, targetSha: head, fakeBin, existingServices: [] });
      expect(r.status).toBe(0);
      const outcome = readOutcome(backup);
      expect(outcome.outcome).toBe("complete");
      expect(outcome.failed).toEqual([]);
      expect(outcome.created.length).toBeGreaterThan(0);
      expect(outcome.created).toEqual(outcome.required);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("records a current outcome when nothing was missing", () => {
    const required = discoverRequiredServices();
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      const r = runPromote({ source, backup, targetSha: head, fakeBin, existingServices: required });
      expect(r.status).toBe(0);
      expect(readOutcome(backup)).toMatchObject({ targetSha: head, outcome: "current", created: [], failed: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);
});

// BI-FFFEA4ED: Created is not an operator stop; the first startup never succeeded.
describe.skipIf(!BASH_OK || !GIT_OK)("never-started recovery", () => {
  it("preserves existing services when the inventory exceeds a pipe buffer", () => {
    const required = discoverRequiredServices();
    const fixture = makeScratch();
    const dockerLog = join(fixture.root, "docker.log");
    try {
      const service = required[0];
      const existingServices = [
        ...required,
        ...Array.from({ length: 3000 }, (_, index) => `unrelated-existing-service-${index}`),
      ];
      const result = runPromote({ ...fixture, targetSha: fixture.head, dockerLog,
        existingServices, createdService: service,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readOutcome(fixture.backup)).toMatchObject({
        outcome: "complete", created: [service], failed: [],
      });
      const creates = readFileSync(dockerLog, "utf8").split("\n")
        .filter(line => line.startsWith("reconcile-create "));
      expect(creates).toHaveLength(1);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }, PROMOTE_TEST_TIMEOUT_MS);
  for (const fails of [false, true]) {
    it(`retries a never-started service and records ${fails ? "failure" : "success"}`, () => {
      const required = discoverRequiredServices();
      const fixture = makeScratch();
      const dockerLog = join(fixture.root, "docker.log");
      try {
        const service = required[0];
        const result = runPromote({ ...fixture, targetSha: fixture.head, dockerLog,
          existingServices: required, createdService: service,
          ...(fails ? { reconcileFailService: service } : {}),
        });
        expect(result.status).toBe(0);
        expect(readFileSync(dockerLog, "utf8")).toContain(`reconcile-remove rm ${service}`);
        expect(readOutcome(fixture.backup)).toMatchObject({
          outcome: fails ? "degraded" : "complete",
          created: fails ? [] : [service], failed: fails ? [service] : [],
        });
      } finally { rmSync(fixture.root, { recursive: true, force: true }); }
    }, PROMOTE_TEST_TIMEOUT_MS);
  }
  it("preserves uninspectable containers and records unknown recovery as degraded", () => {
    const required = discoverRequiredServices();
    const fixture = makeScratch();
    const dockerLog = join(fixture.root, "docker.log");
    try {
      const result = runPromote({ ...fixture, targetSha: fixture.head, dockerLog,
        existingServices: required, inspectFailService: required[0],
      });
      expect(result.status).toBe(0);
      expect(readFileSync(dockerLog, "utf8")).not.toContain("reconcile-remove");
      expect(readOutcome(fixture.backup)).toMatchObject({ outcome: "degraded", failed: [required[0]] });
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }, PROMOTE_TEST_TIMEOUT_MS);

  // BI-547B788D: a sandbox that self-upgrade could not bring up on the target
  // image used to leave only a stderr warning, which dies with the promoter
  // container, so the run read as clean while every reviewer's inference was
  // down. It must reach the durable outcome as degraded, naming the sandbox.
  describe("sandbox refresh verification (BI-547B788D)", () => {
    function runWithSandbox(opts: { sandboxState?: "running" | "exited" | "stale"; sandboxRecreateFails?: boolean }) {
      const scratch = makeScratch();
      const r = runPromote({
        source: scratch.source,
        backup: scratch.backup,
        targetSha: scratch.head,
        fakeBin: scratch.fakeBin,
        existingServices: discoverRequiredServices(),
        ...opts,
      });
      return { ...scratch, r };
    }

    it("AC-3: a failed sandbox recreate leaves the run degraded, naming the sandbox, not a clean success", () => {
      const { root, backup, head, r } = runWithSandbox({ sandboxRecreateFails: true });
      try {
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("step=sandbox-refresh-failed");
        expect(r.stdout).not.toContain("step=service-reconcile-current");
        expect(r.stdout).toContain(`step=done target=${head}`);
        const outcome = readOutcome(backup);
        expect(outcome.outcome).toBe("degraded");
        expect(outcome.failed).toContain("sandbox");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }, PROMOTE_TEST_TIMEOUT_MS);

    it("AC-1: a recreated sandbox that is not running is a failed refresh", () => {
      const { root, backup, r } = runWithSandbox({ sandboxState: "exited" });
      try {
        expect(r.stdout).toContain("step=sandbox-refresh-not-running");
        expect(readOutcome(backup).failed).toContain("sandbox");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }, PROMOTE_TEST_TIMEOUT_MS);

    it("AC-1: a running sandbox still on the old image is a failed refresh", () => {
      const { root, backup, r } = runWithSandbox({ sandboxState: "stale" });
      try {
        expect(r.stdout).toContain("step=sandbox-refresh-stale-image");
        expect(r.stdout).toContain("expected=sha256:sandbox-target");
        expect(readOutcome(backup).failed).toContain("sandbox");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }, PROMOTE_TEST_TIMEOUT_MS);

    it("a sandbox running on the target image keeps the run current", () => {
      const { root, backup, r } = runWithSandbox({});
      try {
        expect(r.stdout).not.toContain("step=sandbox-refresh-failed");
        expect(readOutcome(backup).failed).not.toContain("sandbox");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }, PROMOTE_TEST_TIMEOUT_MS);
  });
});
