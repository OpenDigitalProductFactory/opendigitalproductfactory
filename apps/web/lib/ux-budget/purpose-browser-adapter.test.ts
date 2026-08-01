// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { capturePurposeEvidenceFromDom } from "./purpose-browser-adapter";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("capturePurposeEvidenceFromDom", () => {
  it("excludes hidden and empty evidence and describes action operability", () => {
    document.body.innerHTML = `
      <main data-dpf-purpose-route="/ops/self-upgrade" data-dpf-purpose-state="update-available">
        <h1>Self-Upgrade</h1>
        <div data-dpf-purpose-key="visible-state">Update available</div>
        <div data-dpf-purpose-key="hidden-state" style="display:none">Hidden</div>
        <div data-dpf-purpose-key="empty-state"></div>
        <button data-dpf-primary-action data-dpf-purpose-action-key="start-upgrade">Upgrade now</button>
        <button disabled data-dpf-purpose-action-key="disabled-action">Disabled</button>
        <div data-dpf-purpose-completion-signal-key="hidden-completion" style="display:none">Done</div>
        <div data-dpf-purpose-consequence style="display:none">Consequence</div>
      </main>
    `;
    const rect = {
      top: 10,
      bottom: 54,
      left: 10,
      right: 150,
      width: 140,
      height: 44,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => document.querySelector("[data-dpf-primary-action]")),
    });

    const evidence = capturePurposeEvidenceFromDom();

    expect(evidence?.purposeKeys).toEqual(["visible-state"]);
    expect(evidence?.completionSignalKeys).toEqual([]);
    expect(evidence?.consequentialAction?.consequenceVisible).toBe(false);
    expect(evidence?.actions[0]).toMatchObject({
      accessibleName: "Upgrade now",
      semanticRole: "button",
      enabled: true,
      focusable: true,
      unobstructed: true,
    });
    expect(evidence?.actions[1]).toMatchObject({
      enabled: false,
      focusable: false,
    });
  });
});
