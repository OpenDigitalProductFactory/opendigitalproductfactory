// @vitest-environment jsdom
// UX-budget measurement for the inherited-stages disclosure (BI-4B11F98E).
// Composing a leaf profile with the backbone put five generic stages on the
// strip and pushed /admin/twin-kit over its frozen word budget. This measures the
// strip with pet-rescue's real, composed stage flow: once with every stage inline
// (what the sweep measured on the first CI run) and once with the inherited
// stages deferred behind the disclosure. The numbers feed
// docs/ux-fit/2026-09-06-twin-strip-inherited-stages.ux-fit.json.
import axe from "axe-core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_ARCHETYPES, deriveTwinValueStreamBinding } from "@dpf/storefront-templates";

import { measureUxBudget } from "@/lib/ux-budget";
import { buildStageFlow } from "@/lib/twin/stage-flow";

import { ValueStreamStrip } from "./ValueStreamStrip";

afterEach(cleanup);

function petRescueFlow() {
  const archetype = ALL_ARCHETYPES.find((a) => a.archetypeId === "pet-rescue");
  if (!archetype) throw new Error("no pet-rescue archetype");
  return buildStageFlow(deriveTwinValueStreamBinding(archetype), {});
}

describe("ValueStreamStrip word budget with a composed profile", () => {
  it("defers inherited backbone stages so the composed strip is no wordier than the leaf-only strip", async () => {
    const composed = petRescueFlow();
    expect(composed.filter((s) => s.inherited)).toHaveLength(5);

    const inline = render(
      <ValueStreamStrip stages={composed.map((s) => ({ ...s, inherited: false }))} />,
    );
    const inlineMetrics = measureUxBudget(inline.container.innerHTML);
    cleanup();

    const deferred = render(<ValueStreamStrip stages={composed} />);
    const deferredMetrics = measureUxBudget(deferred.container.innerHTML);
    const results = await axe.run(deferred.container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

    const leafOnly = render(<ValueStreamStrip stages={composed.filter((s) => !s.inherited)} />);
    const leafOnlyMetrics = measureUxBudget(leafOnly.container.innerHTML);

    console.log(
      `[ux-budget twin-strip] ${JSON.stringify({ inline: inlineMetrics, deferred: deferredMetrics, leafOnly: leafOnlyMetrics, axeViolations: results.violations.length })}`,
    );
    expect(deferredMetrics.defaultVisibleWords).toBeLessThan(inlineMetrics.defaultVisibleWords);
    expect(deferredMetrics.defaultVisibleWords).toBeLessThanOrEqual(leafOnlyMetrics.defaultVisibleWords + 2);
  });
});
