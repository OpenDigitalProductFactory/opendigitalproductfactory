// Self-test for the landing orchestrator and the obligation banner (BI-4CE4F52F).
//
// What matters here is NOT that the happy path works — it is that the two
// mechanisms which replace remembered prose actually carry their payload:
//
//   1. gate:context must surface the GENERATE COMMAND for a stale derived
//      artifact, not just its path. Without the command, a reader still has to
//      know the repo, which is the gap that made the old pointer useless.
//   2. `land` must refuse to invent a PR-body attestation. A tool that silently
//      wrote "Seed-Fit-Decision: global-default" would be worse than the manual
//      process it replaces.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGateContext } from "./lib/gate-context.mjs";
import { STEPS, bodyRequiredTrailers, missingBodyAttestations } from "./land-branch.mjs";
import { obligationLines } from "./pregate-preflight.mjs";

test("a stale derived artifact carries the command that regenerates it", () => {
  // agent_registry.json is a source of the capability-completeness measure.
  const context = buildGateContext({
    changedFiles: ["packages/db/data/agent_registry.json"],
    repoRoot: process.cwd(),
  });
  const entry = (context.derivedArtifacts ?? []).find((d) => d.id === "capability-completeness");
  assert.ok(entry, "expected the capability-completeness group to be affected");
  assert.ok(Array.isArray(entry.generate) && entry.generate.length > 0,
    "generate command must be surfaced, not just the artifact paths");
  assert.match(entry.generate.join(" "), /measure-capability-completeness/);
  // The paths are still there — this adds to the contract, it does not replace it.
  assert.ok(entry.artifacts.some((a) => a.endsWith(".generated.json")));
});

test("the obligation banner names the attestation AND where it goes", () => {
  const context = buildGateContext({
    changedFiles: ["packages/db/data/agent_registry.json"],
    repoRoot: process.cwd(),
  });
  const seedFit = (context.trailers ?? []).find((t) => /Seed-Fit/.test(t.trailer ?? ""));
  assert.ok(seedFit, "a canonical seed change must require Seed-Fit-Decision");
  // The distinction that is easy to get wrong and expensive to miss: this gate
  // reads the push-event body, so the same text in a commit trailer does not
  // satisfy it.
  assert.match(seedFit.note ?? "", /PR BODY/i);
});

test("the banner renders without throwing, and stays silent when there is nothing to say", () => {
  const lines = obligationLines(process.cwd());
  assert.ok(Array.isArray(lines));
  // A refusal banner that throws would mask the guard failure it explains.
  assert.doesNotThrow(() => obligationLines("/nonexistent-path-for-this-test"));
  assert.deepEqual(obligationLines("/nonexistent-path-for-this-test"), []);
});

test("land refuses to invent a PR-body attestation", () => {
  const context = {
    trailers: [
      { trailer: "Seed-Fit-Decision:", level: "required", because: "seed changed",
        note: "this one goes in the PR BODY" },
      { trailer: "Data-Impact:", level: "required", because: "schema changed", note: "" },
    ],
  };
  assert.deepEqual(bodyRequiredTrailers(context).map((t) => t.trailer), ["Seed-Fit-Decision:"]);
  // Absent from the body → named as missing, never synthesised.
  assert.deepEqual(missingBodyAttestations(context, "some body"), ["Seed-Fit-Decision: (seed changed)"]);
  // Present → satisfied. Only PR-BODY ones are policed here; commit trailers are
  // judged by the gates that read the commit.
  assert.deepEqual(missingBodyAttestations(context, "Seed-Fit-Decision: global-default"), []);
});

test("the landing sequence gates BEFORE it pushes or opens anything", () => {
  // Ordering is the safety property: a PR that exists before its gate passed
  // contradicts "PR creation means ready to merge".
  const i = (s) => STEPS.indexOf(s);
  assert.ok(i("local-gates") < i("commit"), "local gates run against the working tree, pre-commit");
  assert.ok(i("gate") < i("push"), "the gate decides before anything leaves the machine");
  assert.ok(i("push") < i("pull-request"), "push precedes the PR");
  assert.ok(i("pull-request") < i("auto-merge"));
  assert.equal(i("preconditions"), 0, "branch and readiness are checked first");
});
