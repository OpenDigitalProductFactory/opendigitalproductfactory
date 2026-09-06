import Link from "next/link";

import { CockpitShell } from "@/components/page-shells/PageShell";
import { EmptyState, Notice, StatCard, StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import type { loadRescueCockpitData } from "@/lib/animal-welfare/cockpit-loader";
import { formatInstant } from "@/lib/datetime";
import { formatMoney } from "@/lib/org-locale/org-locale";
import type {
  RescueFilter,
  RescueQueueData,
  RescueSources,
  SourceState,
} from "@/lib/animal-welfare/cockpit";

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

const QUIET_NEXT_ACTION: Record<RescueArea, { label: string; href: string; hint: string }> = {
  overview: {
    label: "Review intake",
    href: "/workspace/rescue/intake",
    hint: "Start with animals that still need an admission decision.",
  },
  animals: {
    label: "Open housing board",
    href: "/workspace/ward",
    hint: "Check where animals are housed and what space remains.",
  },
  intake: {
    label: "Open housing board",
    href: "/workspace/ward",
    hint: "Confirm safe space before the next admission.",
  },
  care: {
    label: "Review missed care",
    href: "/workspace/rescue/care?filter=missed",
    hint: "Start with care that is already past due.",
  },
  adoptions: {
    label: "Review animals without interest",
    href: "/workspace/rescue/adoptions?filter=no-interest",
    hint: "Find placement-ready animals with no active application.",
  },
  stewardship: {
    label: "Open finance",
    href: "/finance",
    hint: "Review the source records behind funds and animal costs.",
  },
};

function sourceLabel(source: SourceState<unknown>) {
  if (source.state === "unavailable") return "Unavailable";
  if (source.state === "empty") return "No records yet";
  return "Current";
}

function SourceStatus({ source, timeZone }: { source: SourceState<unknown>; timeZone: string }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusBadge
        intent={source.state === "unavailable" ? "warning" : source.state === "empty" ? "neutral" : "success"}
        label={sourceLabel(source)}
        uppercase={false}
      />
      <time dateTime={source.asOf} className="text-dpf-caption text-[var(--dpf-muted)]">
        As of {formatInstant(source.asOf, { timeZone })}
      </time>
    </span>
  );
}

function RescueNavigation({ current }: { current: RescueArea }) {
  return (
    <nav
      aria-label="Rescue operations"
      className="mb-6 grid grid-cols-3 gap-1 border-b border-[var(--dpf-border)] sm:flex"
    >
      {NAV.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? "page" : undefined}
          className={[
            "dpf-tap-target min-h-11 min-w-0 border-b-2 px-2 py-2 text-center text-sm font-medium leading-tight sm:flex-none sm:whitespace-nowrap sm:px-3",
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
      <StatCard label="Animals in care" value={animals?.inCare ?? "—"} hint={<SourceStatus source={data.sources.animals} timeZone={data.presentation.timeZone} />} href="/workspace/rescue/animals" />
      <StatCard label="Housing free" value={capacity?.free ?? "—"} hint={<SourceStatus source={data.sources.capacity} timeZone={data.presentation.timeZone} />} href="/workspace/ward" intent={capacity && capacity.free === 0 ? "warning" : undefined} />
      <StatCard label="Care due today" value={care?.dueToday ?? "—"} hint={<SourceStatus source={data.sources.care} timeZone={data.presentation.timeZone} />} href="/workspace/rescue/care" intent={care && care.missed > 0 ? "danger" : undefined} />
      <StatCard label="Active applications" value={adoptions?.activeApplications ?? "—"} hint={<SourceStatus source={data.sources.adoptions} timeZone={data.presentation.timeZone} />} href="/workspace/rescue/adoptions" />
      <StatCard label="Posted animal cost" value={stewardship ? formatMoney(stewardship.postedAnimalCost, data.presentation.currency, data.presentation.locale, { maximumFractionDigits: 2 }) : "—"} hint={<SourceStatus source={data.sources.stewardship} timeZone={data.presentation.timeZone} />} href="/workspace/rescue/stewardship" />
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
      { label: "Posted animal cost", value: sources.stewardship.data ? formatMoney(sources.stewardship.data.postedAnimalCost, data.presentation.currency, data.presentation.locale, { maximumFractionDigits: 2 }) : "—", hint: "Net posted animal-subject debit in base currency" },
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

const FILTERS: Partial<Record<RescueArea, Array<{ value: RescueFilter; label: string; href: string }>>> = {
  intake: [
    { value: "all", label: "Intake review", href: "/workspace/rescue/intake" },
    { value: "legal-hold", label: "Legal holds", href: "/workspace/rescue/intake?filter=legal-hold" },
  ],
  care: [
    { value: "all", label: "Open care", href: "/workspace/rescue/care" },
    { value: "missed", label: "Missed", href: "/workspace/rescue/care?filter=missed" },
  ],
  adoptions: [
    { value: "all", label: "Applications", href: "/workspace/rescue/adoptions" },
    { value: "no-interest", label: "No interest", href: "/workspace/rescue/adoptions?filter=no-interest" },
  ],
};

function FilterNavigation({ area, filter }: { area: RescueArea; filter: RescueFilter }) {
  const filters = FILTERS[area];
  if (!filters) return null;
  return (
    <nav aria-label={`${area} filters`} className="mb-4 flex flex-wrap gap-2">
      {filters.map((item) => (
        <Link
          key={item.value}
          href={item.href}
          aria-current={filter === item.value ? "page" : undefined}
          className={[
            "dpf-tap-target rounded-full border px-3 py-1 text-sm",
            filter === item.value
              ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]"
              : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
          ].join(" ")}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function readableStatus(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function QueuePanel({
  queue,
  timeZone,
}: {
  queue: SourceState<RescueQueueData> | null;
  timeZone: string;
}) {
  if (!queue) return null;
  if (queue.state === "unavailable") {
    return (
      <Notice variant="warn" title="Record list unavailable">
        {queue.reason}
      </Notice>
    );
  }
  return (
    <Surface as="section" className="mt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{queue.data.title}</h2>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">{queue.data.description}</p>
        </div>
        {queue.data.action ? (
          <Link className="dpf-tap-target text-sm font-medium text-[var(--dpf-accent)]" href={queue.data.action.href}>
            {queue.data.action.label}
          </Link>
        ) : null}
      </div>
      {queue.data.rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-[var(--dpf-border)] p-4 text-sm text-[var(--dpf-muted)]">
          No records match this view.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--dpf-border)] border-y border-[var(--dpf-border)]">
          {queue.data.rows.map((row) => (
            <li key={row.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--dpf-text)]">{row.primary}</p>
                <p className="truncate text-[var(--dpf-muted)]">
                  <span className="font-mono text-xs">{row.reference}</span>
                  {row.detail ? ` · ${row.detail}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--dpf-muted)] sm:justify-end">
                <span className="capitalize">{readableStatus(row.status)}</span>
                {row.occurredAt ? (
                  <time dateTime={row.occurredAt}>{formatInstant(row.occurredAt, { timeZone })}</time>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

export function RescueCockpit({
  data,
  area = "overview",
  filter = "all",
}: {
  data: RescueCockpitData;
  area?: RescueArea;
  filter?: RescueFilter;
}) {
  const unavailable = Object.entries(data.sources).filter(([, source]) => source.state === "unavailable");
  const title = area === "overview" ? "Rescue operations" : NAV.find((item) => item.key === area)?.label ?? "Rescue operations";
  const nextAction = data.attention[0]
    ? { label: `${data.attention[0].label}: ${data.attention[0].count}`, href: data.attention[0].href }
    : QUIET_NEXT_ACTION[area];
  return (
    <CockpitShell
      title={title}
      lead="Bring animals in safely, protect their daily welfare, and place them into lasting homes."
      attention={data.attention.length > 0 ? `${data.attention.reduce((sum, item) => sum + item.count, 0)} items need attention.` : undefined}
      nextAction={nextAction}
      technicalDetails={unavailable.length > 0 ? (
        <ul className="space-y-2 text-sm text-[var(--dpf-muted)]">
          {unavailable.map(([key, source]) => <li key={key}><span className="font-medium text-[var(--dpf-text)]">{key}</span>: {source.reason}</li>)}
        </ul>
      ) : undefined}
      technicalDetailsLabel="Data source status"
    >
      <RescueNavigation current={area} />
      <FilterNavigation area={area} filter={filter} />
      <AreaBody area={area} data={data} />
      <QueuePanel queue={data.queue} timeZone={data.presentation.timeZone} />
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
