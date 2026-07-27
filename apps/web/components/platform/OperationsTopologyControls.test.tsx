// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { buildOperationsMapTopologyFixture } from "@/test-support/operations-map-fixture";
import { OperationsTopologyControls } from "./OperationsTopologyControls";
import { OPERATIONS_MAP_A2A_PREFERENCE_KEY } from "./ai-operations-map-prefs";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("OperationsTopologyControls", () => {
  it("publishes provider and A2A filters from one control rail", async () => {
    const onRoutingChange = vi.fn();
    const onA2aChange = vi.fn();
    const { getByLabelText } = render(
      <OperationsTopologyControls
        topology={buildOperationsMapTopologyFixture()}
        dimension="both"
        onRoutingChange={onRoutingChange}
        onA2aChange={onA2aChange}
        onReplayChange={() => undefined}
      />,
    );

    fireEvent.change(getByLabelText("Route filter"), { target: { value: "failover" } });
    fireEvent.change(getByLabelText("A2A authority"), { target: { value: "governed" } });

    await waitFor(() => {
      expect(onRoutingChange).toHaveBeenLastCalledWith({
        routeFilter: "failover",
        providerTypeFilter: "llm",
        providerFilter: "all",
      });
      expect(onA2aChange.mock.calls.at(-1)?.[0].authority).toBe("governed");
    });
  });

  it("hydrates and preserves the existing A2A saved-filter contract", async () => {
    localStorage.setItem(OPERATIONS_MAP_A2A_PREFERENCE_KEY, JSON.stringify({
      types: ["a2a-handoff"],
      states: ["failed"],
      actorId: "all",
      actorRole: "either",
      authority: "ungoverned",
    }));
    const onA2aChange = vi.fn();
    const { getByLabelText } = render(
      <StrictMode>
        <OperationsTopologyControls
          topology={buildOperationsMapTopologyFixture()}
          dimension="a2a"
          onRoutingChange={() => undefined}
          onA2aChange={onA2aChange}
          onReplayChange={() => undefined}
        />
      </StrictMode>,
    );

    await waitFor(() => expect((getByLabelText("A2A authority") as HTMLSelectElement).value).toBe("ungoverned"));
    expect(getByLabelText("A2A phase handoff").getAttribute("aria-pressed")).toBe("true");
    expect(getByLabelText("A2A delegation").getAttribute("aria-pressed")).toBe("false");
    expect(JSON.parse(localStorage.getItem(OPERATIONS_MAP_A2A_PREFERENCE_KEY) ?? "{}")).toMatchObject({
      types: ["a2a-handoff"],
      states: ["failed"],
      authority: "ungoverned",
    });

    fireEvent.click(getByLabelText("A2A delegation"));
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(OPERATIONS_MAP_A2A_PREFERENCE_KEY) ?? "{}").types).toEqual([
        "a2a-delegation",
        "a2a-handoff",
      ]);
    });
  });

  it("publishes replay changes and renders table-equivalent topology evidence", async () => {
    const onReplayChange = vi.fn();
    const { container, getByLabelText } = render(
      <OperationsTopologyControls
        topology={buildOperationsMapTopologyFixture()}
        dimension="both"
        onRoutingChange={() => undefined}
        onA2aChange={() => undefined}
        onReplayChange={onReplayChange}
      />,
    );

    expect(container.querySelector("[data-operations-topology-ledger]")).not.toBeNull();
    expect(container.textContent).toContain("Provider route");
    expect(container.textContent).toContain("A2A");

    fireEvent.change(getByLabelText("Routing replay cursor"), { target: { value: "25" } });
    await waitFor(() => expect(onReplayChange).toHaveBeenCalled());
  });
});
