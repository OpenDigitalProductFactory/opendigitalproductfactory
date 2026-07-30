// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExpandableCard } from "./ExpandableCard";
import { countDisclosureRegions, defaultVisibleHtml } from "../../../lib/ux-budget";

afterEach(() => cleanup());

describe("ExpandableCard", () => {
  it("connects one summary trigger to its inline detail panel", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ExpandableCard
        id="change-rfc-1"
        open={false}
        onOpenChange={onOpenChange}
        summary={<span>RFC-1 Ship release</span>}
      >
        <p>Approval chain</p>
      </ExpandableCard>,
    );

    const trigger = screen.getByRole("button", { name: /RFC-1 Ship release/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBe("change-rfc-1-panel");
    expect(screen.queryByRole("region")).toBeNull();

    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <ExpandableCard
        id="change-rfc-1"
        open
        onOpenChange={onOpenChange}
        summary={<span>RFC-1 Ship release</span>}
      >
        <p>Approval chain</p>
      </ExpandableCard>,
    );

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("region");
    expect(panel.getAttribute("id")).toBe("change-rfc-1-panel");
    expect(panel.getAttribute("aria-labelledby")).toBe("change-rfc-1-trigger");
    expect(screen.getAllByText(/RFC-1 Ship release/)).toHaveLength(1);
    expect(screen.getByText("Approval chain")).toBeTruthy();
  });

  it("uses the same trigger for collapse and exposes a visible state indicator", () => {
    const onOpenChange = vi.fn();
    render(
      <ExpandableCard
        id="catalog-maintenance"
        open
        onOpenChange={onOpenChange}
        summary={<span>Maintenance window</span>}
      >
        <p>Template items</p>
      </ExpandableCard>,
    );

    const trigger = screen.getByRole("button", { name: /Maintenance window/ });
    expect(screen.getByTestId("expandable-card-indicator").textContent).toBe("▾");
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("uses theme tokens and connected expanded styling", () => {
    const { container } = render(
      <ExpandableCard
        id="themed"
        open
        onOpenChange={() => undefined}
        summary={<span>Themed disclosure</span>}
      >
        <p>Detail</p>
      </ExpandableCard>,
    );

    expect(container.innerHTML).toContain("var(--dpf-");
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(container.querySelector('[data-open="true"]')).toBeTruthy();
  });

  // BI-2B196D07 — measured through the real budget helpers, because the defect was that
  // the canonical construct was invisible to them: zero disclosure regions meant a
  // correctly-deferring surface failed the blocking `deferred-detail` check while the
  // same surface built from a raw <details> passed.
  it("is countable as a disclosure region while its summary stays in the measured scope", () => {
    const { container } = render(
      <ExpandableCard
        id="change-rfc-9"
        open={false}
        onOpenChange={() => undefined}
        summary={<span>RFC-9 summary line</span>}
      >
        <p>Deferred approval chain</p>
      </ExpandableCard>,
    );

    const html = container.innerHTML;
    expect(countDisclosureRegions(html)).toBe(1);
    expect(defaultVisibleHtml(html)).toContain("RFC-9 summary line");
  });

  it("renders always-visible actions outside the disclosure trigger", () => {
    render(
      <ExpandableCard
        id="owner-decision"
        open={false}
        onOpenChange={() => undefined}
        summary={<span>Approve this bill?</span>}
        actions={<a href="/finance/bills">Review bill</a>}
      >
        <p>Technical detail</p>
      </ExpandableCard>,
    );

    const disclosure = screen.getByRole("button", { name: /Approve this bill/ });
    const action = screen.getByRole("link", { name: "Review bill" });
    expect(disclosure.contains(action)).toBe(false);
    expect(action.getAttribute("href")).toBe("/finance/bills");
  });
});
