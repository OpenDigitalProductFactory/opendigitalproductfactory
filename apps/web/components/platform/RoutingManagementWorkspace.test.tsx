// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { withMessages } from "@/test-support/with-messages";
import type { RoutingManagementData, RoutingReceipt } from "@/lib/ai-operations-map/routing-management-types";
import type { OperationsMapRoutingTopology } from "@/lib/ai-operations-map/types";
import { RoutingManagementWorkspace } from "./RoutingManagementWorkspace";
import { RoutingManagementNav } from "./RoutingManagementNav";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search), usePathname: () => window.location.pathname, useRouter: () => ({ push: navigation.push }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
const end = "2026-10-12T12:00:00Z";
const receipt: RoutingReceipt = { id: "decision-1", occurredAt: end, actorId: "worker", task: "review", sensitivity: "internal", providerId: "cloud", modelId: "model", endpointId: "endpoint", correlation: "missing", screen: null, exclusions: [{ providerId: "local", modelId: null, hold: "tokens" }], attempts: [], execution: "unknown", selectedExecution: "unknown", shadowMode: false, costUsd: null, tokens: null, costSource: null, sourceIds: [], recipeKey: null, evaluator: null, quality: null };
const data: RoutingManagementData = { observedAt: end, receipts: [receipt], models: [{ endpointId: "endpoint", providerId: "cloud", modelId: "model", label: "Model", status: "active" }], controls: [] };
const topology: OperationsMapRoutingTopology = { coworkers: [{ agentId: "worker", label: "Reviewer", stationLabel: null }], providers: [{ providerId: "cloud", label: "Cloud", status: "active", kind: "cloud", providerType: "llm", costUsd: 0, tokenTotal: 0, decisionCount: 1 }], routes: [], activityRouting: null, a2aEdges: [], deliberations: [], markers: [], timeline: [], legend: [], a2aLegend: [] };
const mount = (value = data) => render(withMessages(<RoutingManagementWorkspace data={value} topology={topology} evidenceEnd={end} windowLabel="Bounded evidence" />));

beforeEach(() => {
  navigation.push.mockClear();
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
  it("keeps traffic evidence labeled when rows reflow on narrow screens", () => {
    mount();
    const table = within(screen.getByRole("region", { name: "Recent routing decisions" })).getByRole("table");
    expect(within(table).getAllByText("Execution")).toHaveLength(2);
    expect(within(table).getAllByText("Recorded")).toHaveLength(2);
    expect(within(table).getByRole("button", { name: /review.*worker/i })).toBeTruthy();
    expect(within(table).getByText("model · internal")).toBeTruthy();
  });
  it("keeps evaluation denominators paired with labels in reflowed rows", () => {
    window.history.replaceState(null, "", "/platform/ai/operations-map?routingView=evaluation&routingWindow=60");
    mount();
    const table = within(screen.getByRole("region", { name: "Task evaluation" })).getByRole("table");
    expect(within(table).getAllByText("Evaluated quality")).toHaveLength(2);
    expect(within(table).getAllByText("Operator feedback")).toHaveLength(2);
    expect(within(table).getByText("0/1 scored · unavailable")).toBeTruthy();
  });
  it("keeps the searchable traffic catalog's reflowed evidence labeled", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "View all 1" }));
    const table = within(screen.getByRole("dialog", { name: "Routing traffic" })).getByRole("table");
    expect(within(table).getAllByText("Cost")).toHaveLength(2);
    expect(within(table).getByRole("button", { name: /review.*worker/i })).toBeTruthy();
  });
});

describe("existing provider navigation", () => {
  it("uses one canonical platform navigation with direct routing views and a wider-workspace exit", () => {
    window.history.replaceState(null, "", "/platform/ai/providers");
    render(withMessages(<RoutingManagementNav />));
    expect(document.querySelectorAll('[data-component="platform-tab-nav"]')).toHaveLength(1);
    const traffic = screen.getByRole("link", { name: "Traffic" });
    expect(traffic.closest("[data-advanced-tools]")).toBeNull();
    expect(screen.getByRole("link", { name: "Providers" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "All AI workspaces" }).getAttribute("href")).toContain("/platform/ai/overview");
    expect(screen.queryByRole("link", { name: "Providers & Routing" })).toBeNull();
    const mobile = screen.getByRole("combobox", { name: "Routing management" });
    expect((within(mobile).getByRole("option", { name: "Providers" }) as HTMLOptionElement).selected).toBe(true);
    expect(within(mobile).getByRole("option", { name: "All AI workspaces" })).toBeTruthy();
    const target = screen.getByRole("link", { name: "Evaluation" }).getAttribute("href")!;
    fireEvent.change(mobile, { target: { value: target } });
    expect(navigation.push).toHaveBeenLastCalledWith(target);
  });
  it("retains investigation scope across a reload in the wider AI workspace", () => {
    window.history.replaceState(null, "", "/platform/ai/overview?routingWindow=15&routingTask=review&routingData=internal");
    const view = render(withMessages(<RoutingManagementNav />));
    expect(screen.getByRole("link", { name: "Workforce" })).toBeTruthy();
    window.history.replaceState(null, "", "/platform/ai/providers");
    view.rerender(withMessages(<RoutingManagementNav />));
    const query = new URLSearchParams(window.location.search);
    expect(query.get("routingTask")).toBe("review");
    expect(query.get("routingWindow")).toBe("15");
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
