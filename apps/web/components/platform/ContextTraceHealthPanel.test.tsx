// @vitest-environment jsdom
//
// The load-bearing assertion here is the UX-budget one: this panel MUST measure as
// deferred. /platform/ai/runtime-health sits at a frozen word baseline, so if the panel's
// content counted toward the default-visible scope it would blow the ratchet — and the
// fix would be to delete the diagnostic rather than hide it properly. Asserting it
// against the real budget helpers means that can never regress silently.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ContextTraceHealthPanel } from "./ContextTraceHealthPanel";
import { countDisclosureRegions, defaultVisibleHtml } from "@/lib/ux-budget";
import { summarizeContextTraces } from "@/lib/tak/context-trace-health";
import { countWords } from "@/lib/owner-first/ux-audit";

afterEach(() => cleanup());

const traceRow = (over: Record<string, unknown> = {}) => ({
  version: 1,
  modelTier: "strong",
  budget: { total: 3000, l0: 625, l1: 800, l2: 1575 },
  totalTokens: 2000,
  budgetUtilization: 0.667,
  selected: [{ source: "domain", tier: "L1", tokenCount: 400 }],
  dropped: [],
  ...over,
});

const withLoss = summarizeContextTraces([
  traceRow({ dropped: [{ source: "semantic-memory", tier: "L2", tokenCount: 900 }] }),
  traceRow({ selected: [{ source: "page-data", tier: "L1", tokenCount: 120, usedCompressed: true }] }),
  traceRow(),
]);

describe("ContextTraceHealthPanel", () => {
  it("is measured as a disclosure region, and its content is excised from the budget", () => {
    const { container } = render(
      <ContextTraceHealthPanel health={withLoss} sampleSize={200} />,
    );
    const html = container.innerHTML;

    expect(countDisclosureRegions(html)).toBe(1);

    // The table body must NOT count against the route's default-visible words.
    const visible = defaultVisibleHtml(html);
    expect(visible).not.toContain("semantic-memory");
    expect(countWords(visible)).toBeLessThan(15);
  });

  it("shows the decision, and the summary line survives collapse for scanning", () => {
    render(<ContextTraceHealthPanel health={withLoss} sampleSize={200} />);
    expect(screen.getByText(/Context budget: what recent turns were given/)).toBeTruthy();
    expect(screen.getByText(/2 of 3 sampled turns \(67%\)/)).toBeTruthy();
  });

  it("distinguishes 'nothing recorded yet' from 'nothing lost'", () => {
    const { rerender } = render(
      <ContextTraceHealthPanel health={summarizeContextTraces([])} sampleSize={200} />,
    );
    expect(screen.getByText(/No turns .* recorded a context-arbitration trace/)).toBeTruthy();

    rerender(<ContextTraceHealthPanel health={summarizeContextTraces([traceRow()])} sampleSize={200} />);
    expect(screen.getByText(/nothing dropped or compressed/)).toBeTruthy();
  });

  it("never claims the loss degraded an answer — it reports the decision only", () => {
    const { container } = render(
      <ContextTraceHealthPanel health={withLoss} sampleSize={200} />,
    );
    expect(container.textContent).toMatch(/not\s+whether the answer was worse/);
    expect(container.textContent).not.toMatch(/degraded|poor quality|incorrect answer/i);
  });

  it("renders no table when nothing was lost, rather than an empty frame", () => {
    const { container } = render(
      <ContextTraceHealthPanel health={summarizeContextTraces([traceRow()])} sampleSize={200} />,
    );
    expect(container.querySelector("table")).toBeNull();
  });
});
