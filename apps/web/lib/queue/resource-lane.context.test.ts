import { AsyncLocalStorage } from "node:async_hooks";
import { expect, it } from "vitest";
import { ResourceLane } from "./resource-lane";
import { currentInferenceOrigin, withInferenceOrigin } from "@/lib/inference/inference-admission";
import {
  assertGovernedInferenceAuthority,
  currentGovernedInferenceDeadline,
  withGovernedInferenceDeadline,
} from "@/lib/routing/governed-inference-deadline";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it("preserves each submitter's context across priority dispatch and asynchronous work", async () => {
  const actors = new AsyncLocalStorage<string>();
  const lane = new ResourceLane("context-priority", { record: () => {} });
  const entered = deferred();
  const hold = deferred();
  const holder = actors.run("holder", () => lane.run(async () => {
    entered.resolve();
    await hold.promise;
  }));
  await entered.promise;
  const observe = async () => {
    await Promise.resolve();
    return actors.getStore();
  };
  const background = actors.run("background", () => lane.run(observe, { priority: "autonomous" }));
  const interactive = actors.run("interactive", () => lane.run(observe, { priority: "interactive" }));
  const unscoped = lane.run(observe);
  hold.resolve();
  await holder;
  expect(await interactive).toBe("interactive");
  expect(await unscoped).toBeUndefined();
  expect(await background).toBe("background");
});

it("uses the waiter's own governed authority and deadline after a holder closes", async () => {
  const lane = new ResourceLane("context-authority", { record: () => {} });
  const entered = deferred();
  const hold = deferred();
  const firstDeadline = new Date(Date.now() + 60_000).toISOString();
  const nextDeadline = new Date(Date.now() + 120_000).toISOString();
  const holder = withInferenceOrigin("autonomous", () => withGovernedInferenceDeadline({
    deadlineAt: firstDeadline, verifyAuthority: async () => true,
  }, () => lane.run(async () => { entered.resolve(); await hold.promise; })));
  await entered.promise;
  const waiter = withInferenceOrigin("interactive", () => withGovernedInferenceDeadline({
    deadlineAt: nextDeadline, verifyAuthority: async () => true,
  }, () => lane.run(async () => {
    await assertGovernedInferenceAuthority();
    await Promise.resolve();
    return { origin: currentInferenceOrigin(), deadline: currentGovernedInferenceDeadline()?.deadlineAt };
  }))).then(value => ({ value }), error => ({ error }));
  try {
    await expect.poll(() => lane.depth()).toBe(1);
    hold.resolve();
    await holder;
    expect(await waiter).toEqual({ value: { origin: "interactive", deadline: Date.parse(nextDeadline) } });
  } finally {
    hold.resolve();
    await holder;
    await waiter;
  }
});

it("does not lend a governed holder's authority to an unscoped waiter", async () => {
  const lane = new ResourceLane("context-unscoped", { record: () => {} });
  const entered = deferred();
  const hold = deferred();
  const keepScope = deferred();
  const holder = withGovernedInferenceDeadline({
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    verifyAuthority: async () => true,
  }, async () => {
    await lane.run(async () => { entered.resolve(); await hold.promise; });
    await keepScope.promise;
  });
  await entered.promise;
  const waiter = lane.run(async () => {
    await assertGovernedInferenceAuthority();
    return currentGovernedInferenceDeadline();
  });
  try {
    hold.resolve();
    expect(await waiter).toBeUndefined();
  } finally {
    hold.resolve();
    keepScope.resolve();
    await holder;
  }
});
