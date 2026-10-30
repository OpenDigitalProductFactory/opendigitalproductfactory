import { FixtureHost, owner, worker, type Completion, type SampleState } from "./host.js";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function finish(host: FixtureHost, roomId: string, attemptId: string, content = attemptId, verdict: Completion["verdict"] = "admit") {
  const described = host.describe(roomId);
  const context = worker(described.actorId);
  assert(host.begin(roomId, attemptId, context).ok, `begin ${attemptId}`);
  const completion = host.observation(roomId, attemptId, content, verdict);
  if (described.humanRequired) assert(host.approve(completion, owner).ok, "actual fixture owner admission for exact content and attempt");
  const result = host.complete(completion, context);
  assert(result.ok, `${attemptId}: ${result.code}`);
  return completion;
}
function improvement(host: FixtureHost, prefix = "improvement") {
  for (const stage of ["plan", "implement", "verify", "release"]) finish(host, "self-improvement", `${prefix}:${stage}`);
}

/** Executed against the copied, compiled kernel, never the application registry. */
export function runSmoke(): { passed: string[]; qualification: "synthetic-only" } {
  const passed: string[] = [];
  const test = (name: string, scenario: () => void) => { scenario(); passed.push(name); };

  test("paired company and improvement jobs use the extracted marking transitions", () => {
    const host = new FixtureHost();
    finish(host, "customer-report", "customer:inspect");
    equal(host.begin("customer-report", "customer:blocked", worker("coworker:operations")).code, "dependency-held", "customer draft awaits accepted improvement");
    improvement(host);
    for (const stage of ["draft", "verify", "accept"]) finish(host, "customer-report", `customer:${stage}`);
    equal(host.describe("customer-report").completed, true, "customer completed");
    equal(host.describe("self-improvement").completed, true, "improvement completed");
  });

  test("receipt subject, kind, actor, profile, binding and pinned definition must match", () => {
    const substitutions: Array<[string, Partial<Completion>]> = [
      ["room", { roomId: "self-improvement" }], ["run", { runKey: "wrong-run" }],
      ["missing run", { runKey: "" }], ["stage", { stageKey: "draft" }],
      ["cycle", { cycle: 9 }], ["iteration", { iteration: 9 }], ["kind", { kind: "unknown" }],
      ["actor", { actorId: "coworker:engineer" }], ["profile", { profileVersion: 9 }],
      ["profile id", { profileId: "wrong-profile" }], ["binding", { bindingVersion: 9 }],
      ["binding id", { bindingId: "wrong-binding" }], ["definition", { definitionVersion: "9.0.0" }],
    ];
    for (const [label, delta] of substitutions) {
      const host = new FixtureHost();
      assert(host.begin("customer-report", "subject:attempt", worker("coworker:operations")).ok, "begin subject fixture");
      const original = host.observation("customer-report", "subject:attempt", "observed inspect");
      const before = JSON.stringify(host.snapshot());
      const denied = host.complete({ ...original, ...delta }, worker("coworker:operations"));
      assert(!denied.ok, `reject changed ${label}`);
      equal(JSON.stringify(host.snapshot()), before, `denial writes nothing (${label})`);
    }
  });

  test("human-required work does not advance from a reviewer or fixture standing authority", () => {
    const host = new FixtureHost();
    for (const stage of ["plan", "implement", "verify"]) finish(host, "self-improvement", `human:${stage}`);
    assert(host.begin("self-improvement", "human:release", owner).ok, "begin release");
    const completion = host.observation("self-improvement", "human:release", "release fixture");
    equal(host.complete(completion, owner).code, "human-decision-required", "no fabricated human admission");
    assert(!host.approve(completion, worker("coworker:reviewer")).ok, "reviewer cannot impersonate owner");
    assert(host.approve(completion, owner).ok, "bounded owner decision");
    assert(host.complete(completion, owner).ok, "release after owner admission");
  });

  test("rework advances iterations and old receipt evidence cannot complete the new pass", () => {
    const host = new FixtureHost();
    finish(host, "self-improvement", "rework:plan");
    const oldImplement = finish(host, "self-improvement", "rework:implement");
    finish(host, "self-improvement", "rework:review-refuse", "needs correction", "refuse");
    equal(host.describe("self-improvement").stageKey, "implement", "kernel returns to implementation");
    equal(host.describe("self-improvement").iteration, 1, "new implementation iteration");
    equal(host.complete(oldImplement, worker("coworker:engineer")).code, "stale-evidence", "old effect cannot be reused");
    finish(host, "self-improvement", "rework:implement-again");
    finish(host, "self-improvement", "rework:review-again");
    finish(host, "self-improvement", "rework:release");
    equal(host.describe("self-improvement").completed, true, "corrected pass completes");
  });

  test("lost acknowledgment recovers one committed result; conflicting replay and revoked replay refuse", () => {
    const first = new FixtureHost();
    const completion = finish(first, "customer-report", "replay:inspect");
    const host = new FixtureHost(first.snapshot());
    const before = JSON.stringify(host.snapshot());
    equal(host.complete(completion, worker("coworker:operations")).code, "replayed", "recover committed attempt");
    equal(JSON.stringify(host.snapshot()), before, "identical delivery does not repeat transition");
    equal(host.complete({ ...completion, content: "changed bytes" }, worker("coworker:operations")).code, "replay-conflict", "changed attempt payload");
    assert(host.revoke("customer-report", owner).ok, "owner revocation");
    equal(host.complete(completion, worker("coworker:operations")).code, "authority-revoked", "replay still checks current authority");
  });

  test("unknown and pending attempts hold; only an observed no-effect permits a distinct retry", () => {
    const host = new FixtureHost();
    assert(host.begin("customer-report", "unknown:original", worker("coworker:operations")).ok, "begin original");
    equal(host.begin("customer-report", "unknown:duplicate", worker("coworker:operations")).code, "attempt-pending", "pending hold");
    assert(host.markUncertain("unknown:original", owner).ok, "lost connection remains unknown");
    equal(host.begin("customer-report", "unknown:blind-retry", worker("coworker:operations")).code, "uncertain-effect", "no blind retry");
    assert(!host.confirmNoEffect("unknown:original", "", owner).ok, "missing receipt is not no-effect proof");
    assert(host.confirmNoEffect("unknown:original", "synthetic target inspection: no effect observed", owner).ok, "explicit target confirmation");
    finish(host, "customer-report", "unknown:confirmed-retry");
  });

  test("protected bytes and transitive upstream lineage are rechecked after restart", () => {
    const first = new FixtureHost();
    improvement(first, "lineage");
    finish(first, "customer-report", "lineage:inspect");
    finish(first, "customer-report", "lineage:draft");
    const state: SampleState = first.snapshot();
    const upstream = state.artifacts.find(artifact => artifact.roomId === "self-improvement" && artifact.stageKey === "implement");
    assert(upstream, "known upstream input");
    upstream.content = "changed after its protected receipt";
    const host = new FixtureHost(state);
    equal(host.begin("customer-report", "lineage:customer-verify", worker("coworker:reviewer")).code, "stale-evidence", "changed transitive input holds dependent work");
  });

  test("a new cycle requires new evidence; wrong pinned state and changed runtime remain held", () => {
    const first = new FixtureHost();
    improvement(first, "cycle-one");
    assert(first.startNextCycle("self-improvement", "run:2", owner).ok, "new bounded cycle through marking reader");
    equal(first.describe("self-improvement").stageKey, "plan", "new cycle starts at plan");
    equal(first.describe("self-improvement").runKey, "run:2", "new run identity");
    const state = first.snapshot();
    state.rooms["self-improvement"]!.definitionVersion = "changed";
    equal(new FixtureHost(state).begin("self-improvement", "cycle:stale", worker("coworker:engineer")).code, "stale-definition", "host verifies exact definition");
    const prior = new FixtureHost();
    const completion = finish(prior, "customer-report", "runtime:inspect");
    equal(new FixtureHost(prior.snapshot(), { profileVersion: 2 }).complete(completion, worker("coworker:operations")).code, "stale-runtime", "material profile change invalidates old reach");
    equal(new FixtureHost(prior.snapshot(), { bindingVersion: 2 }).complete(completion, worker("coworker:operations")).code, "stale-runtime", "material binding change invalidates old reach");
  });

  test("changed prerequisite references and malformed persisted marking write no result", () => {
    const first = new FixtureHost();
    improvement(first, "inputs:improvement");
    finish(first, "customer-report", "inputs:inspect");
    assert(first.begin("customer-report", "inputs:draft", worker("coworker:operations")).ok, "begin linked draft");
    const completion = first.observation("customer-report", "inputs:draft", "draft from exact inputs");
    for (const inputs of [[], completion.inputs.map(ref => ({ ...ref, revision: 2 })), completion.inputs.map(ref => ({ ...ref, content: "changed" }))]) {
      const host = new FixtureHost(first.snapshot());
      const before = JSON.stringify(host.snapshot());
      equal(host.complete({ ...completion, inputs }, worker("coworker:operations")).code, "wrong-inputs", "exact prerequisite references");
      equal(JSON.stringify(host.snapshot()), before, "failed evidence commit is atomic");
    }
    const malformed = first.snapshot();
    malformed.rooms["customer-report"]!.marking.tokens[0]!.node = "stage:unknown";
    equal(new FixtureHost(malformed).begin("customer-report", "inputs:malformed", worker("coworker:operations")).code, "marking-unreadable", "persisted malformed bytes remain held");
  });

  test("withdrawal during a pending attempt prevents its later completion", () => {
    const host = new FixtureHost();
    assert(host.begin("customer-report", "withdraw:inspect", worker("coworker:operations")).ok, "begin before withdrawal");
    const completion = host.observation("customer-report", "withdraw:inspect", "observed after wait");
    assert(host.revoke("customer-report", owner).ok, "withdraw current authority");
    const before = JSON.stringify(host.snapshot());
    equal(host.complete(completion, worker("coworker:operations")).code, "authority-revoked", "waiting does not preserve revoked reach");
    equal(JSON.stringify(host.snapshot()), before, "revoked completion writes nothing");
  });

  test("exhausted rework stops as a hold and cannot masquerade as an accepted improvement", () => {
    const host = new FixtureHost();
    finish(host, "self-improvement", "budget:plan");
    finish(host, "self-improvement", "budget:implement");
    finish(host, "self-improvement", "budget:review-one", "needs correction", "refuse");
    finish(host, "self-improvement", "budget:implement-again");
    finish(host, "self-improvement", "budget:review-two", "still unacceptable", "refuse");
    equal(host.describe("self-improvement").completed, false, "budget stop is not success");
    equal(host.describe("self-improvement").held, true, "bounded rework exhaustion is explicit");
    finish(host, "customer-report", "budget:customer-inspect");
    equal(host.begin("customer-report", "budget:customer-draft", worker("coworker:operations")).code, "dependency-held", "held improvement never satisfies the prerequisite");
  });

  test("human checkpoint binds exact content, verdict and attempt rather than only the stage", () => {
    const first = new FixtureHost();
    for (const stage of ["plan", "implement", "verify"]) finish(first, "self-improvement", `checkpoint:${stage}`);
    assert(first.begin("self-improvement", "checkpoint:release", owner).ok, "begin exact candidate");
    const completion = first.observation("self-improvement", "checkpoint:release", "reviewed release bytes");
    assert(first.approve(completion, owner).ok, "owner admits exact candidate");
    for (const changed of [{ ...completion, content: "unreviewed content" }, { ...completion, verdict: "refuse" as const }]) {
      const host = new FixtureHost(first.snapshot());
      const before = JSON.stringify(host.snapshot());
      equal(host.complete(changed, owner).code, "human-decision-required", "changed reviewed payload requires a new decision");
      equal(JSON.stringify(host.snapshot()), before, "changed candidate writes nothing");
    }
    assert(first.markUncertain("checkpoint:release", owner).ok, "original attempt uncertain");
    assert(first.confirmNoEffect("checkpoint:release", "synthetic target confirms no release", owner).ok, "original no-effect observed");
    assert(first.begin("self-improvement", "checkpoint:retry", owner).ok, "distinct retry");
    const retry = first.observation("self-improvement", "checkpoint:retry", "reviewed release bytes");
    equal(first.complete(retry, owner).code, "human-decision-required", "old exact-attempt admission cannot authorize another attempt");
  });

  test("revoked upstream authority invalidates dependent current evidence without erasing recorded effects", () => {
    const host = new FixtureHost();
    improvement(host, "revoked-upstream");
    finish(host, "customer-report", "revoked-upstream:customer-inspect");
    finish(host, "customer-report", "revoked-upstream:customer-draft");
    const ready = host.snapshot();
    assert(host.revoke("self-improvement", owner).ok, "revoke upstream authority");
    const before = JSON.stringify(host.snapshot());
    equal(host.begin("customer-report", "revoked-upstream:customer-verify", worker("coworker:reviewer")).code, "stale-evidence", "recursive upstream authority check");
    equal(JSON.stringify(host.snapshot()), before, "stale dependent evidence writes nothing");
    assert(host.snapshot().artifacts.some(artifact => artifact.roomId === "self-improvement"), "revocation retains historical effect records");
    const pending = new FixtureHost(ready);
    assert(pending.begin("customer-report", "revoked-upstream:pending-verify", worker("coworker:reviewer")).ok, "admitted before upstream withdrawal");
    const completion = pending.observation("customer-report", "revoked-upstream:pending-verify", "observed after upstream withdrawal");
    assert(pending.revoke("self-improvement", owner).ok, "withdraw prerequisite while dependent attempt waits");
    const pendingBefore = JSON.stringify(pending.snapshot());
    equal(pending.complete(completion, worker("coworker:reviewer")).code, "stale-evidence", "current prerequisite rechecked at completion");
    equal(JSON.stringify(pending.snapshot()), pendingBefore, "pending stale completion writes nothing");
  });

  return { passed, qualification: "synthetic-only" };
}
