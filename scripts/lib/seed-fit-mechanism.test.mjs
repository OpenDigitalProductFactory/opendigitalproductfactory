import assert from "node:assert/strict";
import test from "node:test";

import {
  SCOPE_ENFORCEMENT_MECHANISMS,
  describeScopeMechanism,
  evaluateScopeMechanism,
  findMechanismEvidence,
  isScopedSeedFitDecision,
  parseSeedFitMechanism,
} from "./seed-fit-mechanism.mjs";

const reader = (files) => (file) => {
  if (!(file in files)) throw new Error(`no such file ${file}`);
  return files[file];
};

test("only archetype/vertical answers claim a scope, so only they owe a mechanism", () => {
  for (const scoped of ["archetype-scoped", "vertical-scoped", "ARCHETYPE-SCOPED"]) {
    assert.equal(isScopedSeedFitDecision(scoped), true, scoped);
  }
  for (const unscoped of ["global-default", "parameterize-first", "install-local-only", "reject-as-seed", null, undefined]) {
    assert.equal(isScopedSeedFitDecision(unscoped), false, String(unscoped));
  }
});

test("a global-default answer is not asked for a mechanism", () => {
  const result = evaluateScopeMechanism({ decision: "global-default", prBody: "Seed-Fit-Decision: global-default" });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "not-a-scoped-decision");
});

test("reads mechanism and symbol in either order on the decision line", () => {
  assert.deepEqual(
    parseSeedFitMechanism("Seed-Fit-Decision: archetype-scoped mechanism=read-scope symbol=regulationApplies"),
    { mechanism: "read-scope", symbol: "regulationApplies" },
  );
  assert.deepEqual(
    parseSeedFitMechanism("Seed-Fit-Decision: archetype-scoped symbol=referenceModelAppliesToInstall mechanism=seed-gate"),
    { mechanism: "seed-gate", symbol: "referenceModelAppliesToInstall" },
  );
});

test("a quoted example in a fenced block is documentation, not an attestation", () => {
  const body = [
    "Here is how to answer:",
    "```",
    "Seed-Fit-Decision: archetype-scoped mechanism=seed-gate symbol=someRule",
    "```",
    "",
    "Seed-Fit-Decision: archetype-scoped mechanism=read-scope symbol=realRule",
  ].join("\n");
  assert.deepEqual(parseSeedFitMechanism(body), { mechanism: "read-scope", symbol: "realRule" });
});

test("a scoped answer with no mechanism is refused, and says what to add", () => {
  const result = evaluateScopeMechanism({
    decision: "archetype-scoped",
    prBody: "Seed-Fit-Decision: archetype-scoped",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing-mechanism");
  assert.match(describeScopeMechanism(result), /mechanism=seed-gate/);
  assert.match(describeScopeMechanism(result), /mechanism=read-scope/);
});

test("an unknown mechanism is refused and the vocabulary is named", () => {
  const result = evaluateScopeMechanism({
    decision: "archetype-scoped",
    prBody: "Seed-Fit-Decision: archetype-scoped mechanism=vibes symbol=x",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown-mechanism");
  for (const mechanism of SCOPE_ENFORCEMENT_MECHANISMS) {
    assert.match(describeScopeMechanism(result), new RegExp(mechanism));
  }
});

test("a mechanism with no symbol is refused: an unnameable rule cannot be checked", () => {
  const result = evaluateScopeMechanism({
    decision: "archetype-scoped",
    prBody: "Seed-Fit-Decision: archetype-scoped mechanism=seed-gate",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing-symbol");
});

// The defect this whole rule exists for: BI-C44EAEE6, where the seed half shipped
// and the read half did not, and the claim looked fine in prose.
test("a named symbol that no changed file references is refused", () => {
  const result = evaluateScopeMechanism({
    decision: "archetype-scoped",
    prBody: "Seed-Fit-Decision: archetype-scoped mechanism=read-scope symbol=describeReferenceModelApplicability",
    changedFiles: ["apps/web/lib/explore/ea-data.ts"],
    readFile: reader({ "apps/web/lib/explore/ea-data.ts": "const models = await prisma.eaReferenceModel.findMany();" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "symbol-not-in-diff");
  assert.match(describeScopeMechanism(result), /BI-C44EAEE6/);
});

test("a named symbol the diff actually wires passes, and reports where", () => {
  const result = evaluateScopeMechanism({
    decision: "archetype-scoped",
    prBody: "Seed-Fit-Decision: archetype-scoped mechanism=read-scope symbol=describeReferenceModelApplicability",
    changedFiles: ["apps/web/lib/explore/ea-data.ts", "docs/user-guide/architecture/index.md"],
    readFile: reader({
      "apps/web/lib/explore/ea-data.ts": "const applicability = describeReferenceModelApplicability(model.slug, install);",
      "docs/user-guide/architecture/index.md": "Some models are universal.",
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "mechanism-wired");
  assert.deepEqual(result.evidenceFiles, ["apps/web/lib/explore/ea-data.ts"]);
});

test("an unreadable path is not evidence, and does not crash the gate", () => {
  const files = findMechanismEvidence({
    symbol: "regulationApplies",
    changedFiles: ["deleted.ts", "kept.ts"],
    readFile: reader({ "kept.ts": "regulationApplies(spec, profile)" }),
  });
  assert.deepEqual(files, ["kept.ts"]);
});

test("both live mechanisms in the codebase are accepted vocabulary", () => {
  // seed-gate is referenceModelAppliesToInstall; read-scope is regulationApplies.
  for (const [mechanism, symbol] of [["seed-gate", "referenceModelAppliesToInstall"], ["read-scope", "regulationApplies"]]) {
    const result = evaluateScopeMechanism({
      decision: "vertical-scoped",
      prBody: `Seed-Fit-Decision: vertical-scoped mechanism=${mechanism} symbol=${symbol}`,
      changedFiles: ["x.ts"],
      readFile: reader({ "x.ts": `import { ${symbol} } from "./rule";` }),
    });
    assert.equal(result.ok, true, mechanism);
  }
});
