// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { withMessages } from "@/test-support/with-messages";
import type { RoutingManagementData, RoutingReceipt } from "@/lib/ai-operations-map/routing-management-types";
import type { OperationsMapRoutingTopology } from "@/lib/ai-operations-map/types";
import { RoutingManagementWorkspace } from "./RoutingManagementWorkspace";
import { RoutingManagementNav } from "./RoutingManagementNav";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search), usePathname: () => window.location.pathname }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
const end = "2026-10-12T12:00:00Z";
const receipt: RoutingReceipt = { id: "decision-1", occurredAt: end, actorId: "worker", task: "review", sensitivity: "internal", providerId: "cloud", modelId: "model", endpointId: "endpoint", correlation: "missing", screen: null, exclusions: [{ providerId: "local", modelId: null, hold: "tokens" }], attempts: [], execution: "unknown", selectedExecution: "unknown", shadowMode: false, costUsd: null, tokens: null, costSource: null, sourceIds: [], recipeKey: null, evaluator: null, quality: null };
const data: RoutingManagementData = { observedAt: end, receipts: [receipt], models: [{ endpointId: "endpoint", providerId: "cloud", modelId: "model", label: "Model", status: "active" }], controls: [] };
const topology: OperationsMapRoutingTopology = { coworkers: [{ agentId: "worker", label: "Reviewer", stationLabel: null }], providers: [{ providerId: "cloud", label: "Cloud", status: "active", kind: "cloud", providerType: "llm", costUsd: 0, tokenTotal: 0, decisionCount: 1 }], routes: [], activityRouting: null, a2aEdges: [], deliberations: [], markers: [], timeline: [], legend: [], a2aLegend: [] };
const mount = (value = data) => render(withMessages(<RoutingManagementWorkspace data={value} topology={topology} evidenceEnd={end} windowLabel="Bounded evidence" />));

beforeEach(() => {
  window.history.replaceState(null, "", "/platform/ai/operations-map?routingWindow=60&routingTask=review&routingData=internal");
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

describe("routing workspace investigation", () => {
  it("opens a decision overlay with honest costs and preserves scope in provider navigation", () => {
    mount();
    fireEvent.click(within(screen.getByRole("region", { name: "Recent routing decisions" })).getByRole("button", { name: /review/i }));
    expect(screen.getByRole("dialog", { name: "Routing decision" })).toBeTruthy();
    expect(screen.getByText("Token / context limit")).toBeTruthy();
    expect(screen.getByText("No correlated attempt evidence")).toBeTruthy();
    const href = screen.getByRole("link", { name: "Provider settings & overrides" }).getAttribute("href")!;
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/platform/ai/providers/cloud");
    expect(url.searchParams.get("routingTask")).toBe("review");
    expect(url.searchParams.get("routingData")).toBe("internal");
    expect(url.searchParams.get("routingWindow")).toBe("60");
    fireEvent.click(screen.getByRole("button", { name: "Close routing inspector" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("opens the complete searchable provider catalog even without traffic", () => {
    mount({ ...data, receipts: [] });
    expect(screen.getByText("No routing evidence in this scope")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All 1" }));
    expect(screen.getByRole("dialog", { name: "Provider and model catalog" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings & overrides" })).toBeTruthy();
    expect(screen.getByText("1 exposed catalog models")).toBeTruthy();
  });
  it("separates unavailable quality from execution and feedback in evaluation", () => {
    window.history.replaceState(null, "", "/platform/ai/operations-map?routingView=evaluation&routingWindow=60");
    mount();
    expect(screen.getByText("0/1 scored · unavailable")).toBeTruthy();
    expect(screen.getByText("No execution evidence · 1 unknown")).toBeTruthy();
    expect(screen.getByText("No feedback recorded")).toBeTruthy();
  });
});

describe("existing provider navigation", () => {
  it("groups contextual routing links without duplicating the platform navigation landmark", () => {
    window.history.replaceState(null, "", "/platform/ai/providers");
    render(withMessages(<RoutingManagementNav />));
    const shortcuts = screen.getByRole("group", { name: "Routing management" });
    expect(within(shortcuts).getByRole("link", { name: "Traffic" })).toBeTruthy();
    expect(within(shortcuts).getByRole("link", { name: "Providers" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("navigation")).toBeNull();
  });
  it("restores scope when an existing catalog link omits it, and persists it for reload", () => {
    const view = render(withMessages(<RoutingManagementNav />));
    window.history.replaceState(null, "", "/platform/ai/providers/cloud");
    view.rerender(withMessages(<RoutingManagementNav />));
    expect(new URLSearchParams(window.location.search).get("routingTask")).toBe("review");
    expect(new URLSearchParams(window.location.search).get("routingProvider")).toBe("cloud");
    expect(screen.getByRole("link", { name: "Traffic" }).getAttribute("href")).toContain("routingData=internal");
    view.unmount();
    render(withMessages(<RoutingManagementNav />));
    expect(screen.getByRole("link", { name: "Evaluation" }).getAttribute("href")).toContain("routingTask=review");
  });
});
