// The adoption waiting list (BI-899D7F00): every animal currently listed for
// adoption, longest wait first, with whole days waited. Pure over rows the page
// reads from AdoptableAnimal, so the ordering rules the owner decided are
// unit-tested without a database.
//
// Decisions already made by the owner — not re-opened here:
//   - No pagination. Whole list on one page, capped at the 100 longest-waiting,
//     and the page says so at the bottom when the cap bit.
//   - A listing date in the future is a data-entry error: the animal is left out
//     of the ordering (shown last, with no day count) rather than given a
//     negative number.
//   - A missing listing date shows last rather than hiding the animal.
//   - Read-only. The listing date is AdoptableAnimal.publishedAt, already stored.
//
// One judgement call the owner did not make: the request says "dogs and cats",
// but species also allows rabbit and other. Filtering to dog + cat could hide
// the animal that has waited longest — the exact failure the page exists to
// prevent — so every currently listed animal is included and species is a
// column. The owner said "listed for adoption", so status is the gate: animals
// on hold, pending or adopted are not on the list.

export const WAITING_LIST_CAP = 100;
export const LISTED_STATUS = "available";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WaitingListSource {
  id: string;
  name: string;
  species: string | null;
  breed: string | null;
  status: string;
  publishedAt: Date | null;
}

export type WaitingListDateState = "known" | "future" | "missing";

export interface WaitingListRow {
  id: string;
  name: string;
  species: string | null;
  breed: string | null;
  /** The listing date, or null when missing / in the future. */
  listedOn: Date | null;
  /** Whole days waited; null when the date is missing or in the future. */
  daysWaiting: number | null;
  dateState: WaitingListDateState;
}

export interface WaitingList {
  rows: WaitingListRow[];
  /** Listed animals in total, before the cap. */
  listedCount: number;
  /** True when more animals were listed than the page shows. */
  capped: boolean;
  cap: number;
}

/** Whole days between the listing date and now, counting calendar days in UTC
 *  so an animal listed late yesterday has waited one day, not zero. */
export function wholeDaysWaiting(publishedAt: Date, now: Date): number {
  const start = Date.UTC(publishedAt.getUTCFullYear(), publishedAt.getUTCMonth(), publishedAt.getUTCDate());
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((end - start) / DAY_MS);
}

function dateStateOf(publishedAt: Date | null, now: Date): WaitingListDateState {
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) return "missing";
  if (publishedAt.getTime() > now.getTime()) return "future";
  return "known";
}

const DATE_STATE_RANK: Record<WaitingListDateState, number> = { known: 0, future: 1, missing: 2 };

export function buildWaitingList(
  animals: readonly WaitingListSource[],
  now: Date,
  cap = WAITING_LIST_CAP,
): WaitingList {
  const rows: WaitingListRow[] = animals
    .filter((a) => a.status === LISTED_STATUS)
    .map((a) => {
      const dateState = dateStateOf(a.publishedAt, now);
      const known = dateState === "known" ? a.publishedAt : null;
      return {
        id: a.id,
        name: a.name,
        species: a.species,
        breed: a.breed,
        listedOn: known,
        daysWaiting: known ? wholeDaysWaiting(known, now) : null,
        dateState,
      };
    });
  // Longest wait first; same-day ties by name so the order is stable for an
  // owner reading it week after week. Future and missing dates go last, future
  // before missing, each by name.
  rows.sort((x, y) => {
    if (x.dateState !== y.dateState) return DATE_STATE_RANK[x.dateState] - DATE_STATE_RANK[y.dateState];
    if (x.listedOn && y.listedOn) {
      const byWait = (y.daysWaiting ?? 0) - (x.daysWaiting ?? 0);
      if (byWait !== 0) return byWait;
      const byInstant = x.listedOn.getTime() - y.listedOn.getTime();
      if (byInstant !== 0) return byInstant;
    }
    return x.name.localeCompare(y.name);
  });
  return {
    rows: rows.slice(0, cap),
    listedCount: rows.length,
    capped: rows.length > cap,
    cap,
  };
}
