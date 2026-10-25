// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { DEFAULT_LOCALE, namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import type { ShapeGraph } from "@/lib/work-management/shape-projection";
import { buildWorkroomView } from "@/lib/work-management/room-read-model";
import type { WorkroomView } from "@/lib/work-management/room-types";
import { createWorkroomProcessSnapshot, PROCESS_READ_TIMEOUT_MS, type WorkroomRefreshTarget } from "@/lib/work-management/workroom-process-snapshot";
import { useWorkroomProcessRefresh } from "./useWorkroomProcessRefresh";
import { WorkroomShapeSection } from "./WorkroomShapeSection";

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("processStep=review&processLayout=list&processQuery=Review"),
  usePathname: () => "/workspace/cases/task%3ATR-REFRESH",
  useRouter: () => navigation,
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });

const graph: ShapeGraph = {
  stages: [{ key: "review", label: "Review", state: "unknown", parallel: false, rows: [], inspection: {
    position: "Intended Review", reason: "Provider outcome is uncertain", next: "Read the original execution",
    owner: "Independent reviewer", expectedEvidence: ["review receipt"], affected: [],
  } }],
  blockingStageKey: null, progress: { passed: 0, total: 1 },
  process: { definitionRef: "reviewer@1.0.0", title: "Reviewer recovery", currentStageKey: "review",
    nextPermittedStageKey: null, readAt: "2026-10-23T12:00:00.000Z", lastEvidenceAt: null,
    sourceHealth: "partial", gaps: ["Provider evidence is unavailable"], receipts: [] },
};
const baseRoom = buildWorkroomView({ caseKey: "task%3ATR-REFRESH", detail: {
  summary: { caseId: "task:TR-REFRESH", title: "Reviewer recovery", sourceLabel: "Task", state: "active", stateReason: "Review running",
    a2aStatus: "working", terminal: false, nextAction: "Read evidence", dueAt: null, assignedToUserId: "user-1",
    attention: { required: false, reason: null }, sourceRefs: [] },
  capsules: [], decisions: [], evidence: [], timeline: [],
} });
const room: WorkroomView = { ...baseRoom,
  roomKey: "task%3ATR-REFRESH", caseRef: { caseId: "task:TR-REFRESH", sourceType: "task", sourceId: "TR-REFRESH" },
  identity: {
    definition: { definitionId: "reviewer", version: 1, sourceKey: "reviewer", label: "Reviewer recovery",
      mode: "finite", decisionScope: "wwmd" },
    instance: { instanceId: "workroom-instance:task:TR-REFRESH", occurrenceTrace: {
      caseRef: { caseId: "task:TR-REFRESH", sourceType: "task", sourceId: "TR-REFRESH" },
      sourceRef: { kind: "work-capsule", id: "WC-REFRESH" }, cycleRef: null, executionRefs: [],
    } },
  },
  mode: "finite", currentCycle: null,
};

function showProcess() {
  // The extra target is the proposed explicit page-to-process refresh contract.
  // The old section ignores it, so RED is behavioral rather than a missing import.
  const props = { graph, room, mode: "shape" as const, onModeChange: vi.fn(),
    refreshTarget: { caseKey: "task%3ATR-REFRESH", workroomRowId: "room-refresh-row", workroom: null } };
  return render(<MessagesProvider locale={DEFAULT_LOCALE}
    messages={{ workrooms: namespaceMessages(DEFAULT_LOCALE, "workrooms") }}>
    <WorkroomShapeSection {...props} />
  </MessagesProvider>);
}

describe("Workroom manual projection refresh", () => {
  it("retains the inspected snapshot and keyboard context when its in-flight read fails", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    let rejectRead!: (reason: Error) => void;
    const fetchProjection = vi.fn().mockImplementation(() => new Promise<Response>((_resolve, reject) => { rejectRead = reject; }));
    vi.stubGlobal("fetch", fetchProjection);
    showProcess();
    const gaps = screen.getByText("Projection gaps (1)").closest("details")!;
    const observed = screen.getByText(/Observed execution/).closest("details")!;
    gaps.open = observed.open = true;
    const checked = screen.getByText(/^Checked:/).textContent;
    const refresh = screen.getByRole("button", { name: "Refresh state" });
    refresh.focus();
    await act(async () => { fireEvent.click(refresh); fireEvent.click(refresh); });
    expect(fetchProjection).toHaveBeenCalledOnce();
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(refresh).toHaveFocus();
    expect(refresh).not.toBeDisabled();
    expect(refresh).toHaveAttribute("aria-disabled", "true");
    await act(async () => { rejectRead(new TypeError("Network request failed")); });
    expect(screen.getByText(/Showing the saved snapshot/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh state" })).toHaveFocus();
    expect(screen.getByText(/^Checked:/).textContent).toBe(checked);
    expect(screen.getByText("Reviewer recovery · Definition v1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /1\.\s*Review.*Not verified/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("searchbox", { name: "Search steps" })).toHaveValue("Review");
    expect(gaps).toHaveAttribute("open");
    expect(observed).toHaveAttribute("open");
    fireEvent(window, new Event("online"));
    fireEvent(document, new Event("visibilitychange"));
    expect(fetchProjection).toHaveBeenCalledOnce();
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

const target: WorkroomRefreshTarget = { caseKey: "task%3ATR-REFRESH", workroomRowId: "room-refresh-row", workroom: null };
const saved = () => createWorkroomProcessSnapshot(target, structuredClone(graph),
  { definition: room.identity.definition, mode: room.mode, activeCycle: false }, null);
function newerSnapshot() {
  const snapshot = saved();
  snapshot.graph.process!.readAt = "2026-10-24T12:00:00Z";
  snapshot.graph.process!.title = "Fresh process";
  snapshot.flowMap = { shapeRef: "reviewer@1.0.0", title: "Fresh flow map", signature: "fresh", triggers: [], stages: [],
    ends: { success: false, failure: false, budget: false }, finished: false, graphFlow: false };
  snapshot.flowHealth = "ok";
  snapshot.context.definition = { ...room.identity.definition!, label: "Fresh definition", version: 2 };
  return snapshot;
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json; charset=utf-8" } });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe("manual process read ownership", () => {
  it("does not replace a newer server observation with an older in-flight response", async () => {
    const waiting = deferred<Response>(); vi.stubGlobal("fetch", vi.fn().mockReturnValue(waiting.promise));
    const { result, rerender } = renderHook(({ snapshot }) => useWorkroomProcessRefresh(snapshot, target), { initialProps: { snapshot: saved() } });
    let request!: Promise<void>; act(() => { request = result.current.refresh(); });
    const latest = newerSnapshot(); latest.graph.process!.readAt = "2026-10-25T10:00:00Z";
    latest.graph.process!.title = "Newer server observation"; rerender({ snapshot: latest });
    await act(async () => { waiting.resolve(json(newerSnapshot())); await request; });
    expect(result.current.snapshot.graph.process?.title).toBe("Newer server observation");
    expect(result.current.pending).toBe(false);
  });

  it("updates the process and definition atomically, permits retry, and never reads on mount or browser events", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(newerSnapshot())); vi.stubGlobal("fetch", fetcher);
    const initial = saved();
    const { result, rerender } = renderHook(({ snapshot }) => useWorkroomProcessRefresh(snapshot, target), { initialProps: { snapshot: initial } });
    fireEvent(window, new Event("online")); fireEvent(document, new Event("visibilitychange"));
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => { await result.current.refresh(); });
    expect(result.current.snapshot.context.definition?.label).toBe("Fresh definition");
    expect(result.current.snapshot.graph.process?.title).toBe("Fresh process");
    expect(result.current.snapshot.flowMap?.title).toBe("Fresh flow map");
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/workspace/cases/task%3ATR-REFRESH/projection?"), expect.objectContaining({ cache: "no-store", redirect: "manual", credentials: "same-origin" }));
    rerender({ snapshot: structuredClone(initial) });
    expect(result.current.snapshot.context.definition?.label).toBe("Fresh definition");
    fetcher.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.issue).toBe("failed");
    fetcher.mockResolvedValueOnce(json(newerSnapshot()));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.issue).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([
    [401, "sessionRequired", true], [404, "unavailable", true], [409, "changed", false], [500, "failed", false],
  ] as const)("handles HTTP %i without replacing saved evidence", async (status, issue, hidden) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));
    const { result } = renderHook(() => useWorkroomProcessRefresh(saved(), target));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.issue).toBe(issue); expect(result.current.protectedContentHidden).toBe(hidden);
    expect(result.current.snapshot.graph.process?.readAt).toBe(graph.process?.readAt);
  });
  it.each([
    () => new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }),
    () => new Response("{}", { headers: { "content-type": "application/json-malicious" } }),
    () => new Response("{", { headers: { "content-type": "application/json" } }),
    () => json({ ...newerSnapshot(), identity: { ...newerSnapshot().identity, workroomRowId: "other-row" } }),
    () => json({ ...newerSnapshot(), version: 2 }),
    () => json({ ...newerSnapshot(), graph: { stages: [] } }),
  ])("rejects non-JSON, malformed or mismatched responses", async response => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    const { result } = renderHook(() => useWorkroomProcessRefresh(saved(), target));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.issue).toBe("failed"); expect(result.current.snapshot.context.definition?.label).toBe("Reviewer recovery");
  });
  it("treats a followed login redirect as session loss", async () => {
    const response = json(newerSnapshot()); Object.defineProperty(response, "redirected", { value: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const { result } = renderHook(() => useWorkroomProcessRefresh(saved(), target));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.protectedContentHidden).toBe(true); expect(result.current.issue).toBe("sessionRequired");
  });
  it("bounds a stalled response body and aborts its one request", async () => {
    vi.useFakeTimers(); const body = deferred<string>(); let signal!: AbortSignal;
    const response = json({}); vi.spyOn(response, "text").mockReturnValue(body.promise);
    vi.stubGlobal("fetch", vi.fn((_url, options) => { signal = options.signal; return Promise.resolve(response); }));
    const { result } = renderHook(() => useWorkroomProcessRefresh(saved(), target));
    let request!: Promise<void>;
    await act(async () => { request = result.current.refresh(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PROCESS_READ_TIMEOUT_MS); await request; });
    expect(signal.aborted).toBe(true); expect(result.current.issue).toBe("timeout"); expect(result.current.pending).toBe(false);
    await act(async () => { body.resolve(JSON.stringify(newerSnapshot())); });
    expect(result.current.snapshot.context.definition?.version).toBe(1);
  });
  it.each(["resolve", "reject"] as const)("ignores an old target's late %s and keeps a new flight owned", async outcome => {
    const first = deferred<Response>(), second = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); vi.stubGlobal("fetch", fetcher);
    const other = { ...target, workroomRowId: "another-room" };
    const { result, rerender } = renderHook(({ selected }) => useWorkroomProcessRefresh(
      createWorkroomProcessSnapshot(selected, graph, saved().context, null), selected), { initialProps: { selected: target } });
    let old!: Promise<void>, current!: Promise<void>;
    act(() => { old = result.current.refresh(); });
    rerender({ selected: other }); act(() => { current = result.current.refresh(); });
    await act(async () => { if (outcome === "resolve") first.resolve(json(newerSnapshot())); else first.reject(new Error("late")); await old; });
    expect(result.current.pending).toBe(true); expect(result.current.issue).toBeNull();
    act(() => { void result.current.refresh(); }); expect(fetcher).toHaveBeenCalledTimes(2);
    const snapshot = newerSnapshot(); snapshot.identity.workroomRowId = other.workroomRowId;
    await act(async () => { second.resolve(json(snapshot)); await current; });
    expect(result.current.snapshot.identity.workroomRowId).toBe(other.workroomRowId);
  });
  it("aborts on unmount and ignores a late result", async () => {
    const read = deferred<Response>(); let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url, options) => { signal = options.signal; return read.promise; }));
    const { result, unmount } = renderHook(() => useWorkroomProcessRefresh(saved(), target));
    let request!: Promise<void>; act(() => { request = result.current.refresh(); }); unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { read.resolve(json(newerSnapshot())); await request; });
  });
  it("hides the rendered process after a denied read and presents its recovery action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    showProcess(); await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh state" })); });
    expect(screen.queryByText("Reviewer recovery · Definition v1")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to My Work" })).toHaveAttribute("href", "/workspace/my-queue");
  });
});
