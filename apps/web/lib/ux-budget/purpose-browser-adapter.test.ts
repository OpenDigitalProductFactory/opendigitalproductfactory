// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { capturePurposeEvidenceFromDom } from "./purpose-browser-adapter";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("capturePurposeEvidenceFromDom", () => {
  it("excludes inaccessible, empty, transparent, and obstructed evidence", () => {
    document.body.innerHTML = `
      <main data-dpf-purpose-route="/ops/self-upgrade" data-dpf-purpose-state="update-available">
        <h1>Self-Upgrade</h1>
        <h1 aria-hidden="true">Hidden duplicate title</h1>
        <div data-dpf-purpose-key="visible-state">Update available</div>
        <div data-dpf-purpose-key="hidden-state" style="display:none">Hidden</div>
        <div data-dpf-purpose-key="empty-state"></div>
        <div data-dpf-purpose-key="aria-hidden-state" aria-hidden="true">Hidden from assistive technology</div>
        <div data-dpf-purpose-key="inert-state" inert>Inert</div>
        <div data-dpf-purpose-key="transparent-state" style="opacity:0">Transparent</div>
        <div style="opacity:0"><div data-dpf-purpose-key="ancestor-transparent-state">Ancestor transparent</div></div>
        <div data-dpf-purpose-key="covered-state" data-covered>Covered</div>
        <button data-dpf-primary-action data-dpf-purpose-action-key="start-upgrade">Upgrade now</button>
        <div role="button" tabindex="0" data-dpf-purpose-action-key="role-only-action">Looks interactive</div>
        <button disabled data-dpf-purpose-action-key="disabled-action">Disabled</button>
        <a aria-label="Refresh status" href="/ops/self-upgrade" data-dpf-purpose-action-key="status-refresh" data-dpf-purpose-correction-signal-key="status-refresh"><svg aria-hidden="true"></svg></a>
        <div data-dpf-purpose-recovery-signal>
          <a href="/recover-widget" data-dpf-purpose-action-key="recover-widget" data-dpf-purpose-recovery-action>Recover widget</a>
        </div>
        <div data-dpf-purpose-completion-signal-key="hidden-completion" aria-hidden="true">Done</div>
        <div data-dpf-purpose-correction-signal-key="covered-correction" data-covered>Corrected</div>
        <div data-dpf-purpose-consequence data-covered>Consequence</div>
        <div id="overlay">Overlay</div>
      </main>
    `;
    const elements = [
      ...document.querySelectorAll<HTMLElement>("main *"),
    ];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const index = elements.indexOf(this as HTMLElement);
        const top = 10 + Math.max(index, 0) * 50;
        return {
          top,
          bottom: top + 44,
          left: 10,
          right: 150,
          width: 140,
          height: 44,
          x: 10,
          y: top,
          toJSON: () => ({}),
        };
      },
    );
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(1_200);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn((_x: number, y: number) => {
        const target = elements.find((element) => {
          const rect = element.getBoundingClientRect();
          return y >= rect.top && y <= rect.bottom;
        });
        return target?.hasAttribute("data-covered")
          ? document.querySelector("#overlay")
          : target ?? null;
      }),
    });

    const evidence = capturePurposeEvidenceFromDom();

    expect(evidence?.h1Count).toBe(1);
    expect(evidence?.purposeKeys).toEqual(["visible-state"]);
    expect(evidence?.completionSignalKeys).toEqual([]);
    expect(evidence?.actions.find((action) => action.key === "status-refresh")).toMatchObject({
      accessibleName: "Refresh status",
      semanticRole: "link",
      enabled: true,
      focusable: true,
      unobstructed: true,
    });
    expect(evidence?.correctionSignalKeys).toEqual(["status-refresh"]);
    expect(evidence?.consequentialAction?.consequenceVisible).toBe(false);
    expect(evidence?.actions[0]).toMatchObject({
      accessibleName: "Upgrade now",
      semanticRole: "button",
      enabled: true,
      focusable: true,
      unobstructed: true,
    });
    expect(evidence?.actions[1]).toMatchObject({
      semanticRole: null,
    });
    expect(evidence?.actions[2]).toMatchObject({
      enabled: false,
      focusable: false,
    });
    expect(evidence?.recoverySignal).toEqual({
      present: true,
      actionKey: "recover-widget",
      routePath: "/recover-widget",
    });
  });
});
