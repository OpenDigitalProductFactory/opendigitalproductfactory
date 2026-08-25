import assert from "node:assert/strict";
import test from "node:test";

import storefrontTemplates from "../../packages/storefront-templates/src/index.ts";
import { pages } from "./_content.mjs";
import {
  buildOutputs,
  resolveCanonicalLeaves,
  unexpectedLeafArtifacts,
} from "./_generate.mjs";

const { ALL_ARCHETYPES, deriveOperationalValueStream } = storefrontTemplates;

test("every public category leaf resolves to the canonical archetype registry", () => {
  for (const page of pages) {
    const leaves = resolveCanonicalLeaves(page);
    assert.equal(
      leaves.length,
      page.leaf.length,
      `${page.slug} must not drop a hand-authored leaf`,
    );
    assert.equal(
      new Set(leaves.map((leaf) => leaf.archetypeId)).size,
      leaves.length,
      `${page.slug} must not project the same archetype twice`,
    );
  }
});

test("operator pages link to canonical leaf detail and keep technical audiences secondary", () => {
  const outputs = buildOutputs();
  const nonprofit = outputs.get("nonprofits-and-community.html");

  assert.ok(nonprofit, "nonprofit category page must be generated");
  assert.match(nonprofit, /href="\/business-types\/archetypes\/pet-rescue\.html"/);
  assert.match(nonprofit, /href="\/business-types\/partners\.html"/);
  assert.match(nonprofit, /href="\/business-types\/architecture\.html"/);
  assert.doesNotMatch(nonprofit, /Use it · Resell it · Understand it/);
  assert.doesNotMatch(nonprofit, /Every business finds customers/);
  assert.doesNotMatch(nonprofit, /id="resell"|id="for-builders"|id="archetype-engine"/);
});

test("leaf pages project the same value-stream labels as the canonical derivation", () => {
  const outputs = buildOutputs();
  const petRescue = ALL_ARCHETYPES.find((item: { archetypeId: string }) => item.archetypeId === "pet-rescue");
  assert.ok(petRescue, "pet-rescue must exist in the canonical registry");

  const model = deriveOperationalValueStream(petRescue);
  const html = outputs.get("archetypes/pet-rescue.html");
  assert.ok(html, "pet-rescue detail must be generated");
  assert.match(html, /data-canonical-archetype-id="pet-rescue"/);
  assert.match(html, /Canonical projection · shipped definition/);
  for (const stage of model.stages) {
    const escapedLabel = stage.label.replaceAll("&", "&amp;");
    assert.ok(html.includes(`>${escapedLabel}<`), `missing canonical stage ${stage.label}`);
  }
});

test("partner and architecture material has explicit secondary destinations", () => {
  const outputs = buildOutputs();
  const partners = outputs.get("partners.html");
  const architecture = outputs.get("architecture.html");

  assert.ok(partners);
  assert.ok(architecture);
  assert.match(partners, /For resellers, builders, and delivery partners/);
  assert.match(architecture, /How archetype definitions become public pages/);
  assert.match(architecture, /packages\/storefront-templates\/src/);
});

test("drift detection rejects orphaned leaf projections", () => {
  const outputs = buildOutputs();
  assert.deepEqual(
    unexpectedLeafArtifacts(outputs, ["pet-rescue.html", "retired-archetype.html"]),
    ["archetypes/retired-archetype.html"],
  );
});
