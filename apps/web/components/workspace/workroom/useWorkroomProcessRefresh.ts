"use client";

import { useEffect, useRef, useState } from "react";
import { parseWorkroomProcessSnapshot, PROCESS_READ_TIMEOUT_MS, PROCESS_RESPONSE_MAX_CHARS, processTargetIdentity, processTargetKey, type WorkroomProcessSnapshot, type WorkroomRefreshTarget } from "@/lib/work-management/workroom-process-snapshot";

export type ProcessRefreshIssue = "failed" | "timeout" | "changed" | "sessionRequired" | "unavailable";
class ReadFailure extends Error { constructor(readonly issue: ProcessRefreshIssue) { super(issue); } }
type Flight = { controller: AbortController; key: string; timer?: ReturnType<typeof setTimeout> };
function observationTime(snapshot: WorkroomProcessSnapshot) {
  const value = Date.parse(snapshot.graph.process?.readAt ?? "");
  return Number.isFinite(value) ? value : -Infinity;
}
/** One manual read owns the complete companion snapshot; no events dispatch reads. */
export function useWorkroomProcessRefresh(initial: WorkroomProcessSnapshot, target?: WorkroomRefreshTarget) {
  const key = target ? processTargetKey(target) : "";
  const [state, setState] = useState({ key, snapshot: initial, pending: false, issue: null as ProcessRefreshIssue | null });
  const flight = useRef<Flight | null>(null);
  const mounted = useRef(false);
  const currentKey = useRef(key); currentKey.current = key;
  const initialSnapshot = useRef(initial); initialSnapshot.current = initial;
  useEffect(() => {
    mounted.current = true;
    setState(previous => previous.key === key ? previous : { key, snapshot: initialSnapshot.current, pending: false, issue: null });
    return () => { mounted.current = false; const active = flight.current; if (active) { active.controller.abort(); clearTimeout(active.timer); flight.current = null; } };
    // Target identity, rather than a parent's object allocation, owns cancellation.
  }, [key]);
  useEffect(() => {
    setState(previous => previous.key === key && observationTime(initial) > observationTime(previous.snapshot)
      ? { ...previous, snapshot: initial } : previous);
  }, [initial, key]);
  async function refresh() {
    if (!target || !key || flight.current?.key === key) return;
    if (flight.current) { flight.current.controller.abort(); clearTimeout(flight.current.timer); }
    const active: Flight = { key, controller: new AbortController() };
    flight.current = active;
    const owns = () => mounted.current && currentKey.current === key && flight.current === active;
    setState(previous => ({ key, snapshot: previous.key === key ? previous.snapshot : initial, pending: true, issue: null }));
    try {
      const identity = processTargetIdentity(target);
      const query = new URLSearchParams();
      if (identity.workroomRowId !== null) query.set("workroomRowId", identity.workroomRowId);
      if (identity.workroom) query.set("workroom", identity.workroom);
      const suffix = query.toString();
      const read = async () => {
        const response = await fetch(`/api/workspace/cases/${identity.caseKey}/projection${suffix ? `?${suffix}` : ""}`, { credentials: "same-origin", cache: "no-store", redirect: "manual", headers: { Accept: "application/json" }, signal: active.controller.signal });
        if (response.status === 401 || (response.status >= 300 && response.status < 400) || response.redirected || response.type === "opaqueredirect") throw new ReadFailure("sessionRequired");
        if (response.status === 404) throw new ReadFailure("unavailable");
        if (response.status === 409) throw new ReadFailure("changed");
        if (!response.ok || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new ReadFailure("failed");
        const body = await response.text();
        if (body.length > PROCESS_RESPONSE_MAX_CHARS) throw new ReadFailure("failed");
        const snapshot = parseWorkroomProcessSnapshot(JSON.parse(body), target);
        if (!snapshot) throw new ReadFailure("failed");
        return snapshot;
      };
      const timeout = new Promise<never>((_resolve, reject) => { active.timer = setTimeout(() => { active.controller.abort(); reject(new ReadFailure("timeout")); }, PROCESS_READ_TIMEOUT_MS); });
      const snapshot = await Promise.race([read(), timeout]);
      if (owns()) setState(previous => ({ key,
        snapshot: observationTime(snapshot) >= observationTime(previous.snapshot) ? snapshot : previous.snapshot,
        pending: false, issue: null }));
    } catch (error) {
      if (owns()) setState(previous => ({ ...previous, pending: false, issue: error instanceof ReadFailure ? error.issue : "failed" }));
    } finally {
      clearTimeout(active.timer);
      if (flight.current === active) flight.current = null;
    }
  }
  const visible = state.key === key ? state : { key, snapshot: initial, pending: false, issue: null };
  return { ...visible, refresh, protectedContentHidden: visible.issue === "sessionRequired" || visible.issue === "unavailable" };
}
