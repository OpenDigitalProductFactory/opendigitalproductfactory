import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_IDLE_GRACE_MS,
  buildxRmArgs,
  buildxStopArgs,
  decideManagedBuilderAction,
  decidePostBuildCoolDown,
  isBuilderCoolDownEnabled,
  isManagedBuilderName,
  parseManagedBuilderContainer,
  parseManagedBuilderName,
  planManagedBuilderLifecycle,
} from "./local-ci-builder-lifecycle.mjs";

test("parseManagedBuilderName extracts policy version and slot ordinal", () => {
  assert.deepEqual(parseManagedBuilderName("dpf-local-ci-buildkit-v2-0"), {
    policyVersion: 2,
    ordinal: 0,
  });
  assert.equal(parseManagedBuilderName("desktop-linux"), null);
  assert.equal(isManagedBuilderName("dpf-local-ci-buildkit-v1-1"), true);
});

test("parseManagedBuilderContainer maps buildx container name back to builder", () => {
  assert.deepEqual(parseManagedBuilderContainer("buildx_buildkit_dpf-local-ci-buildkit-v2-00"), {
    policyVersion: 2,
    ordinal: 0,
    builderName: "dpf-local-ci-buildkit-v2-0",
  });
  assert.equal(parseManagedBuilderContainer("dpf-portal-1"), null);
});

test("cool-down defaults on; KEEP_WARM disables it", () => {
  assert.equal(isBuilderCoolDownEnabled({}), true);
  assert.equal(isBuilderCoolDownEnabled({ DPF_LOCAL_CI_BUILDER_KEEP_WARM: "1" }), false);
  assert.equal(isBuilderCoolDownEnabled({ DPF_LOCAL_CI_BUILDER_KEEP_WARM: "true" }), false);
});

test("obsolete policy version is REAPed even when idle/warm flags differ", () => {
  assert.deepEqual(
    decideManagedBuilderAction(
      { name: "dpf-local-ci-buildkit-v1-0", running: true, idleMs: 0 },
      { currentPolicyVersion: 2, leaseOrFenceActive: true, coolDownEnabled: false },
    ),
    {
      action: "REAP",
      reason: "obsolete policy v1 (current v2) — remove zombie builder",
    },
  );
});

test("running current builder past grace without fence is STOP", () => {
  const decision = decideManagedBuilderAction(
    {
      name: "dpf-local-ci-buildkit-v2-0",
      status: "running",
      idleMs: DEFAULT_IDLE_GRACE_MS + 1,
    },
    { currentPolicyVersion: 2, leaseOrFenceActive: false },
  );
  assert.equal(decision.action, "STOP");
  assert.match(decision.reason, /idle/);
});

test("active fence or within grace keeps a running current builder", () => {
  assert.equal(
    decideManagedBuilderAction(
      { name: "dpf-local-ci-buildkit-v2-0", running: true, idleMs: DEFAULT_IDLE_GRACE_MS + 1 },
      { currentPolicyVersion: 2, leaseOrFenceActive: true },
    ).action,
    "KEEP",
  );
  assert.equal(
    decideManagedBuilderAction(
      { name: "dpf-local-ci-buildkit-v2-0", running: true, idleMs: 1000 },
      { currentPolicyVersion: 2, leaseOrFenceActive: false },
    ).action,
    "KEEP",
  );
});

test("post-build cool-down always stops the session builder when enabled", () => {
  assert.deepEqual(
    decidePostBuildCoolDown({ name: "dpf-local-ci-buildkit-v2-0" }),
    {
      action: "STOP",
      reason: "build session ended — buildx stop (keep disk cache)",
    },
  );
  assert.equal(
    decidePostBuildCoolDown(
      { name: "dpf-local-ci-buildkit-v2-0" },
      { coolDownEnabled: false },
    ).action,
    "KEEP",
  );
});

test("planManagedBuilderLifecycle partitions stop/reap/keep", () => {
  const plan = planManagedBuilderLifecycle({
    currentPolicyVersion: 2,
    leaseOrFenceActive: false,
    builders: [
      { name: "dpf-local-ci-buildkit-v1-0", running: true, idleMs: 0 },
      {
        name: "dpf-local-ci-buildkit-v2-0",
        running: true,
        idleMs: DEFAULT_IDLE_GRACE_MS + 5_000,
      },
      { name: "desktop-linux", running: true, idleMs: 99_999_999 },
    ],
  });
  assert.equal(plan.toReap.length, 1);
  assert.equal(plan.toReap[0].builder.name, "dpf-local-ci-buildkit-v1-0");
  assert.equal(plan.toStop.length, 1);
  assert.equal(plan.toStop[0].builder.name, "dpf-local-ci-buildkit-v2-0");
  assert.ok(plan.toKeep.some((d) => d.builder.name === "desktop-linux"));
});

test("buildx stop/rm argv stay force-free on stop and forced on obsolete rm", () => {
  assert.deepEqual(buildxStopArgs("dpf-local-ci-buildkit-v2-0"), [
    "buildx", "stop", "dpf-local-ci-buildkit-v2-0",
  ]);
  assert.deepEqual(buildxRmArgs("dpf-local-ci-buildkit-v1-0"), [
    "buildx", "rm", "-f", "dpf-local-ci-buildkit-v1-0",
  ]);
});
