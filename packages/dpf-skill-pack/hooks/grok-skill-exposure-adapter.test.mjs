import assert from "node:assert/strict";
import { test } from "node:test";

import { assessProcessSpine, loadCleanupPolicy, loadReplacementContract } from "./process-spine-health-check.mjs";
import {
  DPF_PLUGIN_NAME,
  deriveExposedSkillsFromGrokPlugins,
  grokCompetitivePluginIds,
  grokPluginActive,
  parseGrokPluginListOutput,
  probeGrokExposedSkills,
} from "./grok-skill-exposure-adapter.mjs";

const replacements = loadReplacementContract();
const competitivePluginIds = loadCleanupPolicy().clients.find((c) => c.client === "grok").competitivePluginIds;

test("parseGrokPluginListOutput accepts an empty/blank stdout as an empty list", () => {
  assert.deepEqual(parseGrokPluginListOutput(""), []);
  assert.deepEqual(parseGrokPluginListOutput("   \n"), []);
});

test("parseGrokPluginListOutput rejects a non-array JSON payload", () => {
  assert.throws(() => parseGrokPluginListOutput('{"name":"dpf-platform"}'));
});

test("grokPluginActive is true when named and not explicitly disabled", () => {
  const plugins = [{ name: DPF_PLUGIN_NAME }];
  assert.equal(grokPluginActive(plugins, DPF_PLUGIN_NAME), true);
});

test("grokPluginActive honors an explicit enabled:false without requiring the field", () => {
  const plugins = [{ name: DPF_PLUGIN_NAME, enabled: false }];
  assert.equal(grokPluginActive(plugins, DPF_PLUGIN_NAME), false);
});

test("grokPluginActive is false when the plugin is absent", () => {
  assert.equal(grokPluginActive([], DPF_PLUGIN_NAME), false);
  assert.equal(grokPluginActive([{ name: "other-plugin" }], DPF_PLUGIN_NAME), false);
});

test("grokCompetitivePluginIds reads the grok client entry from the shared contract", () => {
  const ids = grokCompetitivePluginIds();
  assert.deepEqual(ids, competitivePluginIds);
  assert.ok(ids.includes("superpowers"));
});

test("deriveExposedSkillsFromGrokPlugins exposes all five DPF replacements when dpf-platform is active", () => {
  const exposed = deriveExposedSkillsFromGrokPlugins([{ name: DPF_PLUGIN_NAME }], {
    replacements,
    competitivePluginIds,
  });
  for (const entry of replacements) {
    assert.ok(exposed.includes(entry.dpfSkill), entry.dpfSkill);
  }
  assert.equal(exposed.some((id) => id.startsWith("superpowers")), false);
});

test("deriveExposedSkillsFromGrokPlugins exposes retired surface ids when a competitive plugin is active", () => {
  const exposed = deriveExposedSkillsFromGrokPlugins([{ name: "superpowers" }], {
    replacements,
    competitivePluginIds,
  });
  assert.ok(exposed.includes("brainstorming"));
  assert.ok(exposed.includes("superpowers:brainstorming"));
  assert.equal(exposed.some((id) => id === "dpf-brainstorming"), false);
});

test("deriveExposedSkillsFromGrokPlugins reports neither side exposed when grok has no relevant plugin", () => {
  const exposed = deriveExposedSkillsFromGrokPlugins([{ name: "unrelated-plugin" }], {
    replacements,
    competitivePluginIds,
  });
  assert.deepEqual(exposed, []);
});

test("deriveExposedSkillsFromGrokPlugins output feeds assessProcessSpine to a clean verdict", () => {
  const exposed = deriveExposedSkillsFromGrokPlugins([{ name: DPF_PLUGIN_NAME }], {
    replacements,
    competitivePluginIds,
  });
  const verdict = assessProcessSpine({ exposedSkills: exposed });
  assert.equal(verdict.exposed.state, "verified");
  assert.equal(verdict.installed.ok, true);
  assert.deepEqual(verdict.exposed.missingDpfSkills, []);
  assert.deepEqual(verdict.conflicts, []);
});

test("deriveExposedSkillsFromGrokPlugins output feeds assessProcessSpine to the exact conflict case from the BI", () => {
  // Reproduces "superpowers:brainstorming visible while dpf-brainstorming is
  // hidden" — the case the process-spine health checker exists to catch.
  const exposed = deriveExposedSkillsFromGrokPlugins([{ name: "superpowers" }], {
    replacements,
    competitivePluginIds,
  });
  const verdict = assessProcessSpine({ exposedSkills: exposed });
  assert.equal(verdict.exposed.state, "verified");
  assert.deepEqual(
    verdict.conflicts.map((c) => c.dpfSkill).sort(),
    replacements.map((r) => r.dpfSkill).sort(),
  );
});

test("probeGrokExposedSkills returns null when the grok binary cannot be spawned", () => {
  const exposed = probeGrokExposedSkills({
    spawn: () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(exposed, null);
});

test("probeGrokExposedSkills returns null on a non-zero exit code", () => {
  const exposed = probeGrokExposedSkills({
    spawn: () => ({ status: 1, stdout: "", error: null }),
  });
  assert.equal(exposed, null);
});

test("probeGrokExposedSkills returns null on unparseable stdout", () => {
  const exposed = probeGrokExposedSkills({
    spawn: () => ({ status: 0, stdout: "not json", error: null }),
  });
  assert.equal(exposed, null);
});

test("probeGrokExposedSkills derives exposure from a mocked successful grok plugin list", () => {
  const exposed = probeGrokExposedSkills({
    spawn: (bin, argv) => {
      assert.equal(bin, "grok");
      assert.deepEqual(argv, ["plugin", "list", "--json"]);
      return { status: 0, error: null, stdout: JSON.stringify([{ name: DPF_PLUGIN_NAME, enabled: true }]) };
    },
  });
  assert.ok(Array.isArray(exposed));
  assert.ok(exposed.includes("dpf-brainstorming"));
});
