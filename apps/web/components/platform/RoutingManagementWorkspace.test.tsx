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
const mount = (value = data, routeTopology = topology) => render(withMessages(<RoutingManagementWorkspace data={value} topology={routeTopology} evidenceEnd={end} windowLabel="Bounded evidence" />));

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
  it.each([
    { correlation: "exact", message: "Attempts are joined by an exact request trace." },
    { correlation: "missing", message: "No request trace was recorded. Attempt and cost correlation is unavailable." },
    { correlation: "ambiguous", message: "This trace belongs to multiple decisions. Attempts and costs cannot be assigned safely." },
  ] as const)("defers the selected endpoint without hiding $correlation correlation evidence", ({ correlation, message }) => {
    const opaqueEndpoint = "endpoint-internal-9f8a7b6c";
    mount({ ...data, receipts: [{ ...receipt, endpointId: opaqueEndpoint, correlation }] });
    fireEvent.click(within(screen.getByRole("region", { name: "Recent routing decisions" })).getByRole("button", { name: /review/i }));
    const dialog = screen.getByRole("dialog", { name: "Routing decision" });
    const why = within(dialog).getByRole("heading", { name: "Why this path" }).closest("section")!;
    expect(why.textContent).not.toContain(opaqueEndpoint);
    expect(why.textContent).not.toContain("Selected endpoint:");
    expect(why.textContent).toContain(message);
    expect(within(dialog).getByText("review → cloud")).toBeTruthy();
    expect(dialog.textContent).toContain("model ·");
    const sourceSummary = within(dialog).getByText("Source evidence identifiers");
    const source = sourceSummary.closest("details")!;
    expect(source.open).toBe(false);
    expect(within(source).getByText(opaqueEndpoint)).toBeTruthy();
    fireEvent.click(sourceSummary);
    expect(source.open).toBe(true);
    expect(within(source).getByText(opaqueEndpoint)).toBeTruthy();
  });
  it.each(["all", "cloud"])("explains no matching providers and restores the %s provider scope after clearing search", provider => {
    window.history.replaceState(null, "", window.location.pathname + window.location.search + "&routingProvider=" + provider);
    const originalUrl = window.location.href;
    const catalogTopology = { ...topology, providers: [...topology.providers, { ...topology.providers[0], providerId: "local", label: "Local" }] };
    mount({ ...data, models: [...data.models, { endpointId: "local-endpoint", providerId: "local", modelId: "local-model", label: "Local model", status: "active" }] }, catalogTopology);
    fireEvent.click(screen.getByRole("button", { name: "All 2" }));
    const dialog = screen.getByRole("dialog", { name: "Provider and model catalog" });
    const search = within(dialog).getByRole("searchbox", { name: "Search by name, task, model or identifier" });
    fireEvent.change(search, { target: { value: "unmatched-provider-or-model" } });
    expect(within(dialog).getByRole("status").textContent).toContain("No matching providers");
    expect(within(dialog).getByText("Clear the search or try a provider or model name.")).toBeTruthy();
    expect(within(dialog).getByText("0 results")).toBeTruthy();
    expect(within(dialog).queryByRole("link", { name: "Settings & overrides" })).toBeNull();
    fireEvent.change(search, { target: { value: "" } });
    expect(within(dialog).queryByText("No matching providers")).toBeNull();
    expect(within(dialog).getByRole("heading", { name: "Cloud" })).toBeTruthy();
    expect(within(dialog).getByText(provider === "all" ? "2 results" : "1 result")).toBeTruthy();
    expect(within(dialog).getAllByRole("link", { name: "Settings & overrides" })).toHaveLength(provider === "all" ? 2 : 1);
    if (provider === "all") expect(within(dialog).getByRole("heading", { name: "Local" })).toBeTruthy();
    else expect(within(dialog).queryByRole("heading", { name: "Local" })).toBeNull();
    expect(window.location.href).toBe(originalUrl);
  });
  it.each(["all", "cloud"])("explains no matching assignments and restores the %s investigation scope", provider => {
    window.history.replaceState(null, "", window.location.pathname + window.location.search + "&routingProvider=" + provider);
    const originalUrl = window.location.href;
    const assignmentTopology = { ...topology, coworkers: [...topology.coworkers,
      { agentId: "cloud-worker", label: "Second reviewer", stationLabel: null },
      { agentId: "local-worker", label: "Local reviewer", stationLabel: null },
      { agentId: "other-task-worker", label: "Other task reviewer", stationLabel: null },
      { agentId: "public-worker", label: "Public reviewer", stationLabel: null },
      { agentId: "expired-worker", label: "Expired reviewer", stationLabel: null },
    ], providers: [...topology.providers, { ...topology.providers[0], providerId: "local", label: "Local" }] };
    const assignmentReceipts: RoutingReceipt[] = [receipt,
      { ...receipt, id: "second-decision", actorId: "cloud-worker" },
      { ...receipt, id: "local-decision", actorId: "local-worker", providerId: "local" },
      { ...receipt, id: "other-task-decision", actorId: "other-task-worker", task: "analysis" },
      { ...receipt, id: "public-decision", actorId: "public-worker", sensitivity: "public" },
      { ...receipt, id: "expired-decision", actorId: "expired-worker", occurredAt: "2026-10-12T10:59:59Z" },
    ];
    mount({ ...data, receipts: assignmentReceipts }, assignmentTopology);
    const assignments = within(screen.getByRole("region", { name: "Grouped routing flow" })).getByRole("heading", { name: "Assignments" });
    fireEvent.click(within(assignments.parentElement!).getByRole("button", { name: provider === "all" ? "All 3" : "All 2" }));
    const dialog = screen.getByRole("dialog", { name: "Assignments" });
    const search = within(dialog).getByRole("searchbox", { name: "Search by name, task, model or identifier" });
    fireEvent.change(search, { target: { value: "unmatched-assignment" } });
    expect(within(dialog).getByRole("status").textContent).toContain("No matching assignments");
    expect(within(dialog).getByText("Clear the search or try an assignment name or identifier.")).toBeTruthy();
    expect(within(dialog).getByText("0 results")).toBeTruthy();
    expect(within(dialog).queryByRole("link", { name: "Assignment settings" })).toBeNull();
    fireEvent.change(search, { target: { value: "" } });
    expect(within(dialog).queryByText("No matching assignments")).toBeNull();
    expect(within(dialog).getByText(provider === "all" ? "3 results" : "2 results")).toBeTruthy();
    expect(within(dialog).getByText("Reviewer", { exact: true })).toBeTruthy();
    expect(within(dialog).getByText("Second reviewer", { exact: true })).toBeTruthy();
    expect(within(dialog).getAllByRole("link", { name: "Assignment settings" })).toHaveLength(provider === "all" ? 3 : 2);
    if (provider === "all") expect(within(dialog).getByText("Local reviewer", { exact: true })).toBeTruthy();
    else expect(within(dialog).queryByText("Local reviewer", { exact: true })).toBeNull();
    for (const label of ["Other task reviewer", "Public reviewer", "Expired reviewer"]) {
      expect(within(dialog).queryByText(label, { exact: true })).toBeNull();
    }
    for (const query of ["second REVIEWER", "cloud-worker"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(within(dialog).getByText("1 result")).toBeTruthy();
      expect(within(dialog).getByText("Second reviewer", { exact: true })).toBeTruthy();
      expect(within(dialog).queryByText("Reviewer", { exact: true })).toBeNull();
      expect(within(dialog).getByRole("link", { name: "Assignment settings" }).getAttribute("href")).toBe("/platform/ai/agent/cloud-worker");
    }
    fireEvent.change(search, { target: { value: "" } });
    expect(within(dialog).getByText(provider === "all" ? "3 results" : "2 results")).toBeTruthy();
    expect(window.location.href).toBe(originalUrl);
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
