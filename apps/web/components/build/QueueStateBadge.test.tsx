// apps/web/components/build/QueueStateBadge.test.tsx
//
// Pins the WCAG-1.4.1 shape+color contract for the BS-queue badge and the
// per-kind tooltip + aria-label shape.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QueueStateBadge, type BuildQueueState } from "./QueueStateBadge";
import { BUILD_STUDIO_TEST_IDS } from "./build-studio-layout";

function htmlFor(state: BuildQueueState): string {
  return renderToStaticMarkup(<QueueStateBadge state={state} />);
}

describe("QueueStateBadge", () => {
  it("renders NOTHING for kind='idle' (no DOM output)", () => {
    expect(htmlFor({ kind: "idle" })).toBe("");
  });

  it("renders running glyph + correct aria-label + tooltip", () => {
    const html = htmlFor({ kind: "running", stepLabel: "Generate code" });
    expect(html).toContain('aria-label="Running"');
    expect(html).toContain('title="Running: Generate code"');
    expect(html).toContain('data-kind="running"');
    // Running glyph uses a <polygon> (filled triangle play).
    expect(html).toContain("<polygon");
  });

  it("renders running tooltip without step label gracefully", () => {
    const html = htmlFor({ kind: "running", stepLabel: null });
    expect(html).toContain('title="Running"');
  });

  it("renders queued glyph with the position number inside the SVG (shape-not-just-color)", () => {
    const html = htmlFor({ kind: "queued", position: 3, reason: "capacity", ahead: 2 });
    expect(html).toContain('aria-label="Queued, position 3"');
    expect(html).toContain('title="Queued at position 3 (capacity — 2 builds ahead)"');
    expect(html).toContain('data-kind="queued"');
    expect(html).toContain('data-position="3"');
    // Number appears inside the SVG text element.
    expect(html).toMatch(/<text[^>]*>3<\/text>/);
  });

  it("renders queued tooltip with singular '1 build ahead' when ahead=1", () => {
    const html = htmlFor({ kind: "queued", position: 2, reason: "dependency", ahead: 1 });
    expect(html).toContain("1 build ahead");
    expect(html).toContain("dependency");
  });

  it("caps queued position display at 99+ so the badge stays bounded", () => {
    const html = htmlFor({ kind: "queued", position: 142, reason: "capacity", ahead: 141 });
    expect(html).toMatch(/<text[^>]*>99\+<\/text>/);
  });

  it("renders blocked glyph (two pause bars) + reason in tooltip", () => {
    const html = htmlFor({ kind: "blocked", reason: "review failed" });
    expect(html).toContain('aria-label="Blocked"');
    expect(html).toContain('title="Blocked: review failed"');
    expect(html).toContain('data-kind="blocked"');
    // Pause glyph uses two <rect> bars.
    const rects = html.match(/<rect[\s>]/g) ?? [];
    expect(rects.length).toBe(2);
  });

  it("uses distinct shape glyphs per kind (running=polygon, blocked=rects, queued=text)", () => {
    const running = htmlFor({ kind: "running", stepLabel: null });
    const blocked = htmlFor({ kind: "blocked", reason: "x" });
    const queued = htmlFor({ kind: "queued", position: 1, reason: "capacity", ahead: 0 });
    // Each glyph has a unique shape signature, so color alone isn't conveying state.
    expect(running).toContain("<polygon");
    expect(blocked).not.toContain("<polygon");
    expect(queued).toMatch(/<path[\s>]/);
  });

  it("uses DPF CSS variables for color tokens (state + foreground)", () => {
    const html = htmlFor({ kind: "running", stepLabel: null });
    expect(html).toContain("var(--dpf-state-success)");
    expect(html).toContain("var(--dpf-success)");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it("uses distinct fg/bg variable sources per state (no chip-collapse bug)", () => {
    // Distinct state-X bg + foreground X for each non-idle kind.
    expect(htmlFor({ kind: "running", stepLabel: null })).toMatch(
      /bg-\[var\(--dpf-state-success\)\][^"]*text-\[var\(--dpf-success\)\]/,
    );
    expect(htmlFor({ kind: "queued", position: 1, reason: "capacity", ahead: 0 })).toMatch(
      /bg-\[var\(--dpf-state-info\)\][^"]*text-\[var\(--dpf-info\)\]/,
    );
    expect(htmlFor({ kind: "blocked", reason: "x" })).toMatch(
      /bg-\[var\(--dpf-state-warning\)\][^"]*text-\[var\(--dpf-warning\)\]/,
    );
  });

  it("emits the canonical test ID on the wrapper for non-idle states", () => {
    const html = htmlFor({ kind: "running", stepLabel: null });
    expect(html).toContain(`data-testid="${BUILD_STUDIO_TEST_IDS.queueStateBadge}"`);
  });

  it("bounded size: 14x14 — won't expand the 32px fleet row", () => {
    const html = htmlFor({ kind: "running", stepLabel: null });
    expect(html).toContain("h-[14px]");
    expect(html).toContain("w-[14px]");
  });
});
