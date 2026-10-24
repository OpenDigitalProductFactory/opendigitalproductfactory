// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { auditUxBudget, measureUxBudget } from "@/lib/ux-budget";
import { DELIVERY_TASK_HUB_EVENT } from "@/lib/work-capsules/delivery-task-stream";
import type { DeliveryTaskHubPage } from "@/lib/work-capsules/delivery-task-hub-store";
import type { DeliveryTaskHubRow } from "@/lib/work-capsules/delivery-task-hub";
import { DeliveryTaskHub } from "./DeliveryTaskHub";

const hook = vi.hoisted(() => ({
  named: {} as Record<string, (event: MessageEvent) => void>,
  status: "open" as "connecting" | "open" | "reconnecting",
}));

vi.mock("@/lib/hooks/useResilientEventSource", () => ({
  useResilientEventSource: (_url: string, options: { onNamed?: Record<string, (event: MessageEvent) => void> }) => {
    hook.named = options.onNamed ?? {};
    return { status: hook.status };
  },
}));

afterEach(() => {
  cleanup();
  hook.status = "open";
  hook.named = {};
  vi.unstubAllGlobals();
});

function row(overrides: Partial<DeliveryTaskHubRow> = {}): DeliveryTaskHubRow {
  return {
    capsuleId: "WC-1",
    title: "Ship the task hub",
    objective: "Operators can leave work and return to its outcome.",
    group: "working",
    status: "working",
    statusIntent: "info",
    ownerLabel: "Codex desktop",
    stageLabel: "Working",
    source: "backlog",
    backlogItemId: "BI-1",
    branch: "feat/task-hub",
    taskRunId: "TR-1",
    observedAt: "2026-09-04T12:00:00.000Z",
    freshness: "fresh",
    freshnessReason: null,
    latestTransition: { id: "a1", kind: "status-changed", summary: "Implementation started", recordedAt: "2026-09-04T12:00:00.000Z" },
    progress: { completed: 2, total: 5, percent: 40 },
    nextAction: null,
    verifiedResult: null,
    inspectHref: "/build/work/WC-1",
    resumeHref: "/build",
    pullRequestHref: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5000",
    primaryAction: { label: "Resume", href: "/build" },
    secondaryActions: [
      { label: "Inspect", href: "/build/work/WC-1" },
      { label: "Handoff", href: "/build/work/WC-1#handoff" },
    ],
    asyncOperation: { coreHandleAvailable: false },
    ...overrides,
  };
}

function page(rows: DeliveryTaskHubRow[], nextCursor: string | null = null): DeliveryTaskHubPage {
  return { rows, nextCursor, observedAt: "2026-09-04T12:00:00.000Z" };
}

describe("DeliveryTaskHub", () => {
  it("renders grouped accessible cards with the operator facts and actions", () => {
    render(<DeliveryTaskHub initialPage={page([
      row({ asyncOperation: {
        coreHandleAvailable: true,
        operationId: "op-authorized-1",
        status: "running",
        observedAt: "2026-09-04T12:00:00.000Z",
        progressPct: 45,
        progressMessage: "Generating result",
      } }),
      row({ capsuleId: "WC-2", group: "needs-attention", status: "failed", statusIntent: "danger", title: "Repair reviewer", primaryAction: { label: "Inspect", href: "/build/work/WC-2" }, nextAction: "Inspect" }),
    ])} />);

    expect(screen.getByRole("heading", { name: "Delivery task hub" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Working" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeTruthy();
    expect(screen.getAllByText("Codex desktop")).toHaveLength(2);
    expect(screen.getAllByText("Age")).toHaveLength(2);
    expect(screen.getAllByText("Now")).toHaveLength(2);
    expect(screen.getAllByText("Implementation started")).toHaveLength(2);
    expect(screen.getAllByText("2 of 5")).toHaveLength(2);
    expect(screen.getByText("Async running")).toBeTruthy();
    expect(screen.getByText("op-authorized-1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Resume Ship the task hub" }).getAttribute("href")).toBe("/build");
    expect(screen.getByRole("link", { name: "Handoff Ship the task hub" }).className).toContain("min-h-11");
  });

  it("keeps confirmed rows visible while reconnecting and after a stream error", () => {
    hook.status = "reconnecting";
    const { rerender } = render(<DeliveryTaskHub initialPage={page([row()])} />);
    expect(screen.getByText("Ship the task hub")).toBeTruthy();
    expect(screen.getAllByText(/Reconnecting/).length).toBeGreaterThan(0);

    act(() => {
      hook.named[DELIVERY_TASK_HUB_EVENT]?.(new MessageEvent("message", {
        data: JSON.stringify({ type: "error", error: "snapshot_failed", observedAt: "2026-09-04T12:01:00.000Z" }),
      }));
    });
    hook.status = "open";
    rerender(<DeliveryTaskHub initialPage={page([row()])} />);
    expect(screen.getByText("Ship the task hub")).toBeTruthy();
    expect(screen.getByText(/could not refresh/)).toBeTruthy();
  });

  it("drops separately paged stale rows when a reconnect snapshot becomes authoritative", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => page([row({ capsuleId: "WC-OLDER", title: "Older stale task" })]),
    });
    vi.stubGlobal("fetch", fetch);
    render(<DeliveryTaskHub initialPage={page([row()], "opaque-cursor")} />);
    fireEvent.click(screen.getByRole("button", { name: "Load older delivery tasks" }));
    expect(await screen.findByText("Older stale task")).toBeTruthy();

    act(() => {
      hook.named[DELIVERY_TASK_HUB_EVENT]?.(new MessageEvent("message", {
        data: JSON.stringify({
          type: "snapshot",
          rows: [row({ capsuleId: "WC-NEW", title: "Reconciled task" })],
          nextCursor: null,
          observedAt: "2026-09-04T12:05:00.000Z",
        }),
      }));
    });

    expect(screen.queryByText("Older stale task")).toBeNull();
    expect(screen.getByText("Reconciled task")).toBeTruthy();
  });

  it("discards an older page that resolves after a reconnect snapshot", async () => {
    let resolvePage: ((value: DeliveryTaskHubPage) => void) | undefined;
    const deferredPage = new Promise<DeliveryTaskHubPage>((resolve) => {
      resolvePage = resolve;
    });
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: () => deferredPage });
    vi.stubGlobal("fetch", fetch);
    render(<DeliveryTaskHub initialPage={page([row()], "opaque-cursor")} />);

    fireEvent.click(screen.getByRole("button", { name: "Load older delivery tasks" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const requestSignal = fetch.mock.calls[0]?.[1]?.signal as AbortSignal;

    act(() => {
      hook.named[DELIVERY_TASK_HUB_EVENT]?.(new MessageEvent("message", {
        data: JSON.stringify({
          type: "snapshot",
          rows: [row({ capsuleId: "WC-NEW", title: "Reconciled task" })],
          nextCursor: null,
          observedAt: "2026-09-04T12:05:00.000Z",
        }),
      }));
    });
    await act(async () => {
      resolvePage?.(page([
        row({ capsuleId: "WC-STALE", title: "Stale deferred task" }),
      ], "stale-cursor"));
      await deferredPage;
    });

    expect(requestSignal.aborted).toBe(true);
    expect(screen.queryByText("Stale deferred task")).toBeNull();
    expect(screen.getByText("Reconciled task")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load older delivery tasks" })).toBeNull();
  });

  it("distinguishes a true empty window and loads an older bounded cursor page", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => page([row({ capsuleId: "WC-OLDER", title: "Older task" })]) });
    vi.stubGlobal("fetch", fetch);
    const view = render(<DeliveryTaskHub initialPage={page([])} />);
    expect(screen.getByText("No delivery Workrooms in this 30-day window")).toBeTruthy();

    view.unmount();
    render(<DeliveryTaskHub initialPage={page([row()], "opaque-cursor")} />);
    fireEvent.click(screen.getByRole("button", { name: "Load older delivery tasks" }));
    expect(await screen.findByText("Older task")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/work-capsules/delivery-page?cursor=opaque-cursor", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("keeps the arrival view bounded and accessible when one group has many tasks", async () => {
    const rows = Array.from({ length: 5 }, (_, index) => row({
      capsuleId: `WC-${index + 1}`,
      title: `Delivery task ${index + 1}`,
    }));
    const { container } = render(<DeliveryTaskHub initialPage={page(rows)} />);

    expect(screen.getByText("Show 3 more working tasks")).toBeTruthy();
    const metrics = measureUxBudget(container.innerHTML);
    expect(metrics.primaryActions).toBe(1);
    expect(metrics.hasLeadBand).toBe(true);
    expect(metrics.hasNextActionMarker).toBe(true);
    expect(metrics.disclosureRegions).toBe(1);
    expect(metrics.subLegibleControls).toBe(0);
    const blocking = auditUxBudget(container.innerHTML, "list", { routeStatus: "net-new" })
      .findings.filter((finding) => !finding.ok && finding.severity === "blocking");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
    console.log(`[ux-budget delivery-task-hub] ${JSON.stringify({ ...metrics, axeViolations: results.violations.length })}`);
  });
});
