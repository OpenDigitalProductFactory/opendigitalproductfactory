"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArchiveRestore,
  Boxes,
  Check,
  CircleAlert,
  Database,
  FolderGit2,
  Power,
  ShieldCheck,
} from "lucide-react";

import {
  executeInstallationTeardown,
  previewInstallationTeardown,
} from "@/lib/actions/teardown";
import type { TeardownEvidenceSummary } from "@/lib/teardown/preview";
import type { TeardownScope } from "@/lib/teardown/contract";
import { Spinner } from "@/components/ui/Spinner";
import { Surface } from "@/components/ui/Surface";

const SCOPES: Array<{
  id: TeardownScope;
  title: string;
  description: string;
  tone: string;
  icon: typeof Power;
}> = [
  { id: "containers", title: "Stop services", description: "Pause DPF. Keep data, source, settings, and recovery files.", tone: "Reversible", icon: Power },
  { id: "volumes", title: "Reset data", description: "Stop services and remove install-owned data volumes. Keep source.", tone: "Fresh onboarding", icon: Database },
  { id: "source", title: "Remove source", description: "Stop services and remove the install tree. Keep database volumes.", tone: "Source recovery", icon: FolderGit2 },
  { id: "everything", title: "Remove installation", description: "Remove services, install-owned volumes, and source. Keep recovery evidence.", tone: "Full teardown", icon: Boxes },
];

type PreviewTeardownResult = Awaited<ReturnType<typeof previewInstallationTeardown>>;
type ExecuteTeardownResult = Awaited<ReturnType<typeof executeInstallationTeardown>>;

function retained(scope: TeardownScope, asset: "runtime" | "data" | "source"): boolean {
  if (asset === "runtime") return false;
  if (asset === "data") return scope === "containers" || scope === "source";
  return scope === "containers" || scope === "volumes";
}

function StatusPill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-dpf-caption font-semibold ${ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>
      {ok ? <Check className="h-3 w-3" aria-hidden="true" /> : <CircleAlert className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function TeardownControl({ initialEvidence }: { initialEvidence: TeardownEvidenceSummary[] }) {
  const [scope, setScope] = useState<TeardownScope>("containers");
  const [previewResult, setPreviewResult] = useState<PreviewTeardownResult | null>(null);
  const [execution, setExecution] = useState<ExecuteTeardownResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = SCOPES.find((item) => item.id === scope) ?? SCOPES[0];
  const preview = previewResult?.ok ? previewResult.data.preview : null;
  const destructive = scope !== "containers";
  const canDispatch = Boolean(previewResult?.ok && preview && preview.blockers.length === 0 && (!preview.salvageRequired || preview.sourceEvidenceSafe));

  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  const clearPreview = (next: TeardownScope) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setScope(next);
    setPreviewResult(null);
    setExecution(null);
    setHolding(false);
  };

  const review = () => startTransition(async () => {
    setExecution(null);
    setPreviewResult(await previewInstallationTeardown(scope));
  });

  const dispatch = () => {
    if (!previewResult?.ok || !canDispatch) return;
    startTransition(async () => setExecution(await executeInstallationTeardown(previewResult.data.challenge)));
  };

  const startHold = () => {
    if (!previewResult?.ok || !canDispatch || isPending) return;
    if (!destructive) { dispatch(); return; }
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      setHolding(false);
      dispatch();
    }, previewResult.data.holdMs);
  };

  const cancelHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHolding(false);
  };

  return (
    <div className="space-y-6">
      <Surface as="section" padding="none" rounded="xl" className="overflow-hidden rounded-2xl shadow-sm">
        <div className="border-b border-[var(--dpf-border)] bg-gradient-to-br from-sky-500/[0.08] via-transparent to-emerald-500/[0.07] px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-2.5 text-sky-700 dark:text-sky-300">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--dpf-text)]">Choose the boundary</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--dpf-muted)]">
                Teardown is staged. Nothing outside the DPF install project is selected, and recovery evidence is never part of the deletion set.
              </p>
            </div>
          </div>
        </div>

        <fieldset className="grid gap-3 p-4 sm:grid-cols-2 sm:p-6">
          <legend className="sr-only">Teardown scope</legend>
          {SCOPES.map((item) => {
            const Icon = item.icon;
            const active = item.id === scope;
            return (
              <label key={item.id} className={`group relative cursor-pointer rounded-xl border p-4 transition ${active ? "border-sky-500 bg-sky-500/[0.07] ring-1 ring-sky-500/30" : "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] hover:border-sky-500/40"}`}>
                <input className="sr-only" type="radio" name="teardown-scope" value={item.id} checked={active} onChange={() => clearPreview(item.id)} />
                <div className="flex items-start gap-3">
                  <Icon className={`mt-0.5 h-5 w-5 ${active ? "text-sky-600 dark:text-sky-300" : "text-[var(--dpf-muted)]"}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--dpf-text)]">{item.title}</span>
                      <span className="rounded-full bg-[var(--dpf-surface-3)] px-2 py-0.5 text-dpf-caption font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">{item.tone}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{item.description}</p>
                  </div>
                </div>
              </label>
            );
          })}
        </fieldset>
      </Surface>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,.85fr)]">
        <Surface as="section" padding="none" rounded="xl" className="rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-dpf-caption font-semibold uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">Selected outcome</p>
              <h3 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">{selected.title}</h3>
            </div>
            <StatusPill ok={!destructive}>{destructive ? "Destructive" : "Data preserved"}</StatusPill>
          </div>

          <div className="mt-5 divide-y divide-[var(--dpf-border)] rounded-xl border border-[var(--dpf-border)]">
            {([
              ["runtime", "Running services", "Containers and project network"],
              ["data", "Data volumes", "PostgreSQL and install-owned state"],
              ["source", "Source tree", "Install files and local Git state"],
            ] as const).map(([asset, label, detail]) => {
              const keep = retained(scope, asset);
              return (
                <div key={asset} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div><p className="text-sm font-medium text-[var(--dpf-text)]">{label}</p><p className="text-xs text-[var(--dpf-muted)]">{detail}</p></div>
                  <span className={`text-xs font-semibold ${keep ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>{keep ? "Retained" : asset === "runtime" ? "Stopped" : "Removed"}</span>
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-4 bg-emerald-500/[0.04] px-4 py-3">
              <div className="flex items-start gap-2"><ArchiveRestore className="mt-0.5 h-4 w-4 text-emerald-600" aria-hidden="true" /><div><p className="text-sm font-medium text-[var(--dpf-text)]">Recovery archive</p><p className="text-xs text-[var(--dpf-muted)]">Verified dump, salvage bundle, and terminal journal</p></div></div>
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Always retained</span>
            </div>
          </div>

          {!preview ? (
            <button type="button" data-dpf-primary-action onClick={review} disabled={isPending} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] shadow-sm transition hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60">
              {isPending ? <Spinner size="sm" tone="current" presentational /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
              Review safety gates
            </button>
          ) : (
            <div className="mt-5 space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-[var(--dpf-border)] p-3"><p className="text-xs font-medium text-[var(--dpf-text)]">Source salvage</p><StatusPill ok={!preview.salvage.atRisk || !preview.salvageRequired}>{preview.salvageRequired ? `${preview.salvage.unreachableCommits ?? 0} local commits · ${preview.salvage.dirtyPaths ?? 0} dirty` : "Not required"}</StatusPill></div>
                <div className="rounded-lg border border-[var(--dpf-border)] p-3"><p className="text-xs font-medium text-[var(--dpf-text)]">Recovery point</p><StatusPill ok>{preview.recoveryRequired ? "Created at dispatch" : "Not required"}</StatusPill></div>
                <div className="rounded-lg border border-[var(--dpf-border)] p-3"><p className="text-xs font-medium text-[var(--dpf-text)]">In-flight work</p><StatusPill ok={preview.blockers.length === 0}>{preview.blockers.length === 0 ? "Clear" : `${preview.blockers.length} blocking`}</StatusPill></div>
              </div>
              {preview.salvageRequired && !preview.sourceEvidenceSafe ? <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/[0.08] p-3 text-sm text-rose-800 dark:text-rose-200">Source removal is blocked: the evidence path is inside the install tree.</p> : null}
              <button
                type="button"
                disabled={!canDispatch || isPending}
                onPointerDown={startHold}
                onPointerUp={cancelHold}
                onPointerLeave={cancelHold}
                onPointerCancel={cancelHold}
                onKeyDown={(event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); startHold(); } }}
                onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); cancelHold(); } }}
                className={`relative mt-1 flex min-h-12 w-full overflow-hidden rounded-xl border px-4 py-3 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${destructive ? "border-rose-500/40 bg-rose-600 text-[var(--dpf-on-accent,var(--dpf-surface-1))] hover:bg-rose-700" : "border-sky-500/30 bg-sky-600 text-[var(--dpf-on-accent,var(--dpf-surface-1))] hover:bg-sky-700"}`}
              >
                {holding ? <span aria-hidden="true" className="animate-dpf-teardown-hold absolute inset-y-0 left-0 bg-white/20 motion-reduce:animate-none" style={{ animationDuration: `${previewResult?.ok ? previewResult.data.holdMs : 2000}ms` }} /> : null}
                <span className="relative flex w-full items-center justify-between gap-3"><span>{isPending ? "Preparing verified handoff…" : destructive ? `Press and hold to ${selected.title.toLowerCase()}` : "Stop services now"}</span><span className="text-xs font-normal opacity-80">{destructive ? "Release to cancel" : "No data deletion"}</span></span>
              </button>
            </div>
          )}
          {!previewResult?.ok && previewResult ? <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{previewResult.error}</p> : null}
          {execution ? <div role="status" className={`mt-3 rounded-lg border p-3 text-sm ${execution.ok ? "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-800 dark:text-emerald-200" : "border-rose-500/30 bg-rose-500/[0.07] text-rose-800 dark:text-rose-200"}`}>{execution.ok ? <>Host handoff accepted as <strong>{execution.data.runId}</strong>. The portal will disconnect by design. Evidence: <span className="break-all font-mono text-xs">{execution.data.evidencePath}</span></> : execution.error}</div> : null}
        </Surface>

        <Surface as="aside" padding="none" rounded="xl" className="rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Why this is safe to leave running</h3>
          <ol className="mt-4 space-y-4">
            {["Inspect local Git risk", "Create and restore-test recovery", "Drain in-flight platform work", "Hand off to a surviving host runner", "Write evidence outside Postgres"].map((step, index) => <li key={step} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-xs font-bold text-sky-700 dark:text-sky-300">{index + 1}</span><span className="pt-0.5 text-sm text-[var(--dpf-muted)]">{step}</span></li>)}
          </ol>
          <p className="mt-5 rounded-lg bg-[var(--dpf-surface-2)] p-3 text-xs leading-5 text-[var(--dpf-muted)]">Destructive scopes use <strong className="text-[var(--dpf-text)]">Press and hold</strong>. Release to cancel. There is no confirmation phrase for an agent to type.</p>
        </Surface>
      </div>

      <Surface as="section" padding="none" rounded="xl" className="rounded-2xl p-5 sm:p-6">
        <div className="flex items-center gap-2"><ArchiveRestore className="h-4 w-4 text-[var(--dpf-muted)]" aria-hidden="true" /><h2 className="text-sm font-semibold text-[var(--dpf-text)]">Prior teardown evidence</h2></div>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">Recovered from external evidence, even when an earlier run removed its database.</p>
        {initialEvidence.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-[var(--dpf-border)] p-4 text-sm text-[var(--dpf-muted)]">No prior teardown evidence on this host.</p> : <div className="mt-4 divide-y divide-[var(--dpf-border)]">{initialEvidence.map((row) => <div key={row.runId} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-mono text-xs font-semibold text-[var(--dpf-text)]">{row.runId}</p><p className="text-xs text-[var(--dpf-muted)]">{row.scope} · {row.stage}</p></div><StatusPill ok={row.status === "completed"}>{row.status}</StatusPill></div>)}</div>}
      </Surface>
    </div>
  );
}
