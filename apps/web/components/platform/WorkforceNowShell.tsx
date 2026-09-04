"use client";

// Live shell for the AI workforce "Right Now" view (BI-1A68257F). Polls the
// workforce-activity snapshot and renders the coworker board: working now (with
// today's outcome digest), quiet (inactivity as a signal), the human owner of
// each coworker, and manage jump-offs. Sensitive-data activity is a colour-coded
// aggregate flag only — the digest is counts, never record content, and offers
// no drill-in, so a non-HR platform admin sees the shape without the detail.

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { Surface } from "@/components/ui/Surface";
import type {
  WorkforceActivity,
  WorkforceCoworker,
  WorkforcePlatformRun,
} from "@/lib/platform-runtime/workforce-activity";

const REFRESH_INTERVAL_MS = 12_000;

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
function fmtCost(n: number): string {
  if (n <= 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
function runningFor(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just started";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}
function daysSince(iso: string | null): string {
  if (!iso) return "never engaged";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "acted today";
  if (days === 1) return "quiet 1d";
  return `quiet ${days}d`;
}

export function WorkforceNowShell({ initialData }: { initialData: WorkforceActivity }) {
  const [data, setData] = useState(initialData);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openManage, setOpenManage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshNow = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRefreshing(true);
    try {
      const res = await fetch("/api/platform/workforce-activity", {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
      setData((await res.json()) as WorkforceActivity);
      setLastUpdatedAt(Date.now());
      setError(null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Refresh failed");
      }
    } finally {
      if (abortRef.current === controller) {
        setRefreshing(false);
        abortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) void refreshNow();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshNow]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const { pulse } = data;
  const ageLabel =
    lastUpdatedAt === null
      ? "page-load snapshot"
      : `updated ${Math.max(0, Math.round((Date.now() - lastUpdatedAt) / 1000))}s ago`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-xs text-[var(--dpf-muted)]">
        <span aria-live="polite">
          {refreshing ? "Refreshing…" : `Live · ${ageLabel} · auto-refresh every ${REFRESH_INTERVAL_MS / 1000}s`}
          {error ? <span className="ml-2 text-[var(--dpf-error)]">Last refresh failed: {error}</span> : null}
        </span>
        <button
          type="button"
          onClick={() => void refreshNow()}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-2 py-1 font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] disabled:opacity-50"
        >
          {refreshing ? (
            <Spinner size="xs" tone="current" presentational />
          ) : (
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          )}
          Refresh now
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Working now" value={`${pulse.workingCount} / ${pulse.totalCount}`} />
        <Kpi label="Actions today" value={String(pulse.actionsToday)} />
        <Kpi
          label="Tokens today"
          value={fmtTokens(pulse.tokensToday)}
          sub={
            pulse.tokensUnattributed > 0
              ? `~${fmtCost(pulse.costToday)} · ${fmtTokens(pulse.tokensUnattributed)} unattributed`
              : `~${fmtCost(pulse.costToday)}`
          }
          flag={pulse.tokensUnattributed > 0}
        />
        <Kpi
          label="Governance"
          value={`${pulse.quietOverThresholdCount + pulse.coworkersWithoutOwnerCount}`}
          sub={`${pulse.quietOverThresholdCount} quiet · ${pulse.coworkersWithoutOwnerCount} no owner`}
          flag={pulse.quietOverThresholdCount + pulse.coworkersWithoutOwnerCount > 0}
        />
      </div>

      <SectionHead title="Working now" hint="what they're on · what they got done today" />
      {data.working.length === 0 ? (
        <Empty>
          {data.platformWork.length > 0
            ? "No coworker owns a live task right now — the platform work below is what is running."
            : "No coworkers are actively working right now."}
        </Empty>
      ) : (
        <ul className="space-y-2">
          {data.working.map((c) => (
            <CoworkerRow key={c.agentId} c={c} openManage={openManage} setOpenManage={setOpenManage} />
          ))}
        </ul>
      )}

      {data.platformWork.length > 0 ? (
        <>
          <SectionHead
            title="Platform work in flight"
            hint="live runs no coworker owns — this is what is on the model runner"
          />
          <ul className="space-y-1.5">
            {data.platformWork.map((run) => (
              <PlatformRunRow key={run.taskRunId} run={run} />
            ))}
          </ul>
        </>
      ) : null}

      <SectionHead title="Quiet — no activity is also a signal" hint="expected, or a gap worth a look?" />
      {data.quiet.length === 0 ? (
        <Empty>Every coworker is active.</Empty>
      ) : (
        <ul className="space-y-2">
          {data.quiet.map((c) => (
            <CoworkerRow key={c.agentId} c={c} quiet openManage={openManage} setOpenManage={setOpenManage} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, flag }: { label: string; value: string; sub?: string; flag?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
      <div className="text-dpf-caption font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">{label}</div>
      <div
        className="mt-0.5 text-xl font-bold tabular-nums"
        style={{ color: flag ? "var(--dpf-warning)" : "var(--dpf-text)" }}
      >
        {value}
        {flag ? " ⚠" : ""}
      </div>
      {sub ? <div className="text-dpf-caption text-[var(--dpf-muted)] tabular-nums">{sub}</div> : null}
    </div>
  );
}

function SectionHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mt-4 flex items-baseline justify-between px-1">
      <h2 className="text-dpf-caption font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">{title}</h2>
      <span className="text-dpf-caption text-[var(--dpf-muted)]">{hint}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--dpf-border)] p-3 text-center text-xs text-[var(--dpf-muted)]">
      {children}
    </div>
  );
}

const MANAGE_LINKS = (agentId: string) => [
  { label: "Settings", href: `/platform/identity/agents?agent=${encodeURIComponent(agentId)}` },
  { label: "Priority & models", href: "/platform/ai/assignments" },
  { label: "Skills & grants", href: "/platform/ai/skills" },
  { label: "Schedule", href: "/platform/schedule" },
];

function CoworkerRow({
  c,
  quiet,
  openManage,
  setOpenManage,
}: {
  c: WorkforceCoworker;
  quiet?: boolean;
  openManage: string | null;
  setOpenManage: (id: string | null) => void;
}) {
  const isOpen = openManage === c.agentId;
  return (
    <li
      className="rounded-lg border p-3"
      style={{
        borderColor: quiet ? "var(--dpf-border)" : "var(--dpf-border)",
        background: quiet ? "transparent" : "var(--dpf-surface-1)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold"
          style={{
            background: quiet ? "var(--dpf-surface-2)" : "var(--dpf-state-info)",
            color: quiet ? "var(--dpf-muted)" : "var(--dpf-accent)",
          }}
        >
          {initials(c.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: quiet ? "var(--dpf-muted)" : "var(--dpf-success)" }}
            />
            <span className="truncate">{c.name}</span>
            {c.role ? <span className="text-dpf-caption font-normal text-[var(--dpf-muted)]">· {c.role}</span> : null}
            {c.handlesSensitive ? (
              <span
                className="rounded px-1.5 py-0.5 text-dpf-caption font-bold uppercase tracking-wide"
                style={{ background: "var(--dpf-state-warning)", color: "var(--dpf-warning)" }}
                title="Handled sensitive data today — details are access-gated"
              >
                🔒 sensitive
              </span>
            ) : null}
          </div>

          {c.now ? (
            <div className="mt-1 text-dpf-body text-[var(--dpf-muted)]">
              <span className="text-[var(--dpf-muted)]">Now → </span>
              {c.now.title}
              <span className="ml-2 rounded border border-[var(--dpf-border)] px-1.5 py-0.5 font-mono text-dpf-caption uppercase text-[var(--dpf-muted)]">
                {c.now.status}
              </span>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2 text-dpf-body">
              <span className="font-mono text-dpf-caption text-[var(--dpf-muted)]">{daysSince(c.lastActedAt)}</span>
              {c.didToday.length === 0 ? (
                <span className="text-[var(--dpf-muted)]">— no actions today</span>
              ) : null}
            </div>
          )}

          {c.didToday.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-dpf-caption uppercase tracking-wide text-[var(--dpf-muted)]">Today</span>
              {c.didToday.map((o, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs"
                  style={
                    o.sensitive
                      ? {
                          borderColor: "var(--dpf-warning)",
                          background: "var(--dpf-state-warning)",
                          color: "var(--dpf-warning)",
                        }
                      : { borderColor: "var(--dpf-border)", background: "var(--dpf-surface-2)", color: "var(--dpf-text)" }
                  }
                >
                  {o.sensitive ? <span aria-hidden>🔒</span> : null}
                  <b className="font-mono">{o.count}</b> {o.label}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-dpf-caption text-[var(--dpf-muted)]">
            {c.now ? (
              <span className="tabular-nums">
                <b className="text-[var(--dpf-text)]">{fmtTokens(c.tokensToday)}</b> tokens today · {fmtCost(c.costToday)}
              </span>
            ) : null}
            <span>
              {c.humanSupervisorId ? (
                <>Managed by {c.humanSupervisorId} · HITL tier {c.hitlTier}</>
              ) : (
                <span style={{ color: "var(--dpf-warning)" }}>⚠ No human owner</span>
              )}
            </span>
          </div>

          {isOpen ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {MANAGE_LINKS(c.agentId).map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  className="rounded-md border border-[var(--dpf-border)] px-2 py-1 text-dpf-caption text-[var(--dpf-accent)] hover:border-[var(--dpf-accent)]"
                >
                  {l.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setOpenManage(isOpen ? null : c.agentId)}
          aria-expanded={isOpen}
          className="shrink-0 rounded-md border border-[var(--dpf-border)] px-2 py-1 text-dpf-caption text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)]"
        >
          Manage {isOpen ? "▲" : "▾"}
        </button>
      </div>
    </li>
  );
}

function PlatformRunRow({ run }: { run: WorkforcePlatformRun }) {
  const target = run.buildId ? `/build?buildId=${encodeURIComponent(run.buildId)}` : null;
  return (
    <Surface as="li" level={1} padding="none" rounded="lg" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-dpf-body">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--dpf-warning)" }} />
      <span className="font-semibold text-[var(--dpf-text)]">{run.title}</span>
      <span className="rounded border border-[var(--dpf-border)] px-1.5 py-0.5 font-mono text-dpf-caption uppercase text-[var(--dpf-muted)]">
        {run.status}
      </span>
      {run.source ? (
        <span className="text-dpf-caption text-[var(--dpf-muted)]">source: {run.source}</span>
      ) : null}
      {run.buildId ? (
        target ? (
          <a className="text-dpf-caption text-[var(--dpf-accent)] underline" href={target}>
            {run.buildId}
          </a>
        ) : (
          <span className="text-dpf-caption text-[var(--dpf-muted)]">{run.buildId}</span>
        )
      ) : null}
      <span className="ml-auto font-mono text-dpf-caption text-[var(--dpf-muted)]" title={`started ${run.startedAt}`}>
        running {runningFor(run.startedAt)}
      </span>
    </Surface>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
