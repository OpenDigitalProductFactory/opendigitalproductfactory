import type {
  PairedEstatePostureView,
  PostureInstallView,
} from "@/lib/federation/operational-posture-read-model";
import { Surface } from "@/components/ui/Surface";
import { StatusBadge, type Intent } from "@/components/ui/report-kit";

const HEALTH_BADGE: Record<PostureInstallView["health"]["status"], { intent: Intent; label: string }> = {
  healthy: { intent: "success", label: "Healthy" },
  degraded: { intent: "warning", label: "Degraded" },
  offline: { intent: "danger", label: "Offline" },
};

const FRESHNESS_BADGE: Record<PostureInstallView["freshness"], { intent: Intent; label: string }> = {
  fresh: { intent: "info", label: "Current" },
  stale: { intent: "warning", label: "Stale" },
  silent: { intent: "danger", label: "Silent" },
};

function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <p className="text-dpf-caption uppercase tracking-wide text-[var(--dpf-muted)]">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}

function InstallCard({ install }: { install: PostureInstallView }) {
  const health = HEALTH_BADGE[install.health.status];
  const freshness = FRESHNESS_BADGE[install.freshness];
  const patch = install.patchPosture;
  return (
    <Surface as="li" padding="sm" data-posture-basis={install.basis} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{install.label}</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">{install.basisLine}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {install.basis === "mirrored-report" ? (
            <StatusBadge intent={freshness.intent} label={freshness.label} variant="soft" />
          ) : null}
          <StatusBadge intent={health.intent} label={health.label} variant="soft" />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Version" value={install.servedVersion} />
        <Figure label="Build" value={install.servedSha.slice(0, 12)} />
        <Figure label="Runtimes serving" value={`${install.runtime.healthyCount} of ${install.runtime.targetCount}`} />
        <Figure label="Estate items" value={install.health.estateItemCount} />
      </dl>
      <p className="text-xs text-[var(--dpf-muted)]">
        Open patch findings:{" "}
        <span className="text-[var(--dpf-text)]">{patch.critical} critical</span>
        {" · "}{patch.high} high{" · "}{patch.medium} medium{" · "}{patch.low} low
        {install.resourceFootprint?.cpuCores !== undefined ? ` · ${install.resourceFootprint.cpuCores} cores` : ""}
        {install.resourceFootprint?.memoryMb !== undefined ? ` · ${Math.round(install.resourceFootprint.memoryMb / 1024)} GB memory` : ""}
      </p>
    </Surface>
  );
}

/**
 * BI-648F01A0 Slice 3 — the paired estate in one picture: this installation's
 * posture captured live, beside what each same-organization peer last reported.
 * Every card says where its numbers came from and how old they are; a peer that
 * has gone quiet is shown as silent rather than as its last self-assessment.
 */
export function PairedEstatePosturePanel({ view }: { view: PairedEstatePostureView }) {
  return (
    <Surface as="section" level={2} rounded="xl" aria-labelledby="paired-estate-heading">
      <h2 id="paired-estate-heading" className="text-base font-semibold text-[var(--dpf-text)]">
        Operational posture across your installations
      </h2>
      <p className="mt-1 max-w-3xl text-xs text-[var(--dpf-muted)]">
        What each connected installation last reported about itself. Only counts travel; the detail stays where it was found.
      </p>
      <ul className="mt-3 space-y-2">
        <InstallCard install={view.local} />
        {view.peers.map((peer) => <InstallCard key={peer.key} install={peer} />)}
      </ul>
      {view.awaiting.length > 0 ? (
        <p className="mt-3 text-xs text-[var(--dpf-muted)]">
          Waiting for a first report from {view.awaiting.map((entry) => entry.label).join(", ")}.
        </p>
      ) : null}
      {view.peers.length === 0 && view.awaiting.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--dpf-muted)]">
          No other installation in your organization is connected yet.
        </p>
      ) : null}
    </Surface>
  );
}
