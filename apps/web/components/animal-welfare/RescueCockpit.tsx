import Link from "next/link";

import { CockpitShell } from "@/components/page-shells/PageShell";
import { EmptyState, Notice, StatCard, StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import type { loadRescueCockpitData } from "@/lib/animal-welfare/cockpit-loader";
import type { RescueSources, SourceState } from "@/lib/animal-welfare/cockpit";

export type RescueCockpitData = Awaited<ReturnType<typeof loadRescueCockpitData>>;
export type RescueArea = "overview" | "animals" | "intake" | "care" | "adoptions" | "stewardship";

const NAV: ReadonlyArray<{ key: RescueArea | "capacity"; label: string; href: string }> = [
  { key: "overview", label: "Overview", href: "/workspace/rescue" },
  { key: "animals", label: "Animals", href: "/workspace/rescue/animals" },
  { key: "intake", label: "Intake", href: "/workspace/rescue/intake" },
  { key: "capacity", label: "Housing", href: "/workspace/ward" },
  { key: "care", label: "Daily care", href: "/workspace/rescue/care" },
  { key: "adoptions", label: "Adoptions", href: "/workspace/rescue/adoptions" },
  { key: "stewardship", label: "Stewardship", href: "/workspace/rescue/stewardship" },
];

function sourceLabel(source: SourceState<unknown>) {
  if (source.state === "unavailable") return "Unavailable";
  if (source.state === "empty") return "No records yet";
  return "Current";
}

function SourceStatus({ source }: { source: SourceState<unknown> }) {
  return (
    <StatusBadge
      intent={source.state === "unavailable" ? "warning" : source.state === "empty" ? "neutral" : "success"}
      label={sourceLabel(source)}
      uppercase={false}
    />
  );
}

function RescueNavigation({ current }: { current: RescueArea }) {
  return (
    <nav aria-label="Rescue operations" className="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--dpf-border)]">
      {NAV.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? "page" : undefined}
          className={[
            "dpf-tap-target whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            item.key === current
              ? "border-[var(--dpf-accent)] text-[var(--dpf-text)]"
              : "border-transparent text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
          ].join(" ")}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function MetricGrid({ data }: { data: RescueCockpitData }) {
  const animals = data.sources.animals.data;
  const capacity = data.sources.capacity.data;
  const care = data.sources.care.data;
  const adoptions = data.sources.adoptions.data;
  const stewardship = data.sources.stewardship.data;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <StatCard label="Animals in care" value={animals?.inCare ?? "—"} hint={<SourceStatus source={data.sources.animals} />} href="/workspace/rescue/animals" />
      <StatCard label="Housing free" value={capacity?.free ?? "—"} hint={<SourceStatus source={data.sources.capacity} />} href="/workspace/ward" intent={capacity && capacity.free === 0 ? "warning" : undefined} />
      <StatCard label="Care due today" value={care?.dueToday ?? "—"} hint={<SourceStatus source={data.sources.care} />} href="/workspace/rescue/care" intent={care && care.missed > 0 ? "danger" : undefined} />
      <StatCard label="Active applications" value={adoptions?.activeApplications ?? "—"} hint={<SourceStatus source={data.sources.adoptions} />} href="/workspace/rescue/adoptions" />
      <StatCard label="Posted animal cost" value={stewardship ? stewardship.postedAnimalCost.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "—"} hint={<SourceStatus source={data.sources.stewardship} />} href="/workspace/rescue/stewardship" />
    </div>
  );
}

function AreaBody({ area, data }: { area: RescueArea; data: RescueCockpitData }) {
  const { sources } = data;
  if (area === "overview") return <MetricGrid data={data} />;

  const cards: Record<Exclude<RescueArea, "overview">, Array<{ label: string; value: number | string; hint: string }>> = {
    animals: [
      { label: "In care", value: sources.animals.data?.inCare ?? "—", hint: "Open custody population" },
      { label: "Placement ready", value: sources.animals.data?.placementReady ?? "—", hint: "Ready for a placement path" },
      { label: "Legal hold", value: sources.animals.data?.legalHold ?? "—", hint: "Cannot be placed" },
    ],
    intake: [
      { label: "Intake review", value: sources.animals.data?.intakeReview ?? "—", hint: "Admission still at intake" },
      { label: "Legal hold", value: sources.animals.data?.legalHold ?? "—", hint: "Human release required" },
      { label: "Housing free", value: sources.capacity.data?.free ?? "—", hint: "Recorded kennel capacity" },
    ],
    care: [
      { label: "Due today", value: sources.care.data?.dueToday ?? "—", hint: "Open animal work due today" },
      { label: "Missed", value: sources.care.data?.missed ?? "—", hint: "Past due and incomplete" },
      { label: "Care exceptions", value: sources.care.data?.exceptions ?? "—", hint: "Records under hold" },
    ],
    adoptions: [
      { label: "Active applications", value: sources.adoptions.data?.activeApplications ?? "—", hint: "Submitted through waitlisted" },
      { label: "Ready without interest", value: sources.adoptions.data?.readyWithoutInterest ?? "—", hint: "Placement-ready with no active application" },
    ],
    stewardship: [
      { label: "Restricted funds", value: sources.stewardship.data?.restrictedFunds ?? "—", hint: "Active restricted fund records" },
      { label: "Posted animal cost", value: sources.stewardship.data ? sources.stewardship.data.postedAnimalCost.toLocaleString(undefined, { style: "currency", currency: "USD" }) : "—", hint: "Net posted animal-subject debit" },
    ],
  };
  const source = area === "animals" || area === "intake" ? sources.animals : sources[area];
  if (source.state === "unavailable") {
    return <Notice variant="warn" title="This source is unavailable">The page will not replace an unread source with zero. Try again after the source recovers.</Notice>;
  }
  if (source.state === "empty") {
    return <EmptyState title={`No ${area} records yet`} description="This is an unrecorded state, not an all-clear signal." />;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards[area].map((card) => <StatCard key={card.label} label={card.label} value={card.value} hint={card.hint} />)}
    </div>
  );
}

export function RescueCockpit({ data, area = "overview" }: { data: RescueCockpitData; area?: RescueArea }) {
  const unavailable = Object.entries(data.sources).filter(([, source]) => source.state === "unavailable");
  const title = area === "overview" ? "Rescue operations" : NAV.find((item) => item.key === area)?.label ?? "Rescue operations";
  return (
    <CockpitShell
      title={title}
      lead="Bring animals in safely, protect their daily welfare, and place them into lasting homes."
      attention={data.attention.length > 0 ? `${data.attention.reduce((sum, item) => sum + item.count, 0)} items need attention.` : undefined}
      nextAction={data.attention[0] ? { label: `${data.attention[0].label}: ${data.attention[0].count}`, href: data.attention[0].href } : undefined}
      technicalDetails={unavailable.length > 0 ? (
        <ul className="space-y-2 text-sm text-[var(--dpf-muted)]">
          {unavailable.map(([key, source]) => <li key={key}><span className="font-medium text-[var(--dpf-text)]">{key}</span>: {source.reason}</li>)}
        </ul>
      ) : undefined}
      technicalDetailsLabel="Data source status"
    >
      <RescueNavigation current={area} />
      <AreaBody area={area} data={data} />
      {area === "overview" ? (
        <Surface as="section" className="mt-5">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Three connected value streams</h2>
          <ol className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <li><span className="font-medium text-[var(--dpf-text)]">1. Intake and protect</span><p className="mt-1 text-[var(--dpf-muted)]">Admission, identity, legal hold, and safe housing.</p></li>
            <li><span className="font-medium text-[var(--dpf-text)]">2. Maintain health and welfare</span><p className="mt-1 text-[var(--dpf-muted)]">Daily rounds, medical facts, behavior, and exceptions.</p></li>
            <li><span className="font-medium text-[var(--dpf-text)]">3. Place and support</span><p className="mt-1 text-[var(--dpf-muted)]">Applications, placement, returns, and stewardship.</p></li>
          </ol>
        </Surface>
      ) : null}
    </CockpitShell>
  );
}
