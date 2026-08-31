// scripts/measure-capability-completeness.test.mjs
//
// Tests the PARSING, not the current numbers. The numbers move every time a
// grant, skill, or journey lands — asserting them here would make this test a
// changelog. What must not move is the parser: if it silently mis-reads a
// registry, the measure under-reports gaps and the whole contract becomes a
// false all-clear, which is worse than having no measure at all.
//
// The false-positive this guards against is real: the first run of this scanner
// reported 8 unbacked skill ids because it knew only skills/**/*.skill.md and
// not packages/dpf-skill-pack/skills/*/SKILL.md. Seven were genuine; one was
// the parser's fault.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canCall,
  expandGrants,
  loadSubstrate,
  objectLiteralBody,
  normalizeGeneratedPath,
  parseSkillFrontmatter,
  parseStringArrayMap,
  parseTopLevelKeys,
  stripLineComments,
} from "./measure-capability-completeness.mjs";

test("canonical registry tool grants participate in capability reachability", () => {
  const substrate = loadSubstrate();
  const held = substrate.heldGrants.get("policy-enforcement-agent") ?? [];

  assert.ok(
    held.includes("registry_read"),
    "agent_registry.json config_profile.tool_grants must be measured for registry-only identities",
  );
});

test("the alternate onboarding seed participates in the workforce roster", () => {
  assert.ok(loadSubstrate().roster.includes("onboarding-coo"));
});

test("generated capability paths use repository-stable separators", () => {
  assert.equal(
    normalizeGeneratedPath("skills\\platform\\ingest-article.skill.md"),
    "skills/platform/ingest-article.skill.md",
  );
});

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function shippedArtifact() {
  return JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, "apps", "web", "lib", "coworker-lifecycle", "capability-completeness.generated.json"),
    "utf8",
  ));
}

test("objectLiteralBody brace-matches instead of stopping at the first close", () => {
  const src = `export const X = { a: ["p"], b: { c: ["q"] }, d: ["r"] };`;
  const body = objectLiteralBody(src, "X");
  assert.ok(body.includes('d: ["r"]'), "nested object truncated the block");
});

test("objectLiteralBody returns null for an absent identifier", () => {
  assert.equal(objectLiteralBody("const Y = {};", "NOPE"), null);
});

test("parseStringArrayMap reads quoted and bare keys, and keeps the first", () => {
  const m = parseStringArrayMap(`"a-b": ["x", "y"], coo: ["z"], "a-b": ["late"]`);
  assert.deepEqual(m.get("a-b"), ["x", "y"]);
  assert.deepEqual(m.get("coo"), ["z"]);
});

test("stripLineComments prevents a commented-out entry from parsing as real", () => {
  const src = `const X = {\n  // "ghost": ["grant"],\n  "real": ["grant"],\n};`;
  const m = parseStringArrayMap(objectLiteralBody(stripLineComments(src), "X"));
  assert.equal(m.has("ghost"), false, "a commented entry was counted as live");
  assert.equal(m.has("real"), true);
});

test("parseTopLevelKeys ignores keys nested inside a value", () => {
  const body = `"outer": [{ "inner": 1 }], "second": []`;
  assert.deepEqual(parseTopLevelKeys(body), ["outer", "second"]);
});

test("parseSkillFrontmatter reads inline arrays and scalars", () => {
  const fm = parseSkillFrontmatter(
    `---\nname: gap-assessment\nassignTo: ["policy-specialist"]\ntaskType: "analysis"\n---\nbody\n`,
  );
  assert.equal(fm.name, "gap-assessment");
  assert.deepEqual(fm.assignTo, ["policy-specialist"]);
  assert.equal(fm.taskType, "analysis");
});

test("parseSkillFrontmatter returns null without frontmatter delimiters", () => {
  assert.equal(parseSkillFrontmatter("no frontmatter here"), null);
});

test("expandGrants applies implications one-way only", () => {
  const impl = new Map([["backlog_write", ["build_evidence"]]]);
  assert.equal(expandGrants(["backlog_write"], impl).has("build_evidence"), true);
  assert.equal(expandGrants(["build_evidence"], impl).has("backlog_write"), false);
});

test("canCall names the missing grants rather than just failing", () => {
  const tools = new Map([["evaluate_profession_decision", ["registry_read"]]]);
  const denied = canCall("evaluate_profession_decision", new Set(["file_read"]), tools);
  assert.equal(denied.reachable, false);
  assert.deepEqual(denied.missingGrants, ["registry_read"]);

  const allowed = canCall("evaluate_profession_decision", new Set(["registry_read"]), tools);
  assert.equal(allowed.reachable, true);
});

test("canCall reports an unknown tool as unreachable, never as allowed", () => {
  const r = canCall("no_such_tool", new Set(["registry_read"]), new Map());
  assert.equal(r.reachable, false);
});

// ── v2: the inventory join and the scoring contract ──────────────────────

import {
  PLANES,
  PLANE_CONTRACT,
  buildInventory,
  parseStringMap,
  scoreIdentity,
} from "./measure-capability-completeness.mjs";

test("parseStringMap reads the slug -> canonical bridge", () => {
  const m = parseStringMap(`coo: "AGT-ORCH-000",\n  "ux-design-critic": "AGT-906",`);
  assert.equal(m.get("coo"), "AGT-ORCH-000");
  assert.equal(m.get("ux-design-critic"), "AGT-906");
});

test("buildInventory collapses a slug and its canonical agent into ONE identity", () => {
  // The whole point of the bridge: `coo` and `coo-orchestrator` are one agent.
  // Joining on handles alone would report two, inflating the inventory and
  // making a healthy agent look like a declared-only orphan.
  const s = {
    registry: [{ agent_id: "AGT-ORCH-000", agent_name: "coo-orchestrator", status: "active" }],
    roster: ["coo"],
    rosterNames: new Map([["coo", "COO"]]),
    slugToCanonical: new Map([["coo", "AGT-ORCH-000"]]),
  };
  const inv = buildInventory(s);
  assert.equal(inv.length, 1);
  assert.deepEqual([...inv[0].handles].sort(), ["coo", "coo-orchestrator"]);
  assert.equal(inv[0].identityClass, "active-roster");
});

test("buildInventory keeps a roster coworker with no canonical mapping", () => {
  const s = {
    registry: [],
    roster: ["compliance-officer"],
    rosterNames: new Map([["compliance-officer", "Compliance Officer"]]),
    slugToCanonical: new Map(),
  };
  const inv = buildInventory(s);
  assert.equal(inv.length, 1);
  assert.equal(inv[0].identityClass, "roster-only");
});

test("buildInventory classifies a declared registry agent that was never seeded", () => {
  const s = {
    registry: [{ agent_id: "AGT-S2P-POL", agent_name: "policy-specialist", status: "defined" }],
    roster: [],
    rosterNames: new Map(),
    slugToCanonical: new Map(),
  };
  assert.equal(buildInventory(s)[0].identityClass, "declared-only");
});

test("every plane declares a ceiling no greater than the top of the ladder", () => {
  for (const p of PLANES) {
    const c = PLANE_CONTRACT[p];
    assert.ok(c.ceiling >= 0 && c.ceiling <= 3, `${p} ceiling out of range`);
    assert.ok(c.weight > 0, `${p} must carry a weight`);
    // A plane capped below 3 must say WHY, or the cap reads as an agent defect.
    if (c.ceiling < 3) assert.ok(c.blocker, `${p} is capped but names no blocker`);
    for (const level of [0, 1, 2, 3]) {
      assert.ok(c.criteria[level], `${p} has no criterion for level ${level}`);
    }
  }
});

test("scoreIdentity never scores a plane above its ceiling, and attainable >= absolute", () => {
  const s = {
    heldGrants: new Map(), grantImplications: new Map(),
    toolToGrants: new Map([["evaluate_profession_decision", ["registry_read"]], ["principle_decide", ["registry_read"]]]),
    professionOfRole: new Map(), corpusPages: new Map(), skills: [], packSkillNames: new Set(),
    selfTaskAgents: new Set(), jobCatalog: "", curatedJourneyAgents: new Set(),
    servicesByAgent: new Map(), roster: [],
  };
  const ident = {
    key: "ghost", handles: new Set(["ghost"]), registry: null, onRoster: false,
    rosterSlug: null, identityClass: "declared-only", displayName: "Ghost",
  };
  const scored = scoreIdentity(ident, s);
  for (const p of PLANES) {
    assert.ok(scored.planes[p].level <= 3);
    assert.equal(scored.planes[p].ceiling, PLANE_CONTRACT[p].ceiling);
  }
  assert.ok(scored.score.attainablePct >= scored.score.absolutePct);
});

test("an agent with nothing scores zero rather than throwing", () => {
  const s = {
    heldGrants: new Map(), grantImplications: new Map(), toolToGrants: new Map(),
    professionOfRole: new Map(), corpusPages: new Map(), skills: [], packSkillNames: new Set(),
    selfTaskAgents: new Set(), jobCatalog: "", curatedJourneyAgents: new Set(),
    servicesByAgent: new Map(), roster: [],
  };
  const scored = scoreIdentity(
    { key: "x", handles: new Set(["x"]), registry: null, onRoster: false, rosterSlug: null, identityClass: "declared-only", displayName: "X" },
    s,
  );
  assert.equal(scored.planes.governance.level, 0);
  assert.equal(scored.planes.corpus.level, 0);
});

// ── the consult gate is derived, not enumerated (TAK §8.4.1) ────────────────

test("the shipped artifact reports gate coverage derived from declared consequence", () => {
  const artifact = shippedArtifact();
  const gate = artifact.summary.consequentialGate;

  // The seed is CARRIED, not replaced: dropping it would silently shrink reach.
  for (const seeded of gate.seedOnly) {
    assert.ok(gate.classifiedTools.includes(seeded), `seed ${seeded} must stay gated`);
  }
  // Coverage is materially above the two-name allowlist it replaced.
  assert.ok(gate.gateClassified > gate.seedOnly.length);
  assert.ok(gate.coveragePct >= 25, `coverage ${gate.coveragePct}% is below the ratchet floor`);
  // The gate only REACHES the derived set if the composition root installs it.
  assert.equal(gate.resolverInstalled, true);
  // Every consequence class is represented, so no criterion was skipped.
  for (const cls of ["outward", "irreversible", "authority"]) {
    assert.ok(gate.byConsequenceClass[cls] > 0, `no tool declares ${cls}`);
  }
});

test("the shipped artifact shows a coworker with a declared shape AND a declared cadence", () => {
  const artifact = shippedArtifact();
  assert.ok(artifact.summary.planeLevels.shape.ceiling > 0, "shape ceiling is still zero");
  assert.ok(artifact.summary.skills.cadenceCapable > 0, "no skill can declare a cadence");

  const shaped = artifact.agents.filter((a) => a.planes.shape.level > 0);
  assert.ok(shaped.length > 0, "no agent has a declared work shape");
  // Its cadence must be declared on the skill, not only in a registry.
  assert.ok(shaped.some((a) => a.planes.cadence.level === 3));
});
