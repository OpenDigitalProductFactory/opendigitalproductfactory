// Clock-shift setup for time-bomb detection (BI-6A4F47B9).
//
// A "time bomb" is a test whose fixture carries a hardcoded future date that the
// code under test compares against the CURRENT time. It passes until that
// instant, then fails permanently — and because the unit shards are required
// checks, a single one blocks every PR in the repository. That is exactly what
// `care-intake-api-repository.test.ts` did at 2026-08-01T15:00Z (fixed in
// #3885/#3883).
//
// WHY NOT A STATIC GREP. The obvious sweep — "find fixtures with a future
// `new Date("20…")` and no `useFakeTimers`" — was tried and measured on this
// repo: 29 files matched, and the 5 most imminent (one already past its date)
// were run and ALL PASSED. A future date in a fixture is inert unless something
// compares it to now, so the heuristic over-reports roughly 6:1. Acting on it
// would mean churn across several teams' tests, would prevent nothing, and
// would manufacture confidence that the class was handled.
//
// WHAT ACTUALLY WORKS BETTER. Run the suite twice — once normally, once with the
// clock shifted forward — and take the set difference. Benign fixtures mostly stay
// green. `scripts/detect-time-bombs.mjs` drives that comparison; this file is the
// shift half.
//
// BUT NOT PERFECTLY. This comment used to claim the difference was a bomb "with no
// heuristic and no judgement". A +365d sweep on 2026-08-04 measured otherwise: 17
// findings, 5 real, 12 artifacts of one class — subprocess boundaries. Because the
// shim patches `Date` in the vitest process ONLY (see the note below), a test that
// spawns a child hands it parent-built timestamps the child then checks against the
// real clock. Those fixtures can be perfectly drift-proof and still fail here. So
// this catches real bombs the static grep misses, at ~2.4:1 rather than ~6:1 — a
// shortlist worth investigating, not a verdict. Tracked as BI-F8808EDA.
//
// DESIGN NOTES.
//   * Off unless `DPF_CLOCK_SHIFT_DAYS` is set to a non-zero finite number, so
//     every normal run — CI, pregate, a developer's `vitest` — is unaffected
//     beyond one cheap import.
//   * Shifts `Date` only, never timers. Faking timers across a whole suite
//     changes async scheduling and would produce failures that are artifacts of
//     the harness rather than real bombs.
//   * A test that pins its own clock (`vi.useFakeTimers().setSystemTime(...)`)
//     overrides this shim entirely — which is correct: pinning is precisely what
//     makes a test immune, so it should report clean.

const rawDays = process.env.DPF_CLOCK_SHIFT_DAYS ?? "";
const shiftDays = Number.parseFloat(rawDays);

if (rawDays.trim() !== "" && Number.isFinite(shiftDays) && shiftDays !== 0) {
  const offsetMs = shiftDays * 24 * 60 * 60 * 1000;
  const RealDate = Date;

  class ShiftedDate extends RealDate {
    // `unknown[]`, not `ConstructorParameters<typeof Date>`: that helper resolves
    // to a single fixed-arity overload, so TypeScript proves `args.length === 0`
    // impossible and rejects the zero-arg branch (TS2367) — the one branch this
    // shim exists to implement. At runtime the arguments are forwarded verbatim.
    constructor(...args: unknown[]) {
      // Only a bare `new Date()` means "now" and gets shifted. An explicit
      // argument is the caller's own instant and must be preserved verbatim —
      // shifting it would move the very fixture we are testing and mask the bomb.
      if (args.length === 0) {
        super(RealDate.now() + offsetMs);
      } else {
        super(...(args as ConstructorParameters<typeof Date>));
      }
    }

    static now(): number {
      return RealDate.now() + offsetMs;
    }
  }

  globalThis.Date = ShiftedDate as DateConstructor;
}
