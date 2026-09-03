// apps/web/app/(shell)/storefront/animals/waiting/page.tsx
//
// The adoption waiting list (BI-899D7F00). The owner asked five times for one
// page listing the animals already listed for adoption, longest wait first, with
// the days each has waited, to pick animals for the newsletter. Staff-only: the
// storefront (shell) layout already gates on view_storefront. Read-only over
// AdoptableAnimal.publishedAt; the ordering rules live in
// lib/storefront/adoption-waiting-list.ts and are unit-tested there.
//
// The whole list is on this one page — no page two, no filters. The detail
// shell's UX budget caps what is open on arrival, so rows past the first
// twenty-five sit inside a disclosure on the same page, one click away, still
// in order. The cap of one hundred is the owner's decision and is stated at the
// bottom whenever it bites.

import Link from "next/link";
import { prisma } from "@dpf/db";
import { buildWaitingList, type WaitingListRow } from "@/lib/storefront/adoption-waiting-list";

export const dynamic = "force-dynamic";

/** Rows open on arrival; the rest stay on the page behind one disclosure. */
const OPEN_ROWS = 25;

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function speciesLabel(species: string | null): string {
  if (!species) return "Not set";
  return species.charAt(0).toUpperCase() + species.slice(1);
}

function listedOnCell(row: WaitingListRow): string {
  if (row.dateState === "future") return "Date is in the future";
  if (row.dateState === "missing") return "No date";
  return dateFormat.format(row.listedOn!);
}

function daysCell(row: WaitingListRow): string {
  return row.daysWaiting === null ? "—" : String(row.daysWaiting);
}

function Row({ row }: { row: WaitingListRow }) {
  const flagged = row.dateState !== "known";
  return (
    <tr className="border-t border-[var(--dpf-border)]">
      <td className="px-3 py-2 font-medium text-[var(--dpf-text)]">{row.name}</td>
      <td className="px-3 py-2 text-[var(--dpf-text)]">{speciesLabel(row.species)}</td>
      <td className="px-3 py-2 text-[var(--dpf-muted)]">{row.breed ?? "—"}</td>
      <td className={`px-3 py-2 ${flagged ? "text-[var(--dpf-warning)]" : "text-[var(--dpf-text)]"}`}>{listedOnCell(row)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-[var(--dpf-text)]">{daysCell(row)}</td>
    </tr>
  );
}

function Table({ rows, label }: { rows: WaitingListRow[]; label: string }) {
  return (
    <table className="w-full text-sm" aria-label={label}>
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
          <th scope="col" className="px-3 py-2">Name</th>
          <th scope="col" className="px-3 py-2">Species</th>
          <th scope="col" className="px-3 py-2">Breed</th>
          <th scope="col" className="px-3 py-2">Listed on</th>
          <th scope="col" className="px-3 py-2 text-right">Days waiting</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => <Row key={row.id} row={row} />)}
      </tbody>
    </table>
  );
}

export default async function AdoptionWaitingListPage() {
  const config = await prisma.storefrontConfig.findFirst({ select: { id: true } });

  if (!config) {
    return (
      <div className="space-y-3">
        <header className="space-y-2" data-dpf-lead>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Adoption waiting list</h1>
          <p className="max-w-3xl text-sm leading-5 text-[var(--dpf-muted)]">
            There is no storefront yet. Set one up first. Then list your animals.
          </p>
          <Link
            href="/storefront/setup"
            data-dpf-primary-action
            data-owner-first-next-action="set-up-storefront"
            className="inline-flex text-sm font-semibold text-[var(--dpf-accent)] underline-offset-2 hover:underline"
          >
            Set up the storefront
          </Link>
        </header>
      </div>
    );
  }

  const animals = await prisma.adoptableAnimal.findMany({
    where: { storefrontId: config.id },
    select: { id: true, name: true, species: true, breed: true, status: true, publishedAt: true },
  });
  const list = buildWaitingList(animals, new Date());
  const open = list.rows.slice(0, OPEN_ROWS);
  const rest = list.rows.slice(OPEN_ROWS);
  const flagged = list.rows.filter((r) => r.dateState !== "known").length;

  return (
    <div className="space-y-5">
      <header className="space-y-2" data-dpf-lead>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Adoption waiting list</h1>
        <p className="max-w-3xl text-sm leading-5 text-[var(--dpf-muted)]">
          Every animal listed for adoption. Longest wait first. Use it to pick who goes in the newsletter.
        </p>
        <a
          href="#waiting-list"
          data-dpf-primary-action
          data-owner-first-next-action="open-waiting-list"
          className="inline-flex text-sm font-semibold text-[var(--dpf-accent)] underline-offset-2 hover:underline"
        >
          Open the list
        </a>
      </header>

      <section id="waiting-list" className="space-y-3">
        {list.rows.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">
            No animals are listed right now. Add one on the{" "}
            <Link href="/storefront/animals" className="text-[var(--dpf-accent)] underline-offset-2 hover:underline">
              Animals
            </Link>{" "}
            page and it shows here.
          </p>
        ) : (
          <>
            <p className="text-sm text-[var(--dpf-muted)]">
              {list.rows.length} listed. Days count from the listing date.
            </p>
            <div className="overflow-x-auto rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface)]">
              <Table rows={open} label="Animals waiting longest" />
            </div>
            {rest.length > 0 && (
              <details className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface)]">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--dpf-text)]">
                  Show the other {rest.length} animals
                </summary>
                <div className="overflow-x-auto">
                  <Table rows={rest} label="Rest of the waiting list" />
                </div>
              </details>
            )}
            {flagged > 0 && (
              <p className="text-sm text-[var(--dpf-muted)]">
                {flagged} listed with a missing or future date. They sit at the end with no day count. Fix the date on the Animals page.
              </p>
            )}
            {list.capped && (
              <p className="text-sm text-[var(--dpf-muted)]">
                Showing the {list.cap} longest-waiting of {list.listedCount} listed animals.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
